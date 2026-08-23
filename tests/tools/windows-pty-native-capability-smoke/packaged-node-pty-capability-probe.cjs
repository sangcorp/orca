const { randomBytes } = require('node:crypto')
const net = require('node:net')
const path = require('node:path')

const EVIDENCE_PREFIX = 'ORCA_NODE_PTY_CAPABILITY_EVIDENCE='
const EXPECTED_ROLES = new Set([
  'target-shell',
  'target-launcher-exited',
  'target-grandchild',
  'canary-shell'
])

function fixtureObservation(fixtureToken, role, channel, extra = {}) {
  return { pid: process.pid, fixtureToken, role, channel, ...extra }
}

function connectFixture(channel, fixtureToken, role, extra = {}) {
  const socket = net.createConnection(channel)
  socket.once('connect', () => {
    socket.write(`${JSON.stringify(fixtureObservation(fixtureToken, role, channel, extra))}\n`)
  })
  socket.on('error', (error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  })
  return socket
}

function buildDetachedGrandchildLaunch(channel, fixtureToken) {
  return {
    program: path.join(process.env.SystemRoot, 'System32', 'wscript.exe'),
    args: [
      path.join(__dirname, 'real-orca-detached-launcher.vbs'),
      process.execPath,
      __filename,
      '--detached-member',
      channel,
      fixtureToken,
      'target-grandchild'
    ]
  }
}

function startDetachedGrandchild(channel, fixtureToken, resourcesDir) {
  const { spawnProcess } = require(
    path.join(resourcesDir, 'app.asar.unpacked', 'out', 'shared', 'child-process', 'run-process.js')
  )
  const launch = buildDetachedGrandchildLaunch(channel, fixtureToken)
  const child = spawnProcess({
    ...launch,
    env: process.env
  })
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream?.on('error', () => {})
  }
  child.stdin?.end()
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`detached launcher exited ${code}`))
        return
      }
      connectFixture(channel, fixtureToken, 'target-launcher-exited', { pid: child.pid })
      resolve(child.pid)
    })
  })
}

async function runPtyShell(channel, fixtureToken, role, resourcesDir) {
  const socket = connectFixture(channel, fixtureToken, `${role}-shell`)
  try {
    if (role === 'target') {
      await startDetachedGrandchild(channel, fixtureToken, resourcesDir)
    }
  } catch (error) {
    socket.destroy()
    throw error
  }
}

function createFixtureServer(channel, fixtureToken) {
  const pending = new Map()
  const observations = new Map()
  const sockets = new Map()
  const closures = new Map()
  const acceptedSockets = new Set()
  let serverClosed = false

  function closureFor(role) {
    const existing = closures.get(role)
    if (existing) {
      return existing
    }
    let resolve
    const promise = new Promise((done) => {
      resolve = done
    })
    const closure = { promise, resolve }
    closures.set(role, closure)
    return closure
  }

  function waitForRole(role) {
    const existing = observations.get(role)
    if (existing) {
      return Promise.resolve(existing)
    }
    return new Promise((resolve) => pending.set(role, resolve))
  }

  const server = net.createServer((socket) => {
    let input = ''
    acceptedSockets.add(socket)
    socket.once('close', () => acceptedSockets.delete(socket))
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      input += String(chunk)
      const newline = input.indexOf('\n')
      if (newline === -1) {
        return
      }
      const observation = JSON.parse(input.slice(0, newline))
      if (
        observation.fixtureToken !== fixtureToken ||
        observation.channel !== channel ||
        !EXPECTED_ROLES.has(observation.role)
      ) {
        throw new Error('fixture observation did not match its unique token, channel, and role')
      }
      observations.set(observation.role, observation)
      sockets.set(observation.role, socket)
      pending.get(observation.role)?.(observation)
      pending.delete(observation.role)
      socket.once('close', closureFor(observation.role).resolve)
    })
  })

  const listening = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(channel, resolve)
  })
  const close = () => {
    if (serverClosed) {
      return Promise.resolve()
    }
    serverClosed = true
    return new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  return {
    listening,
    waitForRole,
    waitForClose: (role) => closureFor(role).promise,
    sockets,
    destroySockets: () => {
      for (const socket of acceptedSockets) {
        socket.destroy()
      }
      server.closeAllConnections?.()
      server.unref()
    },
    close
  }
}

function terminalHandle(pty) {
  return `pty-job:${pty._pty}:${pty.pid}`
}

function exitEvent(pty) {
  return new Promise((resolve) => pty.onExit(resolve))
}

function waitForBarrier(promise, label, timeoutMs = 30_000) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs
    )
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

