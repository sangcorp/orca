import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, watch } from 'node:fs'
import path from 'node:path'
import { readDaemonPidFiles } from '../win-update-e2e/daemon-processes.mjs'

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export async function inspectPackagedArtifact(app, requestedExecutable) {
  const observed = await app.evaluate(({ app }) => ({
    executable: process.execPath,
    packaged: app.isPackaged,
    version: app.getVersion()
  }))
  return {
    requestedExecutable: path.resolve(requestedExecutable),
    observedExecutable: path.resolve(observed.executable),
    requestedSha256: sha256(requestedExecutable),
    observedSha256: sha256(observed.executable),
    packaged: observed.packaged,
    version: observed.version
  }
}

export function createPackagedCli(executable, userDataDir, isolatedHome, cwd) {
  const resourcesDir = path.join(path.dirname(executable), 'resources')
  const require = createRequire(import.meta.url)
  const { runProcess } = require(
    path.join(resourcesDir, 'app.asar.unpacked', 'out', 'shared', 'child-process', 'run-process.js')
  )
  const cli = path.join(resourcesDir, 'bin', 'orca.exe')
  const env = {
    ...process.env,
    ORCA_USER_DATA_PATH: userDataDir,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome
  }

  return async (...args) => {
    const result = await runProcess({
      program: cli,
      args: [...args, '--json'],
      cwd,
      env,
      timeoutMs: 60_000
    })
    if (result.timedOut || result.code !== 0) {
      throw new Error(`packaged CLI ${args.join(' ')} failed (${result.code}): ${result.stderr}`)
    }
    const response = JSON.parse(result.stdout.trim())
    if (response?.ok !== true || !response.result) {
      throw new Error(`packaged CLI returned an invalid response: ${result.stdout}`)
    }
    return response.result
  }
}

export function captureExactIsolatedDaemonPidFiles(userDataDir) {
  const daemonDir = path.join(userDataDir, 'daemon')
  const files = existsSync(daemonDir)
    ? readdirSync(daemonDir)
        .filter((entry) => entry.startsWith('daemon-v') && entry.endsWith('.pid'))
        .map((entry) => path.join(daemonDir, entry))
    : []
  const records = readDaemonPidFiles(userDataDir)
  const recordsByFile = new Map(records.map((record) => [path.resolve(record.file), record]))
  const unreadable = files.filter((file) => {
    const record = recordsByFile.get(path.resolve(file))
    return !Number.isInteger(record?.pid) || record.pid <= 0
  })
  if (files.length === 0 || unreadable.length > 0) {
    throw new Error('isolated daemon did not publish a readable PID identity')
  }
  return files
}

function waitForPidFileRemoval(files, timeoutMs = 30_000) {
  const remaining = () => files.filter((file) => existsSync(file))
  if (remaining().length === 0) {
    return Promise.resolve()
  }
  const directory = path.dirname(files[0])
  return new Promise((resolve, reject) => {
    let settled = false
    let watcher = null
    let timer = null
    const finish = (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      watcher?.close()
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    timer = setTimeout(() => {
      finish(new Error(`isolated daemon did not retire: ${remaining().join(', ')}`))
    }, timeoutMs)
    timer.unref?.()
    const handleWatcherError = (error) => {
      finish(remaining().length === 0 ? undefined : error)
    }
    try {
      watcher = watch(directory, () => {
        if (remaining().length === 0) {
          finish()
        }
      })
    } catch (error) {
      handleWatcherError(error)
      return
    }
    watcher.once('error', handleWatcherError)
    if (remaining().length === 0) {
      finish()
    }
  })
}

export async function waitForExactIsolatedDaemonRetirement(userDataDir, capturedFiles = null) {
  const daemonDir = path.join(userDataDir, 'daemon')
  const files = capturedFiles ?? captureExactIsolatedDaemonPidFiles(userDataDir)
  if (files.length === 0) {
    throw new Error('isolated daemon retirement had no captured PID-file identity')
  }
  if (files.some((file) => path.dirname(path.resolve(file)) !== path.resolve(daemonDir))) {
    throw new Error('captured daemon PID file escaped the isolated profile')
  }
  const records = readDaemonPidFiles(userDataDir)
  const recordsByFile = new Map(records.map((record) => [path.resolve(record.file), record]))
  const unreadable = files.filter((file) => {
    if (!existsSync(file)) {
      return false
    }
    const record = recordsByFile.get(path.resolve(file))
    return !Number.isInteger(record?.pid) || record.pid <= 0
  })
  if (unreadable.length > 0) {
    throw new Error('isolated daemon PID record lacked a readable identity')
  }
  await waitForPidFileRemoval(files)
}
