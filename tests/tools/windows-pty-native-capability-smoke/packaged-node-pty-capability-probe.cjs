const { randomBytes } = require('node:crypto')
const net = require('node:net')
const path = require('node:path')

const EVIDENCE_PREFIX = 'ORCA_NODE_PTY_CAPABILITY_EVIDENCE='
const EXPECTED_ROLES = new Set(['target-shell', 'target-grandchild', 'canary-shell'])

function fixtureObservation(fixtureToken, role, channel) {
  return { pid: process.pid, fixtureToken, role, channel }
}

function connectFixture(channel, fixtureToken, role) {
  const socket = net.createConnection(channel)
  socket.once('connect', () => {
    socket.write(`${JSON.stringify(fixtureObservation(fixtureToken, role, channel))}\n`)
  })
  socket.on('error', (error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  })
  return socket
}

function quoteCmdArgument(value) {
  if (/[\r\n"]/.test(value)) {
    throw new Error('PTY native capability fixture paths cannot contain quotes or line breaks')
  }
  return `"${value}"`
}

function startDetachedGrandchild(channel, fixtureToken, resourcesDir) {
  const { spawnProcess } = require(
    path.join(resourcesDir, 'app.asar.unpacked', 'out', 'shared', 'child-process', 'run-process.js')
  )
  const command = [
    'start "" /b',
    quoteCmdArgument(process.execPath),
    quoteCmdArgument(__filename),
    '--detached-member',
    quoteCmdArgument(channel),
    fixtureToken,
    'target-grandchild'
  ].join(' ')
  const child = spawnProcess({
    program: process.env.ComSpec || path.join(process.env.SystemRoot, 'System32', 'cmd.exe'),
    args: ['/d', '/s', '/c', command],
    env: process.env
  })
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    stream?.on('error', () => {})
  }
  child.stdin?.end()
}

function runPtyShell(channel, fixtureToken, role, resourcesDir) {
  connectFixture(channel, fixtureToken, `${role}-shell`)
  if (role === 'target') {
    startDetachedGrandchild(channel, fixtureToken, resourcesDir)
  }
}

function createFixtureServer(channel, fixtureToken) {
  const pending = new Map()
  const observations = new Map()
  const sockets = new Map()
  const closures = new Map()
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
    close
  }
}

function terminalHandle(pty) {
  return `pty-job:${pty._pty}:${pty.pid}`
}

function exitEvent(pty) {
  return new Promise((resolve) => pty.onExit(resolve))
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

  try {
    const target = nodePty.spawn(
      process.execPath,
      [__filename, '--pty-shell', channel, fixtureToken, 'target', resourcesDir],
      options
    )
    created.push(target)
    const targetExited = exitEvent(target)
    const canary = nodePty.spawn(
      process.execPath,
      [__filename, '--pty-shell', channel, fixtureToken, 'canary', resourcesDir],
      options
    )
    created.push(canary)
    const canaryExited = exitEvent(canary)

    const [shell, grandchild, canaryProcess] = await Promise.all([
      fixtures.waitForRole('target-shell'),
      fixtures.waitForRole('target-grandchild'),
      fixtures.waitForRole('canary-shell')
    ])
    const targetJobProcessIds = native.listJobProcessIds(target._pty, target.pid)
    const targetHandle = terminalHandle(target)
    if (!native.terminateJob(target._pty, target.pid)) {
      throw new Error('exact target job termination was refused')
    }
    closed.add(target)
    await Promise.all([
      targetExited,
      fixtures.waitForClose('target-shell'),
      fixtures.waitForClose('target-grandchild')
    ])

    const canaryJobProcessIdsAfterTargetClose = native.listJobProcessIds(canary._pty, canary.pid)
    const canarySocket = fixtures.sockets.get('canary-shell')
    const connectedAfterTargetClose = Boolean(canarySocket && !canarySocket.destroyed)
    if (!native.terminateJob(canary._pty, canary.pid)) {
      throw new Error('exact canary job termination was refused')
    }
    closed.add(canary)
    await Promise.all([canaryExited, fixtures.waitForClose('canary-shell')])

    const evidence = {
      patchedExports,
      fixtureToken,
      channel,
      target: {
        terminalHandle: targetHandle,
        shell,
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
  } finally {
    for (const pty of created) {
      if (!closed.has(pty)) {
        native.terminateJob(pty._pty, pty.pid)
      }
    }
    await fixtures.close()
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === '--pty-shell') {
    runPtyShell(args[0], args[1], args[2], args[3])
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

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
