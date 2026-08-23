import { describe, expect, it } from 'vitest'
import { evaluateRealOrcaCloseRestart } from './real-orca-close-restart-oracle.mjs'

const fixtureToken = 'b'.repeat(64)
const channel = `\\\\.\\pipe\\orca-real-pty-${fixtureToken}`

function member(pid, role, ppid = pid - 1) {
  return { pid, ppid, role, fixtureToken, channel, startedAtMs: 1_786_000_000_000 + pid }
}

function terminal(handle, tabId, ptyId) {
  return { handle, tabId, ptyId, connected: true }
}

function passingEvidence() {
  const target = { handle: 'term_target', tabId: 'tab-target', ptyId: 'pty-target' }
  const canary = { handle: 'term_canary', tabId: 'tab-canary', ptyId: 'pty-canary' }
  return {
    fixtureToken,
    channel,
    artifact: {
      packaged: true,
      requestedExecutable: 'C:\\Orca\\Orca.exe',
      observedExecutable: 'c:\\orca\\ORCA.EXE',
      requestedSha256: 'artifact-sha',
      observedSha256: 'artifact-sha'
    },
    members: {
      'target-command': member(4100, 'target-command'),
      'target-grandchild': member(4102, 'target-grandchild', 4101),
      'canary-command': member(5100, 'canary-command')
    },
    detachment: { launcherPid: 4101, launcherExited: true, consoleProcessIds: [4100] },
    target,
    canary,
    beforeClose: {
      terminals: [
        terminal(target.handle, target.tabId, target.ptyId),
        terminal(canary.handle, canary.tabId, canary.ptyId)
      ]
    },
    close: {
      attempts: 1,
      requestedHandle: target.handle,
      receipt: { ...target, ptyKilled: true },
      targetCommandClosed: true,
      targetGrandchildClosed: true,
      targetDomAbsent: true,
      canaryDomPresent: true,
      domTabIds: [canary.tabId],
      canaryAckAfterClose: true
    },
    afterClose: { terminals: [terminal(canary.handle, canary.tabId, canary.ptyId)] },
    restart: {
      artifact: {
        packaged: true,
        requestedExecutable: 'C:\\Orca\\Orca.exe',
        observedExecutable: 'c:\\orca\\ORCA.EXE',
        requestedSha256: 'artifact-sha',
        observedSha256: 'artifact-sha'
      },
      firstExit: { mainPid: 6100, graceful: true, forced: false },
      inventory: { terminals: [terminal(canary.handle, canary.tabId, canary.ptyId)] },
      targetDomAbsent: true,
      canaryDomPresent: true,
      domTabIds: [canary.tabId],
      canaryAck: true,
      terminalChallenge: 'orca-restart-challenge',
      terminalSend: {
        handle: canary.handle,
        accepted: true,
        bytesWritten: Buffer.byteLength('orca-restart-challenge') + 1
      },
      terminalInput: 'orca-restart-challenge'
    },
    cleanup: {
      canaryClosed: true,
      canaryReceipt: { ...canary, ptyKilled: true }
    }
  }
}

describe('packaged real-Orca close/restart oracle', () => {
  it('accepts exact target retirement and surviving canary evidence', () => {
    expect(evaluateRealOrcaCloseRestart(passingEvidence())).toEqual({ pass: true, failures: [] })
  })

  it.each([
    [
      'wrong packaged executable',
      (evidence) => (evidence.artifact.observedExecutable = 'C:\\Other\\Orca.exe')
    ],
    ['missing grandchild identity', (evidence) => delete evidence.members['target-grandchild']],
    ['live launcher', (evidence) => (evidence.detachment.launcherExited = false)],
    [
      'grandchild visible in target console',
      (evidence) => evidence.detachment.consoleProcessIds.push(4102)
    ],
    [
      'target missing from console list',
      (evidence) => (evidence.detachment.consoleProcessIds = [])
    ],
    ['unconfirmed close', (evidence) => (evidence.close.receipt.ptyKilled = false)],
    ['target socket retained', (evidence) => (evidence.close.targetGrandchildClosed = false)],
    ['canary stopped', (evidence) => (evidence.close.canaryAckAfterClose = false)],
    [
      'target retained after close',
      (evidence) =>
        evidence.afterClose.terminals.push(terminal('term_target', 'tab-target', 'pty-target'))
    ],
    [
      'replacement terminal spawned after close',
      (evidence) =>
        evidence.afterClose.terminals.push(terminal('term_other', 'tab-other', 'pty-other'))
    ],
    [
      'replacement tab rendered after close',
      (evidence) => evidence.close.domTabIds.push('tab-other')
    ],
    [
      'target resurrected after restart',
      (evidence) =>
        evidence.restart.inventory.terminals.push(terminal('term_other', 'tab-target', 'pty-other'))
    ],
    ['canary missing after restart', (evidence) => (evidence.restart.inventory.terminals = [])],
    ['first main exit unconfirmed', (evidence) => (evidence.restart.firstExit.graceful = false)],
    [
      'forced first main exit',
      (evidence) => {
        evidence.restart.firstExit.graceful = false
        evidence.restart.firstExit.forced = true
      }
    ],
    [
      'wrong restart artifact',
      (evidence) => (evidence.restart.artifact.observedSha256 = 'other-sha')
    ],
    ['restart PTY input missing', (evidence) => (evidence.restart.terminalInput = 'other')],
    [
      'restart terminal.send refused',
      (evidence) => (evidence.restart.terminalSend.accepted = false)
    ],
    [
      'restart terminal.send targeted another handle',
      (evidence) => (evidence.restart.terminalSend.handle = 'term_other')
    ],
    [
      'replacement terminal spawned after restart',
      (evidence) =>
        evidence.restart.inventory.terminals.push(terminal('term_other', 'tab-other', 'pty-other'))
    ],
    [
      'replacement tab rendered after restart',
      (evidence) => evidence.restart.domTabIds.push('tab-other')
    ],
    ['canary cleanup absent', (evidence) => (evidence.cleanup.canaryClosed = false)],
    [
      'wrong canary cleanup handle',
      (evidence) => (evidence.cleanup.canaryReceipt.handle = 'other')
    ],
    ['unconfirmed canary cleanup', (evidence) => (evidence.cleanup.canaryReceipt.ptyKilled = false)]
  ])('rejects %s', (_name, mutate) => {
    const evidence = passingEvidence()
    mutate(evidence)
    expect(evaluateRealOrcaCloseRestart(evidence).pass).toBe(false)
  })
})
