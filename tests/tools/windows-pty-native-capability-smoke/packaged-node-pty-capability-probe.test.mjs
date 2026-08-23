import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const probePath = require.resolve('./packaged-node-pty-capability-probe.cjs')
const { buildDetachedGrandchildLaunch } = require(probePath)
const originalSystemRoot = process.env.SystemRoot

afterEach(() => {
  if (originalSystemRoot === undefined) {
    delete process.env.SystemRoot
  } else {
    process.env.SystemRoot = originalSystemRoot
  }
})

describe('packaged node-pty detached launcher', () => {
  it('uses the hidden WScript launcher without cmd or start/b', () => {
    process.env.SystemRoot = 'C:\\Windows'
    const channel = '\\\\.\\pipe\\fixture & literal'

    const launch = buildDetachedGrandchildLaunch(channel, 'fixture-token^literal')

    expect(launch.program).toMatch(/wscript\.exe$/i)
    expect(launch.args).toEqual([
      expect.stringMatching(/real-orca-detached-launcher\.vbs$/),
      process.execPath,
      probePath,
      '--detached-member',
      channel,
      'fixture-token^literal',
      'target-grandchild'
    ])
    expect(JSON.stringify(launch)).not.toMatch(/cmd\.exe|start "" \/b/i)
  })
})
