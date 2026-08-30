import { beforeEach, describe, expect, it } from 'vitest'
import { createHookListenerState, type HookListenerState } from './agent-hook-listener'
import { normalizeAndAccept } from './agent-hook-listener-test-harness'

describe('subagent rows for agents without a Claude-style roster', () => {
  let state: HookListenerState

  beforeEach(() => {
    state = createHookListenerState()
  })

  describe('hermes', () => {
    const start = (payload: Record<string, unknown>) => normalizeAndAccept(state, 'hermes', payload)

    it('opens a row per delegated task and closes them when the call returns', () => {
      start({ hook_event_name: 'pre_llm_call', user_message: 'plan the migration' })
      const spawned = start({
        hook_event_name: 'pre_tool_call',
        tool_call_id: 'tc-1',
        tool_name: 'delegate_task',
        args: { tasks: [{ goal: 'Audit schema' }, { goal: 'Draft rollback' }] }
      })

      expect(spawned?.payload.subagents).toEqual([
        expect.objectContaining({ id: 'tc-1#0', description: 'Audit schema', state: 'working' }),
        expect.objectContaining({ id: 'tc-1#1', description: 'Draft rollback', state: 'working' })
      ])

      const finished = start({
        hook_event_name: 'post_tool_call',
        tool_call_id: 'tc-1',
        tool_name: 'delegate_task',
        args: { tasks: [{ goal: 'Audit schema' }, { goal: 'Draft rollback' }] }
      })
      expect(finished?.payload.subagents).toBeUndefined()
    })

    it('leaves an ordinary tool call with no subagent rows', () => {
      start({ hook_event_name: 'pre_llm_call', user_message: 'run tests' })
      const event = start({
        hook_event_name: 'pre_tool_call',
        tool_call_id: 'tc-2',
        tool_name: 'run_command',
        args: { command: 'pytest' }
      })
      expect(event?.payload.subagents).toBeUndefined()
    })

    it('drops orphaned children when the turn ends', () => {
      // Why: a spawn tool runs its child inside the call, so a row that outlives
      // the turn is a post-event Orca missed, not a live child.
      start({ hook_event_name: 'pre_llm_call', user_message: 'go' })
      start({
        hook_event_name: 'pre_tool_call',
        tool_call_id: 'tc-3',
        tool_name: 'delegate_task',
        args: { tasks: [{ goal: 'Never returns' }] }
      })
      const done = start({ hook_event_name: 'post_llm_call' })
      expect(done?.payload.state).toBe('done')
      expect(done?.payload.subagents).toBeUndefined()
    })
  })

  describe('antigravity', () => {
    it('tracks invoke_subagent across a call with no tool-call id', () => {
      normalizeAndAccept(state, 'antigravity', { hook_event_name: 'PreInvocation' })
      const spawned = normalizeAndAccept(state, 'antigravity', {
        hook_event_name: 'PreToolUse',
        toolCall: {
          name: 'invoke_subagent',
          args: { subagent_name: 'researcher', task: 'Summarise the RFC' }
        }
      })
      expect(spawned?.payload.subagents).toEqual([
        expect.objectContaining({
          id: 'invoke_subagent:researcher',
          agentType: 'researcher',
          description: 'Summarise the RFC',
          state: 'working'
        })
      ])

      const finished = normalizeAndAccept(state, 'antigravity', {
        hook_event_name: 'PostToolUse',
        toolCall: {
          name: 'invoke_subagent',
          args: { subagent_name: 'researcher', task: 'Summarise the RFC' }
        }
      })
      expect(finished?.payload.subagents).toBeUndefined()
    })
  })

  describe('opencode', () => {
    it('tracks the task tool through the plugin subagent lifecycle events', () => {
      // Why: the plugin reports ONLY the spawn tool's boundaries, not every tool
      // call — opencode's status stream is deliberately throttled, and a general
      // per-tool event would flood it.
      const spawned = normalizeAndAccept(state, 'opencode', {
        hook_event_name: 'SubagentStart',
        tool: 'task',
        callID: 'call-9',
        args: { subagent_type: 'reviewer', description: 'Review the diff' }
      })
      expect(spawned?.payload.subagents).toEqual([
        expect.objectContaining({
          id: 'call-9',
          agentType: 'reviewer',
          description: 'Review the diff',
          state: 'working'
        })
      ])

      const finished = normalizeAndAccept(state, 'opencode', {
        hook_event_name: 'SubagentStop',
        tool: 'task',
        callID: 'call-9',
        args: { subagent_type: 'reviewer', description: 'Review the diff' }
      })
      expect(finished?.payload.subagents).toBeUndefined()
    })

    it('drops children when the session goes idle', () => {
      normalizeAndAccept(state, 'opencode', {
        hook_event_name: 'SubagentStart',
        tool: 'task',
        callID: 'call-10',
        args: { subagent_type: 'reviewer' }
      })
      const idle = normalizeAndAccept(state, 'opencode', { hook_event_name: 'SessionIdle' })
      expect(idle?.payload.state).toBe('done')
      expect(idle?.payload.subagents).toBeUndefined()
    })
  })

  describe('cursor', () => {
    it('uses the provider subagent lifecycle events rather than deriving them', () => {
      normalizeAndAccept(state, 'cursor', {
        hook_event_name: 'beforeSubmitPrompt',
        prompt: 'refactor the parser'
      })
      const spawned = normalizeAndAccept(state, 'cursor', {
        hook_event_name: 'subagentStart',
        subagent_id: 'sa-1',
        subagent_type: 'reviewer',
        subagent_model: 'composer-1',
        task: 'Check the grammar rules'
      })
      expect(spawned?.payload.state).toBe('working')
      expect(spawned?.payload.subagents).toEqual([
        expect.objectContaining({
          id: 'sa-1',
          agentType: 'reviewer',
          model: 'composer-1',
          description: 'Check the grammar rules',
          state: 'working'
        })
      ])

      const finished = normalizeAndAccept(state, 'cursor', {
        hook_event_name: 'subagentStop',
        subagent_id: 'sa-1',
        status: 'completed'
      })
      expect(finished?.payload.subagents).toBeUndefined()
    })

    it('keeps the pane working while a child is still running after stop', () => {
      // Why: cursor emits `stop` for the lead turn; a still-running parallel
      // worker must keep the row alive rather than showing the pane as finished.
      normalizeAndAccept(state, 'cursor', {
        hook_event_name: 'beforeSubmitPrompt',
        prompt: 'refactor'
      })
      normalizeAndAccept(state, 'cursor', {
        hook_event_name: 'subagentStart',
        subagent_id: 'sa-2',
        subagent_type: 'worker'
      })
      const stopped = normalizeAndAccept(state, 'cursor', {
        hook_event_name: 'stop',
        status: 'completed'
      })
      expect(stopped?.payload.state).toBe('working')
      expect(stopped?.payload.subagents).toHaveLength(1)
    })
  })
})
