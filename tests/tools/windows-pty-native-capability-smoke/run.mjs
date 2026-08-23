import { createRequire } from 'node:module'
import path from 'node:path'
import { assertPackagedNodePtyCapability } from './packaged-node-pty-capability-oracle.mjs'

const EVIDENCE_PREFIX = 'ORCA_NODE_PTY_CAPABILITY_EVIDENCE='

function executableArgument(argv) {
  const value = argv.find((arg) => arg.startsWith('--exe='))?.slice('--exe='.length)
  if (!value) {
    throw new Error('usage: windows-pty-native-capability-smoke --exe=<packaged Orca.exe>')
  }
  return path.resolve(value)
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
  const resourcesDir = path.join(path.dirname(executable), 'resources')
  const require = createRequire(import.meta.url)
  const { runProcess } = require(
    path.join(resourcesDir, 'app.asar.unpacked', 'out', 'shared', 'child-process', 'run-process.js')
  )
  const probe = path.join(import.meta.dirname, 'packaged-node-pty-capability-probe.cjs')
  const result = await runProcess({
    program: executable,
    args: [probe, '--exercise', resourcesDir],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeoutMs: 120_000
  })
  if (result.code !== 0 || result.timedOut) {
    throw new Error(`packaged native capability probe failed (${result.code}): ${result.stderr}`)
  }

  assertPackagedNodePtyCapability(parseEvidence(result.stdout))
  process.stdout.write(`[windows-pty-native-capability-smoke] PASS ${executable}\n`)
}

await main()
