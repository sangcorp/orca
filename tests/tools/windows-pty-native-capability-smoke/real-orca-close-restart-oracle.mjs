const TOKEN_PATTERN = /^[a-f0-9]{64}$/
const REQUIRED_ROLES = ['target-command', 'target-grandchild', 'canary-command']

function sameWindowsPath(left, right) {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    left.toLowerCase() === right.toLowerCase()
  )
}

function matchingMember(member, role, fixtureToken, channel) {
  return (
    Number.isInteger(member?.pid) &&
    member.pid > 0 &&
    Number.isFinite(member?.startedAtMs) &&
    member.startedAtMs > 0 &&
    member.role === role &&
    member.fixtureToken === fixtureToken &&
    member.channel === channel
  )
}

function findTerminal(inventory, identity) {
  return inventory?.terminals?.find(
    (terminal) =>
      terminal.handle === identity?.handle &&
      terminal.tabId === identity?.tabId &&
      terminal.ptyId === identity?.ptyId &&
      terminal.connected === true
  )
}

function targetAbsent(inventory, target) {
  return (
    Array.isArray(inventory?.terminals) &&
    !inventory.terminals.some(
      (terminal) =>
        terminal.handle === target?.handle ||
        terminal.tabId === target?.tabId ||
        terminal.ptyId === target?.ptyId
    )
  )
}

function inventoryIsExactly(inventory, identities) {
  return (
    Array.isArray(inventory?.terminals) &&
    inventory.terminals.length === identities.length &&
    identities.every((identity) => findTerminal(inventory, identity))
  )
}

function containsExactly(values, expected) {
  return (
    Array.isArray(values) &&
    values.length === expected.length &&
    expected.every((value) => values.includes(value))
  )
}

export function evaluateRealOrcaCloseRestart(evidence) {
  const failures = []
  const fixtureToken = evidence?.fixtureToken
  const channel = evidence?.channel

  if (!TOKEN_PATTERN.test(fixtureToken) || !channel?.includes(fixtureToken)) {
    failures.push('fixture channel is not bound to an unguessable per-run token')
  }

  const artifact = evidence?.artifact
  if (
    artifact?.packaged !== true ||
    !sameWindowsPath(artifact?.requestedExecutable, artifact?.observedExecutable) ||
    artifact?.requestedSha256 !== artifact?.observedSha256
  ) {
    failures.push('the running Electron main is not the exact requested packaged artifact')
  }

  for (const role of REQUIRED_ROLES) {
    if (!matchingMember(evidence?.members?.[role], role, fixtureToken, channel)) {
      failures.push(`${role} did not prove its exact fixture identity`)
    }
  }
  const memberPids = REQUIRED_ROLES.map((role) => evidence?.members?.[role]?.pid)
  if (memberPids.every(Number.isInteger) && new Set(memberPids).size !== REQUIRED_ROLES.length) {
    failures.push('target command, detached grandchild, and canary must be distinct processes')
  }
  if (
    evidence?.detachment?.launcherExited !== true ||
    !Number.isInteger(evidence?.detachment?.launcherPid) ||
    evidence.detachment.launcherPid <= 0 ||
    evidence?.members?.['target-grandchild']?.ppid !== evidence.detachment.launcherPid ||
    !Array.isArray(evidence?.detachment?.consoleProcessIds) ||
    !evidence.detachment.consoleProcessIds.includes(evidence?.members?.['target-command']?.pid) ||
    evidence.detachment.consoleProcessIds.includes(evidence?.members?.['target-grandchild']?.pid)
  ) {
    failures.push(
      'the grandchild was not proven detached behind an exited launcher and outside the target console'
    )
  }

  const target = evidence?.target
  const canary = evidence?.canary
  if (!findTerminal(evidence?.beforeClose, target)) {
    failures.push('the authoritative pre-close inventory did not contain the exact target')
  }
  if (!findTerminal(evidence?.beforeClose, canary)) {
    failures.push('the authoritative pre-close inventory did not contain the exact canary')
  }
  if (!inventoryIsExactly(evidence?.beforeClose, [target, canary])) {
    failures.push('the authoritative pre-close inventory was not exactly target plus canary')
  }

  const close = evidence?.close
  if (
    close?.attempts !== 1 ||
    close?.requestedHandle !== target?.handle ||
    close?.receipt?.handle !== target?.handle ||
    close?.receipt?.tabId !== target?.tabId ||
    close?.receipt?.ptyKilled !== true
  ) {
    failures.push('one exact terminal.close did not return a confirmed target-stop receipt')
  }
  if (close?.targetCommandClosed !== true || close?.targetGrandchildClosed !== true) {
    failures.push('target close did not end both fixture connections')
  }
  if (
    close?.targetDomAbsent !== true ||
    close?.canaryDomPresent !== true ||
    !containsExactly(close?.domTabIds, [canary?.tabId])
  ) {
    failures.push('the packaged UI did not retire only the target tab')
  }
  if (close?.canaryAckAfterClose !== true) {
    failures.push('the unrelated canary stopped answering after target close')
  }
  if (
    !targetAbsent(evidence?.afterClose, target) ||
    !inventoryIsExactly(evidence?.afterClose, [canary])
  ) {
    failures.push('post-close runtime inventory did not retire only the exact target')
  }

  const restart = evidence?.restart
  if (
    restart?.firstExit?.mainPid <= 0 ||
    restart?.firstExit?.graceful !== true ||
    restart?.firstExit?.forced !== false ||
    restart?.artifact?.packaged !== true ||
    !sameWindowsPath(
      restart?.artifact?.requestedExecutable,
      restart?.artifact?.observedExecutable
    ) ||
    restart?.artifact?.requestedSha256 !== restart?.artifact?.observedSha256 ||
    !targetAbsent(restart?.inventory, target) ||
    !findTerminal(restart?.inventory, canary) ||
    restart?.targetDomAbsent !== true ||
    restart?.canaryDomPresent !== true ||
    !inventoryIsExactly(restart?.inventory, [canary]) ||
    !containsExactly(restart?.domTabIds, [canary?.tabId]) ||
    restart?.canaryAck !== true ||
    restart?.terminalSend?.handle !== canary?.handle ||
    restart?.terminalSend?.accepted !== true ||
    restart?.terminalSend?.bytesWritten !==
      Buffer.byteLength(restart?.terminalChallenge ?? '') + 1 ||
    restart?.terminalInput !== restart?.terminalChallenge
  ) {
    failures.push('exact packaged restart did not preserve target absence and canary usability')
  }
  const cleanup = evidence?.cleanup
  if (
    cleanup?.canaryClosed !== true ||
    cleanup?.canaryReceipt?.handle !== canary?.handle ||
    cleanup?.canaryReceipt?.tabId !== canary?.tabId ||
    cleanup?.canaryReceipt?.ptyKilled !== true
  ) {
    failures.push('the exact canary terminal teardown was not confirmed')
  }

  return { pass: failures.length === 0, failures }
}

export function assertRealOrcaCloseRestart(evidence) {
  const result = evaluateRealOrcaCloseRestart(evidence)
  if (!result.pass) {
    throw new Error(`Packaged real-Orca close/restart failed:\n- ${result.failures.join('\n- ')}`)
  }
}
