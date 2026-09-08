import { z } from 'zod'
import { normalizeDisabledTuiAgents } from '../../../../shared/tui-agent-selection'
import { defineMethod, type RpcMethod } from '../core'
import {
  detectRemoteAgents,
  detectRemoteWindowsTerminalCapabilities,
  detectInstalledAgentsWithShellPathHydration,
  refreshShellPathAndDetectAgents,
  runPreflightCheck
} from '../../../preflight/agent-detection'

// Why: the default agent and the disabled list are CLIENT preferences, so a paired
// client (web, mobile) arrives with its own — usually empty — and would be offered
// every agent CLI on the host's PATH, including another workspace's wrappers. The
// host profile is the workspace's own answer to "which agents does this workspace
// use", so it bounds what any client can see.
function keepProfileEnabled(
  agents: string[],
  runtime: { getClientSettings?: () => unknown }
): string[] {
  const settings = runtime.getClientSettings?.() as { disabledTuiAgents?: unknown } | undefined
  const disabled = new Set<string>(normalizeDisabledTuiAgents(settings?.disabledTuiAgents))
  return disabled.size === 0 ? agents : agents.filter((agent) => !disabled.has(agent))
}

const PreflightCheck = z.object({
  force: z.boolean().optional()
})
const PreflightDetectRemoteAgents = z.object({
  connectionId: z.string().min(1)
})
const PreflightDetectRemoteWindowsTerminalCapabilities = z.object({
  connectionId: z.string().min(1)
})

export const PREFLIGHT_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'preflight.check',
    params: PreflightCheck,
    handler: async (params) => runPreflightCheck(params.force)
  }),
  defineMethod({
    name: 'preflight.detectAgents',
    params: null,
    handler: async (_params, { runtime }) =>
      keepProfileEnabled(await detectInstalledAgentsWithShellPathHydration(), runtime)
  }),
  defineMethod({
    name: 'preflight.detectRemoteAgents',
    params: PreflightDetectRemoteAgents,
    handler: async (params) => detectRemoteAgents(params)
  }),
  defineMethod({
    name: 'preflight.detectRemoteWindowsTerminalCapabilities',
    params: PreflightDetectRemoteWindowsTerminalCapabilities,
    handler: async (params) => detectRemoteWindowsTerminalCapabilities(params)
  }),
  defineMethod({
    name: 'preflight.refreshAgents',
    params: null,
    handler: async (_params, { runtime }) => {
      const result = await refreshShellPathAndDetectAgents()
      return { ...result, agents: keepProfileEnabled(result.agents, runtime) }
    }
  })
]
