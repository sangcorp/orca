import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  closeApp,
  createTerminalTab,
  dismissOverlays,
  ensureTerminal,
  launchInstalledApp,
  listTabIds,
  runShellCommand
} from '../win-update-e2e/app-driver.mjs'
import { buildFreshProfile, createSeededRepo } from '../win-update-e2e/onboarding-profile.mjs'
import { quotePowerShellLiteral } from '../win-update-e2e/powershell-runner.mjs'
import { assertRealOrcaCloseRestart } from './real-orca-close-restart-oracle.mjs'
import { createRealOrcaMemberChannel } from './real-orca-member-channel.mjs'
import {
  captureExactIsolatedDaemonPidFiles,
  createPackagedCli,
  inspectPackagedArtifact,
  waitForExactIsolatedDaemonRetirement
} from './real-orca-packaged-runtime.mjs'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'

function executableArgument(argv) {
  const value = argv.find((arg) => arg.startsWith('--exe='))?.slice('--exe='.length)
  if (!value) {
    throw new Error('usage: real-orca-close-restart --exe=<packaged Orca.exe>')
  }
  return path.resolve(value)
}

function oneTerminalForTab(inventory, tabId, label) {
  const matches = inventory.terminals.filter((terminal) => terminal.tabId === tabId)
  if (
    matches.length !== 1 ||
    !matches[0].handle ||
    !matches[0].ptyId ||
    matches[0].connected !== true
  ) {
    throw new Error(`${label} did not map to one authoritative terminal identity`)
  }
  return {
    handle: matches[0].handle,
    tabId: matches[0].tabId,
    ptyId: matches[0].ptyId
  }
}

function memberCommand(
  executable,
  fixture,
  channel,
  fixtureToken,
  role,
  resourcesDir,
  detachedLauncher = ''
) {
  const values = [
    executable,
    fixture,
    '--member',
    channel,
    fixtureToken,
    role,
    resourcesDir,
    detachedLauncher
  ]
  return [
    `$env:ELECTRON_RUN_AS_NODE='1'`,
    `& ${values.map(quotePowerShellLiteral).join(' ')}`
  ].join('; ')
}

async function tabState(page, targetTabId, canaryTabId) {
  const domTabIds = await listTabIds(page)
  return {
    domTabIds,
    targetDomAbsent: !domTabIds.includes(targetTabId),
    canaryDomPresent: domTabIds.filter((tabId) => tabId === canaryTabId).length === 1
  }
}

async function waitForTabRemoval(page, tabId) {
  await page
    .locator(`${SORTABLE_TAB}[data-tab-id="${tabId}"]`)
    .waitFor({ state: 'detached', timeout: 30_000 })
}

function exactTerminalInInventory(inventory, identity) {
  const sameHandle = inventory?.terminals?.filter((terminal) => terminal.handle === identity.handle)
  if (!Array.isArray(sameHandle)) {
    throw new Error('authoritative terminal inventory was unavailable during cleanup')
  }
  if (sameHandle.length === 0) {
    return null
  }
  if (
    sameHandle.length !== 1 ||
    sameHandle[0].tabId !== identity.tabId ||
    sameHandle[0].ptyId !== identity.ptyId
  ) {
    throw new Error(`terminal handle ${identity.handle} no longer has its exact known identity`)
  }
  return sameHandle[0]
}

function assertCloseReceipt(receipt, identity, label) {
  if (
    receipt?.handle !== identity.handle ||
    receipt?.tabId !== identity.tabId ||
    receipt?.ptyKilled !== true
  ) {
    throw new Error(`${label} close did not return an exact confirmed stop receipt`)
  }
}

function assertConfirmedAppClose(result, label, { requireGraceful = false } = {}) {
  const confirmed =
    Number.isInteger(result?.mainPid) &&
    result.mainPid > 0 &&
    (requireGraceful
      ? result.graceful === true && result.forced === false
      : result.graceful === true || result.forced === true)
  if (!confirmed) {
    throw new Error(`${label} did not confirm exact Electron main exit`)
  }
}

async function closeExactKnownTerminals(cli, identities) {
  if (!cli) {
    return []
  }
  const known = identities.filter(Boolean)
  if (known.length === 0) {
    return []
  }
  const inventory = await cli('terminal', 'list')
  const receipts = []
  for (const identity of known) {
    if (!exactTerminalInInventory(inventory, identity)) {
      continue
    }
    const result = await cli('terminal', 'close', '--terminal', identity.handle)
    assertCloseReceipt(result.close, identity, 'cleanup terminal')
    receipts.push(result.close)
  }
  return receipts
}

