import { AGENT_STATUS_MAX_SUBAGENTS } from './agent-status-types'

/**
 * Subagent lifecycle for agents that never announce it.
 *
 * Claude, Codex and Cursor emit dedicated SubagentStart/SubagentStop hook events
 * carrying a provider-assigned child id, so their rosters are driven by those
 * events and are authoritative. The remaining agents that CAN spawn children
 * expose that fact only as an ordinary tool call, so their roster is derived
 * here from the tool name plus its arguments.
 *
 * Agents with native events are deliberately absent from the table below:
 * deriving a second row from their tool calls would double-count every child.
 */

const SUBAGENT_SPAWN_TOOLS: Readonly<Record<string, readonly string[]>> = {
  // `invoke_subagent` is the general spawn; `browser_subagent` is the browsing
  // specialisation. Both run a child agent to completion inside the tool call.
  antigravity: ['invoke_subagent', 'browser_subagent'],
  // One `delegate_task` call fans out a whole `tasks` array, so it can spawn
  // several children at once.
  hermes: ['delegate_task'],
  opencode: ['task'],
  'mimo-code': ['task']
}

export type DerivedSubagentSpawn = {
  id: string
  agentType?: string
  description?: string
}

export function isSubagentSpawnTool(agent: string, toolName: string | undefined): boolean {
  if (!toolName) {
    return false
  }
  return SUBAGENT_SPAWN_TOOLS[agent]?.includes(toolName) === true
}

/**
 * The children one spawn-tool call represents. Returns an empty list for any
 * tool that does not spawn subagents, so callers can pass every tool event
 * through without pre-filtering.
 *
 * `callId` is the provider's tool-call id when it has one. Antigravity's hook
 * payload documents `toolCall` as `{name, args}` with no id, so those spawns
 * fall back to a name-derived key: two concurrent children of the same name
 * collapse into one row rather than leaking an unmatched row forever.
 */
export function deriveSubagentSpawns(
  agent: string,
  toolName: string | undefined,
  callId: string | undefined,
  args: unknown
): DerivedSubagentSpawn[] {
  if (!toolName || !isSubagentSpawnTool(agent, toolName)) {
    return []
  }
  const argRecord = asRecord(args)
  const tasks = readTaskList(argRecord)
  if (tasks.length > 0) {
    return tasks.slice(0, AGENT_STATUS_MAX_SUBAGENTS).map((task, index) => {
      const taskRecord = asRecord(task)
      return {
        // Why: a fanned-out call shares one tool-call id, so the index is what
        // keeps sibling children distinct.
        id: `${spawnKeyBase(toolName, callId, taskRecord, argRecord)}#${index}`,
        agentType:
          readFirstString(taskRecord, AGENT_TYPE_KEYS) ??
          readFirstString(argRecord, AGENT_TYPE_KEYS),
        description: readFirstString(taskRecord, DESCRIPTION_KEYS)
      }
    })
  }
  return [
    {
      id: spawnKeyBase(toolName, callId, argRecord, argRecord),
      agentType: readFirstString(argRecord, AGENT_TYPE_KEYS),
      description: readFirstString(argRecord, DESCRIPTION_KEYS)
    }
  ]
}

// Ordered most- to least-specific: the child's own identity first, then whatever
// the parent labelled the call with.
const AGENT_TYPE_KEYS = [
  'subagent_type',
  'subagentType',
  'subagent_name',
  'subagentName',
  'agent_type',
  'agentType',
  'role',
  'name'
] as const

const DESCRIPTION_KEYS = [
  'description',
  'goal',
  'task',
  'Task',
  'prompt',
  'Prompt',
  'instructions'
] as const

const TASK_LIST_KEYS = ['tasks', 'subagents'] as const

function spawnKeyBase(
  toolName: string,
  callId: string | undefined,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
): string {
  const trimmedCallId = callId?.trim()
  if (trimmedCallId) {
    return trimmedCallId
  }
  const label =
    readFirstString(primary, AGENT_TYPE_KEYS) ?? readFirstString(fallback, AGENT_TYPE_KEYS)
  return label ? `${toolName}:${label}` : toolName
}

function readTaskList(args: Record<string, unknown>): unknown[] {
  for (const key of TASK_LIST_KEYS) {
    const value = args[key]
    if (Array.isArray(value) && value.length > 0) {
      return value
    }
  }
  return []
}

function readFirstString(
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
