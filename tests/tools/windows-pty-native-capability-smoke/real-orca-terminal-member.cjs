const net = require('node:net')
const path = require('node:path')

const CONSOLE_LIST_PREFIX = 'ORCA_REAL_PTY_CONSOLE_LIST='

function createTerminalInputLineBuffer(onLine) {
  let terminalInput = ''
  return (chunk) => {
    terminalInput += String(chunk)
    for (;;) {
      const newline = terminalInput.search(/[\r\n]/)
      if (newline === -1) {
        return
      }
      const marker = terminalInput.slice(0, newline)
      terminalInput = terminalInput.slice(newline + 1)
      if (marker) {
        onLine(marker)
      }
    }
  }
}

function identity(fixtureToken, channel, role, type, extra = {}) {
  return {
    type,
    role,
    fixtureToken,
    channel,
    pid: process.pid,
    ppid: process.ppid,
    startedAtMs: Date.now() - process.uptime() * 1000,
    ...extra
  }
}

function connect(channel, fixtureToken, role, resourcesDir, detachedLauncher) {
  const socket = net.createConnection(channel)
  let pending = ''
  const send = (type, extra = {}) => {
    socket.write(`${JSON.stringify(identity(fixtureToken, channel, role, type, extra))}\n`)
  }

  socket.once('connect', () => {
    send('ready')
    if (role === 'target-command') {
      try {
        startDetachedGrandchild(socket, send, channel, fixtureToken, resourcesDir, detachedLauncher)
      } catch (error) {
        socket.destroy(error)
      }
    }
  })
  if (role === 'canary-command') {
    process.stdin.setEncoding('utf8')
    process.stdin.on(
      'data',
      createTerminalInputLineBuffer((marker) => send('terminal-input', { marker }))
    )
  }
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    pending += String(chunk)
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline === -1) {
        return
      }
      const line = pending.slice(0, newline)
      pending = pending.slice(newline + 1)
      if (!line) {
        continue
      }
      const message = JSON.parse(line)
      if (message.type === 'ping') {
        send('ping-ack', { requestId: message.requestId })
      } else if (message.type === 'console-list') {
        probeConsoleProcessList(resourcesDir)
          .then((consoleProcessIds) =>
            send('console-list-ack', { requestId: message.requestId, consoleProcessIds })
          )
          .catch((error) => socket.destroy(error))
      } else if (message.type === 'shutdown') {
        send('shutdown-ack', { requestId: message.requestId })
        socket.end(() => process.exit(0))
      }
    }
  })
  socket.on('error', (error) => {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  })
}

async function probeConsoleProcessList(resourcesDir) {
  const { runProcess } = require(
    path.join(resourcesDir, 'app.asar.unpacked', 'out', 'shared', 'child-process', 'run-process.js')
  )
  const result = await runProcess({
    program: process.execPath,
    args: [__filename, '--console-list', String(process.pid), resourcesDir],
    env: process.env,
    timeoutMs: 30_000
  })
  if (result.timedOut || result.code !== 0) {
    throw new Error(`console-list probe failed (${result.code}): ${result.stderr}`)
  }
  const line = result.stdout.split(/\r?\n/).find((value) => value.startsWith(CONSOLE_LIST_PREFIX))
  if (!line) {
    throw new Error('console-list probe returned no exact evidence line')
  }
  const processIds = JSON.parse(line.slice(CONSOLE_LIST_PREFIX.length))
  if (!Array.isArray(processIds) || processIds.some((pid) => !Number.isInteger(pid) || pid <= 0)) {
    throw new Error('console-list probe returned invalid process identities')
  }
  return processIds
}

function startDetachedGrandchild(
  socket,
  send,
  channel,
  fixtureToken,
  resourcesDir,
  detachedLauncher
) {
  const { spawnProcess } = require(
    path.join(resourcesDir, 'app.asar.unpacked', 'out', 'shared', 'child-process', 'run-process.js')
  )
  if (!detachedLauncher) {
    throw new Error('target member requires the detached launcher fixture')
  }
  const launcher = spawnProcess({
    program: path.join(process.env.SystemRoot, 'System32', 'wscript.exe'),
    args: [
      detachedLauncher,
      process.execPath,
      __filename,
      '--member',
      channel,
      fixtureToken,
      'target-grandchild',
      resourcesDir,
      ''
    ],
    env: process.env
  })
  const launcherPid = launcher.pid
  for (const stream of [launcher.stdin, launcher.stdout, launcher.stderr]) {
    stream?.on('error', () => {})
  }
  launcher.stdin?.end()
  launcher.once('error', (error) => socket.destroy(error))
  launcher.once('exit', (code) => {
    if (code !== 0) {
      socket.destroy(new Error(`detached launcher exited ${code}`))
      return
    }
    send('launcher-exited', { launcherPid })
  })
}

function emitConsoleProcessList(shellPid, resourcesDir) {
  const nodePtyDir = path.join(resourcesDir, 'node_modules', 'node-pty')
  const { module: native } = require(path.join(nodePtyDir, 'lib', 'utils.js')).loadNativeModule(
    'conpty_console_list'
  )
  const processIds = native.getConsoleProcessList(Number(shellPid))
  process.stdout.write(`${CONSOLE_LIST_PREFIX}${JSON.stringify(processIds)}\n`)
}

function main() {
  const [mode, ...args] = process.argv.slice(2)
  if (mode === '--console-list') {
    emitConsoleProcessList(args[0], args[1])
    return
  }
  const [channel, fixtureToken, role, resourcesDir, detachedLauncher] = args
  if (mode !== '--member' || !channel || !fixtureToken || !role || !resourcesDir) {
    throw new Error(
      'usage: real-orca-terminal-member --member <channel> <token> <role> <resources> [launcher]'
    )
  }
  connect(channel, fixtureToken, role, resourcesDir, detachedLauncher)
}

module.exports = { createTerminalInputLineBuffer }

if (require.main === module) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`)
    process.exitCode = 1
  }
}
