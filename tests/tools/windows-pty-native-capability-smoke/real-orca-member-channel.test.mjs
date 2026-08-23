import net from 'node:net'
import { once } from 'node:events'
import { describe, expect, it } from 'vitest'
import { createRealOrcaMemberChannel } from './real-orca-member-channel.mjs'

async function connect(channel) {
  const socket = net.createConnection(channel)
  socket.on('error', () => {})
  await once(socket, 'connect')
  return socket
}

function message(fixtureToken, channel, role, type) {
  return `${JSON.stringify({ fixtureToken, channel, role, type })}\n`
}

describe('real Orca member channel protocol', () => {
  it('surfaces malformed member data through awaited harness work', async () => {
    const fixtureToken = 'c'.repeat(64)
    const members = createRealOrcaMemberChannel(fixtureToken)
    await members.listening
    const socket = await connect(members.channel)

    socket.write('{not-json}\n')
    await expect(members.waitFor('target-command', 'ready')).rejects.toThrow()
    await members.close()
  })

  it('rejects a registered socket that changes its member role', async () => {
    const fixtureToken = 'd'.repeat(64)
    const members = createRealOrcaMemberChannel(fixtureToken)
    await members.listening
    const socket = await connect(members.channel)
    socket.write(message(fixtureToken, members.channel, 'target-command', 'ready'))
    await members.waitFor('target-command', 'ready')

    socket.write(message(fixtureToken, members.channel, 'canary-command', 'ping-ack'))
    await expect(members.waitFor('canary-command', 'ping-ack')).rejects.toThrow(
      'role it did not register'
    )
    await members.close()
  })

  it('closes another registered role immediately after a protocol fatal', async () => {
    const fixtureToken = 'e'.repeat(64)
    const members = createRealOrcaMemberChannel(fixtureToken)
    await members.listening
    const target = await connect(members.channel)
    const canary = await connect(members.channel)
    target.write(message(fixtureToken, members.channel, 'target-command', 'ready'))
    canary.write(message(fixtureToken, members.channel, 'canary-command', 'ready'))
    await Promise.all([
      members.waitFor('target-command', 'ready'),
      members.waitFor('canary-command', 'ready')
    ])

    canary.write(message(fixtureToken, members.channel, 'target-grandchild', 'ping-ack'))
    await expect(members.waitFor('target-grandchild', 'ping-ack')).rejects.toThrow(
      'role it did not register'
    )
    const targetClosed = once(target, 'close')
    await members.shutdown('target-command')
    await targetClosed
    await members.close()
  })
})
