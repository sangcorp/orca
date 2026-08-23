import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureExactIsolatedDaemonPidFiles,
  waitForExactIsolatedDaemonRetirement
} from './real-orca-packaged-runtime.mjs'

const runRoots = []

function createPidFile(contents) {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), 'orca-daemon-retirement-test-'))
  runRoots.push(userDataDir)
  const daemonDir = path.join(userDataDir, 'daemon')
  mkdirSync(daemonDir)
  const pidFile = path.join(daemonDir, 'daemon-v7.pid')
  writeFileSync(pidFile, contents)
  return { userDataDir, pidFile }
}

afterEach(() => {
  for (const root of runRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('isolated packaged daemon retirement barrier', () => {
  it('captures a readable exact PID-file identity', () => {
    const { userDataDir, pidFile } = createPidFile(JSON.stringify({ pid: 4217 }))

    expect(captureExactIsolatedDaemonPidFiles(userDataDir)).toEqual([pidFile])
  })

  it.each(['not-json', JSON.stringify({ pid: 0 }), JSON.stringify({ pid: '4217' })])(
    'fails closed for unreadable identity %s',
    (contents) => {
      const { userDataDir } = createPidFile(contents)

      expect(() => captureExactIsolatedDaemonPidFiles(userDataDir)).toThrow(
        'isolated daemon did not publish a readable PID identity'
      )
    }
  )

  it('resolves only after the captured PID file is removed', async () => {
    const { userDataDir, pidFile } = createPidFile(JSON.stringify({ pid: 4217 }))
    const files = captureExactIsolatedDaemonPidFiles(userDataDir)
    const retired = waitForExactIsolatedDaemonRetirement(userDataDir, files)

    unlinkSync(pidFile)

    await expect(retired).resolves.toBeUndefined()
  })

  it('rejects a captured PID file outside the isolated profile', async () => {
    const { userDataDir, pidFile } = createPidFile(JSON.stringify({ pid: 4217 }))
    const outside = path.join(path.dirname(userDataDir), path.basename(pidFile))

    await expect(waitForExactIsolatedDaemonRetirement(userDataDir, [outside])).rejects.toThrow(
      'captured daemon PID file escaped the isolated profile'
    )
  })
})
