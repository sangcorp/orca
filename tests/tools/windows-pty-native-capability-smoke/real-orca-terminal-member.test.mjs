import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createTerminalInputLineBuffer } = require('./real-orca-terminal-member.cjs')

describe('real Orca terminal member input framing', () => {
  it('waits for a full line across split PTY chunks', () => {
    const lines = []
    const accept = createTerminalInputLineBuffer((line) => lines.push(line))

    accept('orca-re')
    accept('start-marker')
    expect(lines).toEqual([])

    accept('\r')
    expect(lines).toEqual(['orca-restart-marker'])
  })

  it('emits complete nonempty CRLF and LF records once', () => {
    const lines = []
    const accept = createTerminalInputLineBuffer((line) => lines.push(line))

    accept('first\r\nsecond\n')

    expect(lines).toEqual(['first', 'second'])
  })
})
