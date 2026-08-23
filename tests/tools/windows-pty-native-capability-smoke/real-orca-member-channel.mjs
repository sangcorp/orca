import net from 'node:net'
import { randomUUID } from 'node:crypto'

const ROLES = new Set(['target-command', 'target-grandchild', 'canary-command'])

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function withDeadline(promise, label, timeoutMs = 60_000) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs)
      timer.unref?.()
    })
  ]).finally(() => clearTimeout(timer))
}

export function createRealOrcaMemberChannel(fixtureToken) {
  const channel = `\\\\.\\pipe\\orca-real-pty-${fixtureToken}`
  const events = new Map()
  const sockets = new Map()
  const acceptedSockets = new Set()
  const closed = new Map()
  const fatal = deferred()
  fatal.promise.catch(() => {})
  let fatalError = null
  let serverClosed = false

  function fail(error) {
    if (fatalError) {
      return
    }
    fatalError = error instanceof Error ? error : new Error(String(error))
    fatal.reject(fatalError)
  }

  function eventFor(key) {
    const existing = events.get(key)
    if (existing) {
      return existing
    }
    const created = deferred()
    events.set(key, created)
    return created
  }

  function closeFor(role) {
    const existing = closed.get(role)
    if (existing) {
      return existing
    }
    const created = deferred()
    closed.set(role, created)
    return created
  }

  function acceptMessage(socket, message) {
    if (
      message?.fixtureToken !== fixtureToken ||
      message?.channel !== channel ||
      !ROLES.has(message?.role) ||
      typeof message?.type !== 'string'
    ) {
      throw new Error('member message did not match its token, channel, role, and type')
    }
    if (message.type === 'ready') {
      if (socket.memberRole || sockets.has(message.role)) {
        throw new Error(`duplicate member role: ${message.role}`)
      }
      sockets.set(message.role, socket)
      socket.memberRole = message.role
      socket.once('close', () => closeFor(message.role).resolve(true))
    } else if (socket.memberRole !== message.role) {
      throw new Error('member socket sent an event for a role it did not register')
    }
    const key = `${message.role}:${message.type}:${message.requestId ?? ''}`
    eventFor(key).resolve(message)
  }

  const server = net.createServer((socket) => {
    let pending = ''
    acceptedSockets.add(socket)
    socket.setEncoding('utf8')
    socket.once('close', () => acceptedSockets.delete(socket))
    socket.on('error', (error) => {
      if (!socket.memberRole) {
        fail(error)
      }
    })
    socket.on('data', (chunk) => {
      try {
        pending += String(chunk)
        for (;;) {
          const newline = pending.indexOf('\n')
          if (newline === -1) {
            return
          }
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          if (line) {
            acceptMessage(socket, JSON.parse(line))
          }
        }
      } catch (error) {
        fail(error)
        socket.destroy()
      }
    })
  })
  const listening = new Promise((resolve, reject) => {
    const startupError = (error) => {
      fail(error)
      reject(error)
    }
    server.once('error', startupError)
    server.listen(channel, () => {
      server.off('error', startupError)
      server.on('error', fail)
      resolve()
    })
  })

  async function waitFor(role, type, requestId = '') {
    if (fatalError) {
      throw fatalError
    }
    return await withDeadline(
      Promise.race([eventFor(`${role}:${type}:${requestId}`).promise, fatal.promise]),
      `${role}:${type}`
    )
  }

  async function requestMessage(role, type) {
    if (fatalError) {
      throw fatalError
    }
    const socket = sockets.get(role)
    if (!socket || socket.destroyed) {
      throw new Error(`${role} fixture socket is unavailable`)
    }
    const requestId = randomUUID()
    const reply = waitFor(role, `${type}-ack`, requestId)
    socket.write(`${JSON.stringify({ type, requestId })}\n`)
    return await reply
  }

  async function request(role, type) {
    await requestMessage(role, type)
    return true
  }

  async function shutdown(role) {
    const socket = sockets.get(role)
    if (!socket) {
      return false
    }
    if (fatalError) {
      socket.destroy()
      await withDeadline(closeFor(role).promise, `${role}:fatal-close`, 5_000)
      return true
    }
    if (!socket.destroyed) {
      try {
        await request(role, 'shutdown')
      } catch (requestError) {
        try {
          await withDeadline(closeFor(role).promise, `${role}:close`)
          return true
        } catch (closeError) {
          throw new AggregateError(
            [requestError, closeError],
            `${role} fixture shutdown could not prove socket closure`
          )
        }
      }
    }
    await withDeadline(closeFor(role).promise, `${role}:close`)
    return true
  }

  async function close() {
    if (serverClosed) {
      return
    }
    serverClosed = true
    for (const socket of acceptedSockets) {
      socket.destroy()
    }
    if (!server.listening) {
      return
    }
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  return {
    channel,
    listening,
    waitFor,
    request,
    requestMessage,
    shutdown,
    waitForClose: (role) => withDeadline(closeFor(role).promise, `${role}:close`),
    close
  }
}
