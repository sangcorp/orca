import { describe, expect, it } from 'vitest'
import { deriveSubagentSpawns, isSubagentSpawnTool } from './subagent-spawn-tools'

describe('isSubagentSpawnTool', () => {
  it('recognises each agent that only exposes subagents through a tool call', () => {
    expect(isSubagentSpawnTool('hermes', 'delegate_task')).toBe(true)
    expect(isSubagentSpawnTool('antigravity', 'invoke_subagent')).toBe(true)
    expect(isSubagentSpawnTool('antigravity', 'browser_subagent')).toBe(true)
    expect(isSubagentSpawnTool('opencode', 'task')).toBe(true)
  })

  it('ignores ordinary tools and unknown agents', () => {
    expect(isSubagentSpawnTool('hermes', 'run_command')).toBe(false)
    expect(isSubagentSpawnTool('antigravity', 'run_command')).toBe(false)
    expect(isSubagentSpawnTool('opencode', 'bash')).toBe(false)
    expect(isSubagentSpawnTool('cursor', 'task')).toBe(false)
    expect(isSubagentSpawnTool('hermes', undefined)).toBe(false)
  })

  it('leaves agents with dedicated lifecycle events alone', () => {
    // Why: claude, codex and cursor emit SubagentStart/Stop with a provider id.
    // Deriving a second row from their tool calls would double-count every child.
    expect(isSubagentSpawnTool('claude', 'Task')).toBe(false)
    expect(isSubagentSpawnTool('codex', 'task')).toBe(false)
  })
})

describe('deriveSubagentSpawns', () => {
  it('expands one hermes delegate_task call into a row per task', () => {
    expect(
      deriveSubagentSpawns('hermes', 'delegate_task', 'call-7', {
        role: 'leaf',
        tasks: [
          { goal: 'Audit the migration' },
          { goal: 'Draft the rollback', role: 'orchestrator' }
        ]
      })
    ).toEqual([
      { id: 'call-7#0', agentType: 'leaf', description: 'Audit the migration' },
      { id: 'call-7#1', agentType: 'orchestrator', description: 'Draft the rollback' }
    ])
  })

  it('reads the opencode task tool the same way Claude Task is shaped', () => {
    expect(
      deriveSubagentSpawns('opencode', 'task', 'call-1', {
        subagent_type: 'reviewer',
        description: 'Review the diff',
        prompt: 'Look for races'
      })
    ).toEqual([{ id: 'call-1', agentType: 'reviewer', description: 'Review the diff' }])
  })

  it('falls back to the prompt when a task carries no description', () => {
    expect(
      deriveSubagentSpawns('opencode', 'task', 'call-1', { prompt: 'Look for races' })
    ).toEqual([{ id: 'call-1', agentType: undefined, description: 'Look for races' }])
  })

  it('keys an antigravity spawn by name when the hook carries no call id', () => {
    // Why: Antigravity's hook payload documents `toolCall` as {name, args} with no
    // call id, so pre/post pairing falls back to a name-derived key.
    expect(
      deriveSubagentSpawns('antigravity', 'invoke_subagent', undefined, {
        subagent_name: 'researcher',
        task: 'Summarise the RFC'
      })
    ).toEqual([
      {
        id: 'invoke_subagent:researcher',
        agentType: 'researcher',
        description: 'Summarise the RFC'
      }
    ])
  })

  it('still yields one stable row when nothing identifies the child', () => {
    expect(deriveSubagentSpawns('antigravity', 'browser_subagent', undefined, {})).toEqual([
      { id: 'browser_subagent', agentType: undefined, description: undefined }
    ])
  })

  it('yields nothing for a tool that does not spawn subagents', () => {
    expect(deriveSubagentSpawns('hermes', 'run_command', 'call-1', {})).toEqual([])
  })

  it('caps a runaway task list so one call cannot fill the roster', () => {
    const tasks = Array.from({ length: 64 }, (_, index) => ({ goal: `task ${index}` }))
    expect(deriveSubagentSpawns('hermes', 'delegate_task', 'call-1', { tasks })).toHaveLength(32)
  })

  it('treats a non-object argument bag as no arguments', () => {
    expect(deriveSubagentSpawns('opencode', 'task', 'call-1', 'not an object')).toEqual([
      { id: 'call-1', agentType: undefined, description: undefined }
    ])
  })
})