async function exercise(resourcesDir) {
  const nodePtyDir = path.join(resourcesDir, 'node_modules', 'node-pty')
  const nodePty = require(nodePtyDir)
  const { module: native } = require(path.join(nodePtyDir, 'lib', 'utils.js')).loadNativeModule(
    'conpty'
  )
  const patchedExports = ['assignCurrentProcessToJob', 'listJobProcessIds', 'terminateJob']
  for (const name of patchedExports) {
    if (typeof native[name] !== 'function') {
      throw new Error(`packaged node-pty is missing ${name}`)
    }
  }
  if (!native.assignCurrentProcessToJob()) {
    throw new Error('packaged probe could not establish host job ownership')
  }

  const fixtureToken = randomBytes(32).toString('hex')
  const channel = `\\\\.\\pipe\\orca-pty-native-capability-${fixtureToken}`
  const fixtures = createFixtureServer(channel, fixtureToken)
  await fixtures.listening
  const options = {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: process.cwd(),
    env: process.env,
    useConptyDll: true
  }
  const created = []
  const closed = new Set()
  const exitPromises = []
  let completed = false

  try {
    const target = nodePty.spawn(
      process.execPath,
      [__filename, '--pty-shell', channel, fixtureToken, 'target', resourcesDir],
      options
    )
    created.push(target)
    const targetExited = exitEvent(target)
    exitPromises.push(targetExited)
    const canary = nodePty.spawn(
      process.execPath,
      [__filename, '--pty-shell', channel, fixtureToken, 'canary', resourcesDir],
      options
    )
    created.push(canary)
    const canaryExited = exitEvent(canary)
    exitPromises.push(canaryExited)

    const [shell, launcherExited, grandchild, canaryProcess] = await Promise.all([
      waitForBarrier(fixtures.waitForRole('target-shell'), 'target shell readiness'),
      waitForBarrier(fixtures.waitForRole('target-launcher-exited'), 'detached launcher exit'),
      waitForBarrier(fixtures.waitForRole('target-grandchild'), 'target grandchild readiness'),
      waitForBarrier(fixtures.waitForRole('canary-shell'), 'canary shell readiness')
    ])
    const targetJobProcessIds = native.listJobProcessIds(target._pty, target.pid)
    const targetHandle = terminalHandle(target)
    if (!native.terminateJob(target._pty, target.pid)) {
      throw new Error('exact target job termination was refused')
    }
    closed.add(target)
    await Promise.all([
      waitForBarrier(targetExited, 'target PTY exit'),
      waitForBarrier(fixtures.waitForClose('target-shell'), 'target shell connection close'),
      waitForBarrier(
        fixtures.waitForClose('target-grandchild'),
        'target grandchild connection close'
      )
    ])

    const canaryJobProcessIdsAfterTargetClose = native.listJobProcessIds(canary._pty, canary.pid)
    const canarySocket = fixtures.sockets.get('canary-shell')
    const connectedAfterTargetClose = Boolean(canarySocket && !canarySocket.destroyed)
    if (!native.terminateJob(canary._pty, canary.pid)) {
      throw new Error('exact canary job termination was refused')
    }
    closed.add(canary)
    await Promise.all([
      waitForBarrier(canaryExited, 'canary PTY exit'),
      waitForBarrier(fixtures.waitForClose('canary-shell'), 'canary shell connection close')
    ])

    const evidence = {
      patchedExports,
      fixtureToken,
      channel,
      target: {
        terminalHandle: targetHandle,
        shell,
        launcherExited,
        grandchild,
        grandchildDetached: true,
        jobProcessIds: targetJobProcessIds
      },
      canary: {
        process: canaryProcess,
        connectedAfterTargetClose,
        jobProcessIdsAfterTargetClose: canaryJobProcessIdsAfterTargetClose,
        exactTeardownObserved: true
      },
      close: {
        method: 'terminate-job',
        requestedHandle: targetHandle,
        completedHandle: targetHandle,
        attempts: 1,
        targetExitObserved: true,
        targetShellSocketClosed: true,
        targetGrandchildSocketClosed: true
      }
    }
    await fixtures.close()
    process.stdout.write(`${EVIDENCE_PREFIX}${JSON.stringify(evidence)}\n`)
    completed = true
  } catch (error) {
    process.stderr.write(`[windows-pty-native-capability-smoke] ${error.message}\n`)
    throw error
  } finally {
    for (const pty of created) {
      if (!closed.has(pty)) {
        native.terminateJob(pty._pty, pty.pid)
      }
    }
    if (!completed) {
      await Promise.allSettled(
        exitPromises.map((exit) => waitForBarrier(exit, 'cleanup PTY exit', 5_000))
      )
      fixtures.destroySockets()
      try {
        await waitForBarrier(fixtures.close(), 'fixture server cleanup', 5_000)
      } catch (error) {
        process.stderr.write(`[windows-pty-native-capability-smoke] ${error.message}\n`)
      }
    } else {
      await fixtures.close()
    }
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === '--pty-shell') {
    await runPtyShell(args[0], args[1], args[2], args[3])
    return
  }
  if (mode === '--detached-member') {
    connectFixture(args[0], args[1], args[2])
    return
  }
  if (mode === '--exercise') {
    await exercise(args[0])
    return
  }
  throw new Error(`unknown packaged node-pty capability probe mode: ${mode}`)
}

module.exports = { buildDetachedGrandchildLaunch }

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  })
}
