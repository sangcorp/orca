import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { assertPackagedNodePtyCapability } from './packaged-node-pty-capability-oracle.mjs'

const EVIDENCE_PREFIX = 'ORCA_NODE_PTY_CAPABILITY_EVIDENCE='

function executableArgument(argv) {
  const value = argv.find((arg) => arg.startsWith('--exe='))?.slice('--exe='.length)
  if (!value) {
    throw new Error('usage: windows-pty-native-capability-smoke --exe=<packaged Orca.exe>')
  }
  return path.resolve(value)
}

export function checkoutRunProcessPath() {
  return path.resolve(import.meta.dirname, '../../../out/shared/child-process/run-process.js')
}

export function packagedProbeInvocation(executable, environment = process.env) {
  const resolvedExecutable = path.resolve(executable)
  const resourcesDir = path.join(path.dirname(resolvedExecutable), 'resources')
  const probe = path.join(import.meta.dirname, 'packaged-node-pty-capability-probe.cjs')
  return {
    program: resolvedExecutable,
    args: [probe, '--exercise', resourcesDir],
    env: { ...environment, ELECTRON_RUN_AS_NODE: '1' },
    timeoutMs: 120_000
  }
}

function parseEvidence(stdout) {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(EVIDENCE_PREFIX))
  if (!line) {
    throw new Error(`packaged probe did not emit ${EVIDENCE_PREFIX}`)
  }
  return JSON.parse(line.slice(EVIDENCE_PREFIX.length))
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('windows-pty-native-capability-smoke requires a physical Windows host')
  }
  const executable = executableArgument(process.argv.slice(2))
  const require = createRequire(import.meta.url)
  const { runProcess } = require(checkoutRunProcessPath())
  const result = await runProcess(packagedProbeInvocation(executable))
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`packaged native capability probe failed (${result.code}): ${result.stderr}`)
  }

  assertPackagedNodePtyCapability(parseEvidence(result.stdout))
  process.stdout.write(`[windows-pty-native-capability-smoke] PASS ${executable}\n`)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main()
}
