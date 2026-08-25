import type { TuiAgentConfig } from './tui-agent-config'

// Why a separate file: sangai's three per-account Claude wrappers
// (~/.local/bin/claude1-3 -> bin/claude-instance, each execing the real
// `claude` binary under its own account) are a sangai-only customization,
// kept out of the upstream tui-agent-config.ts to avoid merge conflicts on
// future syncs from stablyai/orca.
const claudeAccountConfig = (cmd: string): TuiAgentConfig => ({
  detectCmd: cmd,
  launchCmd: cmd,
  expectedProcess: 'claude',
  promptInjectionMode: 'argv',
  draftPromptFlag: '--prefill'
})

export const SANGAI_CLAUDE_ACCOUNT_CONFIGS = {
  claude1: claudeAccountConfig('claude1'),
  claude2: claudeAccountConfig('claude2'),
  claude3: claudeAccountConfig('claude3')
} satisfies Record<'claude1' | 'claude2' | 'claude3', TuiAgentConfig>
