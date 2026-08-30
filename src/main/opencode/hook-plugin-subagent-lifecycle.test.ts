import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { getPathMock } = vi.hoisted(() => ({
  getPathMock: vi.fn<(name: string) => string>()
}))

vi.mock('electron', () => ({ app: { getPath: getPathMock } }))

import { _internals } from './hook-service'

/**
 * OpenCode spawns children with the `task` tool and emits no subagent lifecycle
 * event of its own, so the managed plugin reports that one tool's boundaries as
 * SubagentStart / SubagentStop. Scoped to the spawn tool on purpose: opencode's
 * status stream is deliberately throttled and a general per-tool event would
 * turn it into a firehose.
 */
describe('OpenCode status plugin subagent lifecycle', () => {
  type ToolHook = (
    input: { tool?: string; sessionID?: string; callID?: string; args?: unknown },
    output?: { args?: unknown }
  ) => Promise<void>
  type PluginHooks = {
    event: (input: { event: unknown }) => Promise<void>
    'tool.execute.before'?: ToolHook
    'tool.execute.after'?: ToolHook
  }
  type PluginModule = {
    default?: { server?: (ctx: unknown) => Promise<PluginHooks> }
  }

  const ENV_KEYS = [
    'ORCA_PANE_KEY',
    'ORCA_AGENT_HOOK_ENDPOINT',
    'ORCA_AGENT_HOOK_PORT',
    'ORCA_AGENT_HOOK_TOKEN'
  ] as const

  let tempDir: string
  let savedFetch: typeof globalThis.fetch
  let savedEnv: Record<string, string | undefined>
  let posts: { hookEventName: unknown; payload: Record<string, unknown> }[]

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'orca-opencode-subagent-'))
    savedFetch = globalThis.fetch
    savedEnv = {}
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
    delete process.env.ORCA_AGENT_HOOK_ENDPOINT
    process.env.ORCA_AGENT_HOOK_PORT = '59999'
    process.env.ORCA_AGENT_HOOK_TOKEN = 'test-token'
    process.env.ORCA_PANE_KEY = 'tab-1:leaf-1'
    posts = []
    globalThis.fetch = vi.fn(async (_input: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        payload?: Record<string, unknown>
      }
      posts.push({
        hookEventName: body.payload?.hook_event_name,
        payload: body.payload ?? {}
      })
      return { ok: true } as Response
    }) as unknown as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = savedFetch
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  async function loadHooks(): Promise<PluginHooks | undefined> {
    const pluginPath = join(
      tempDir,
      `orca-opencode-status-${Math.random().toString(36).slice(2)}.mjs`
    )
    writeFileSync(pluginPath, _internals.getOpenCodePluginSource())
    const module = (await import(pathToFileURL(pluginPath).href)) as PluginModule
    return module.default?.server?.({
      client: {
        session: { get: async () => ({ data: { id: 'ses_root', parentID: undefined } }) }
      }
    })
  }

  it('exposes both tool-execution hooks OpenCode calls', async () => {
    const hooks = await loadHooks()
    expect(hooks?.['tool.execute.before']).toBeTypeOf('function')
    expect(hooks?.['tool.execute.after']).toBeTypeOf('function')
  })

  it('reports the task tool as a subagent start carrying its identity', async () => {
    const hooks = await loadHooks()

    await hooks?.['tool.execute.before']?.(
      { tool: 'task', sessionID: 'ses_root', callID: 'call-1' },
      { args: { subagent_type: 'reviewer', description: 'Review the diff' } }
    )

    const start = posts.find((post) => post.hookEventName === 'SubagentStart')
    expect(start).toBeDefined()
    expect(start?.payload.tool).toBe('task')
    expect(start?.payload.callID).toBe('call-1')
    expect(start?.payload.args).toEqual({
      subagent_type: 'reviewer',
      description: 'Review the diff'
    })
  })

  it('reports the matching stop when the task tool returns', async () => {
    const hooks = await loadHooks()

    await hooks?.['tool.execute.after']?.({
      tool: 'task',
      sessionID: 'ses_root',
      callID: 'call-1',
      args: { subagent_type: 'reviewer' }
    })

    const stop = posts.find((post) => post.hookEventName === 'SubagentStop')
    expect(stop).toBeDefined()
    expect(stop?.payload.callID).toBe('call-1')
  })

  it('stays silent for every other tool', async () => {
    const hooks = await loadHooks()

    await hooks?.['tool.execute.before']?.(
      { tool: 'bash', sessionID: 'ses_root', callID: 'call-2' },
      { args: { command: 'ls' } }
    )
    await hooks?.['tool.execute.after']?.({
      tool: 'bash',
      sessionID: 'ses_root',
      callID: 'call-2',
      args: { command: 'ls' }
    })

    expect(posts).toEqual([])
  })

  it('tolerates a missing argument bag rather than throwing into OpenCode', async () => {
    const hooks = await loadHooks()

    await expect(
      hooks?.['tool.execute.before']?.({ tool: 'task', callID: 'call-3' })
    ).resolves.toBeUndefined()
    expect(posts.some((post) => post.hookEventName === 'SubagentStart')).toBe(true)
  })
})