async function captureCleanupFailure(errors, label, cleanup) {
  try {
    await cleanup()
  } catch (error) {
    errors.push(new Error(`${label}: ${error.message}`, { cause: error }))
  }
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('real-orca-close-restart requires a Windows host')
  }
  const executable = executableArgument(process.argv.slice(2))
  if (!existsSync(executable)) {
    throw new Error(`packaged executable does not exist: ${executable}`)
  }

  const runRoot = mkdtempSync(path.join(os.tmpdir(), 'orca-real-pty-'))
  const userDataDir = path.join(runRoot, 'user-data')
  const repo = createSeededRepo(path.join(runRoot, 'fixture-repo'))
  const profile = buildFreshProfile({ repo })
  profile.settings.terminalWindowsShell = 'powershell.exe'
  const fixtureToken = randomBytes(32).toString('hex')
  const memberChannel = createRealOrcaMemberChannel(fixtureToken)
  const fixture = path.join(import.meta.dirname, 'real-orca-terminal-member.cjs')
  const detachedLauncher = path.join(import.meta.dirname, 'real-orca-detached-launcher.vbs')
  const resourcesDir = path.join(path.dirname(executable), 'resources')
  let first = null
  let second = null
  let cli = null
  let target = null
  let canary = null
  let cleanupCanaryClosed = false
  let evidence = null
  let primaryError = null
  let daemonPidFiles = null

  try {
    await memberChannel.listening
    first = await launchInstalledApp({
      exePath: executable,
      userDataDir,
      seedProfile: profile
    })
    const artifact = await inspectPackagedArtifact(first.app, executable)
    await ensureTerminal(first.page, { allowCreate: true })
    await dismissOverlays(first.page)
    const initialTabs = await listTabIds(first.page)
    if (initialTabs.length !== 1) {
      throw new Error(`fresh packaged profile opened ${initialTabs.length} terminal tabs`)
    }
    const targetTabId = initialTabs[0]
    await createTerminalTab(first.page)
    const tabs = await listTabIds(first.page)
    const canaryTabId = tabs.find((tabId) => tabId !== targetTabId)
    if (tabs.length !== 2 || !canaryTabId) {
      throw new Error('canary terminal tab was not uniquely created')
    }

    const isolatedHome = realpathSync.native(path.join(userDataDir, 'home'))
    cli = createPackagedCli(executable, userDataDir, isolatedHome, repo.path)
    const identityInventory = await cli('terminal', 'list')
    target = oneTerminalForTab(identityInventory, targetTabId, 'target tab')
    canary = oneTerminalForTab(identityInventory, canaryTabId, 'canary tab')
    const targetReady = memberChannel.waitFor('target-command', 'ready')
    const grandchildReady = memberChannel.waitFor('target-grandchild', 'ready')
    const launcherExited = memberChannel.waitFor('target-command', 'launcher-exited')
    await runShellCommand(
      first.page,
      memberCommand(
        executable,
        fixture,
        memberChannel.channel,
        fixtureToken,
        'target-command',
        resourcesDir,
        detachedLauncher
      ),
      targetTabId
    )
    const canaryReady = memberChannel.waitFor('canary-command', 'ready')
    await runShellCommand(
      first.page,
      memberCommand(
        executable,
        fixture,
        memberChannel.channel,
        fixtureToken,
        'canary-command',
        resourcesDir
      ),
      canaryTabId
    )
    const [targetMember, grandchildMember, canaryMember, detachment] = await Promise.all([
      targetReady,
      grandchildReady,
      canaryReady,
      launcherExited
    ])
    const consoleList = await memberChannel.requestMessage('target-command', 'console-list')

    const beforeClose = await cli('terminal', 'list')
    daemonPidFiles = captureExactIsolatedDaemonPidFiles(userDataDir)
    const targetCommandClosed = memberChannel.waitForClose('target-command')
    const targetGrandchildClosed = memberChannel.waitForClose('target-grandchild')
    const closed = await cli('terminal', 'close', '--terminal', target.handle)
    await Promise.all([
      targetCommandClosed,
      targetGrandchildClosed,
      waitForTabRemoval(first.page, target.tabId)
    ])
    const canaryAckAfterClose = await memberChannel.request('canary-command', 'ping')
    const afterClose = await cli('terminal', 'list')
    const closeDom = await tabState(first.page, target.tabId, canary.tabId)

    const firstExit = await closeApp(first.app)
    assertConfirmedAppClose(firstExit, 'first app close', { requireGraceful: true })
    first = null
    second = await launchInstalledApp({ exePath: executable, userDataDir })
    const restartArtifact = await inspectPackagedArtifact(second.app, executable)
    await ensureTerminal(second.page, { allowCreate: false })
    const restartInventory = await cli('terminal', 'list')
    const restartDom = await tabState(second.page, target.tabId, canary.tabId)
    const restartCanaryAck = await memberChannel.request('canary-command', 'ping')
    const terminalChallenge = `orca-restart-${fixtureToken}`
    const terminalInput = memberChannel.waitFor('canary-command', 'terminal-input')
    const terminalSend = await cli(
      'terminal',
      'send',
      '--terminal',
      canary.handle,
      '--text',
      terminalChallenge,
      '--enter'
    )
    if (
      terminalSend.send?.handle !== canary.handle ||
      terminalSend.send?.accepted !== true ||
      terminalSend.send?.bytesWritten !== Buffer.byteLength(terminalChallenge) + 1
    ) {
      throw new Error('packaged terminal.send did not confirm the restart challenge write')
    }
    const terminalInputEvidence = await terminalInput
    if (terminalInputEvidence.marker !== terminalChallenge) {
      throw new Error('restart terminal input reached the canary with the wrong marker')
    }

    const canaryMemberClosed = memberChannel.waitForClose('canary-command')
    const canaryClosed = await cli('terminal', 'close', '--terminal', canary.handle)
    assertCloseReceipt(canaryClosed.close, canary, 'canary terminal')
    await Promise.all([canaryMemberClosed, waitForTabRemoval(second.page, canary.tabId)])
    cleanupCanaryClosed = true

    evidence = {
      fixtureToken,
      channel: memberChannel.channel,
      artifact,
      members: {
        'target-command': targetMember,
        'target-grandchild': grandchildMember,
        'canary-command': canaryMember
      },
      detachment: {
        launcherPid: detachment.launcherPid,
        launcherExited: true,
        consoleProcessIds: consoleList.consoleProcessIds
      },
      target,
      canary,
      beforeClose,
      close: {
        attempts: 1,
        requestedHandle: target.handle,
        receipt: closed.close,
        targetCommandClosed: true,
        targetGrandchildClosed: true,
        ...closeDom,
        canaryAckAfterClose
      },
      afterClose,
      restart: {
        artifact: restartArtifact,
        firstExit,
        inventory: restartInventory,
        ...restartDom,
        canaryAck: restartCanaryAck,
        terminalChallenge,
        terminalInput: terminalInputEvidence.marker,
        terminalSend: terminalSend.send
      },
      cleanup: {
        canaryClosed: cleanupCanaryClosed,
        canaryReceipt: canaryClosed.close
      }
    }
    assertRealOrcaCloseRestart(evidence)
  } catch (error) {
    primaryError = error
  }

  const cleanupErrors = []
  for (const role of ['target-command', 'target-grandchild', 'canary-command']) {
    await captureCleanupFailure(cleanupErrors, `${role} shutdown`, () =>
      memberChannel.shutdown(role)
    )
  }
  await captureCleanupFailure(cleanupErrors, 'known terminal cleanup', () =>
    closeExactKnownTerminals(cli, [target, canary])
  )
  await captureCleanupFailure(cleanupErrors, 'first app close', async () => {
    if (first) {
      const result = await closeApp(first.app)
      assertConfirmedAppClose(result, 'first app cleanup')
      first = null
    }
  })
  await captureCleanupFailure(cleanupErrors, 'second app close', async () => {
    if (second) {
      const result = await closeApp(second.app)
      assertConfirmedAppClose(result, 'second app cleanup')
      second = null
    }
  })
  await captureCleanupFailure(cleanupErrors, 'member channel close', () => memberChannel.close())
  await captureCleanupFailure(cleanupErrors, 'isolated daemon retirement', () =>
    waitForExactIsolatedDaemonRetirement(userDataDir, daemonPidFiles)
  )

  if (cleanupErrors.length === 0) {
    rmSync(runRoot, { recursive: true, force: true })
  } else {
    process.stderr.write(`[real-orca-close-restart] preserved cleanup evidence: ${runRoot}\n`)
  }
  if (primaryError || cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors].filter(Boolean),
      'packaged real-Orca close/restart sentinel failed'
    )
  }
  process.stdout.write(`[real-orca-close-restart] PASS ${executable}\n`)
}

await main()
