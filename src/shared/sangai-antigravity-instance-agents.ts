import type { TuiAgentConfig } from './tui-agent-config'

// Why a separate file: sangai's two per-instance Antigravity wrappers
// (~/.local/bin/agy1-2 -> bin/agy-instance, each running the real `agy` binary
// under its own overlay $HOME so conversations, settings and MCP config stay
// isolated) are a sangai-only customization, kept out of the upstream
// tui-agent-config.ts to avoid merge conflicts on future syncs from
// stablyai/orca. Same pattern as sangai-claude-account-agents.ts.
//
// `expectedProcess` stays 'agy' rather than the wrapper name: bin/agy-instance
// execs ~/.local/bin/agy-bin, which is exactly what the upstream `antigravity`
// entry already resolves to on this host.
const antigravityInstanceConfig = (cmd: string): TuiAgentConfig => ({
  detectCmd: cmd,
  launchCmd: cmd,
  expectedProcess: 'agy',
  promptInjectionMode: 'flag-prompt-interactive'
})

export const SANGAI_ANTIGRAVITY_INSTANCE_CONFIGS = {
  agy1: antigravityInstanceConfig('agy1'),
  agy2: antigravityInstanceConfig('agy2')
} satisfies Record<'agy1' | 'agy2', TuiAgentConfig>
