import type { TuiAgentConfig } from './tui-agent-config'

// Why a separate file: the four roster-scoped CLI wrappers (~/.local/bin/
// rclaude1-2, rcodex, ragy1 -> /home/sang/roster/bin/*, each with its own
// config dir and overlay $HOME) are a host customization, kept out of upstream
// tui-agent-config.ts to avoid merge conflicts. Same pattern as
// sangai-claude-account-agents.ts.
//
// Own ids, not agentCmdOverrides on the stock slots: overrides change which
// binary a slot launches, but the label comes from TUI_AGENT_DISPLAY_NAMES in
// this shared bundle, so both Orca instances on this host would still have read
// "claude1"/"Codex". Distinct ids give each instance its own agent list.
const rosterClaudeConfig = (cmd: string): TuiAgentConfig => ({
  detectCmd: cmd,
  launchCmd: cmd,
  expectedProcess: 'claude',
  promptInjectionMode: 'argv',
  draftPromptFlag: '--prefill'
})

export const ROSTER_AGENT_CONFIGS = {
  rclaude1: rosterClaudeConfig('rclaude1'),
  rclaude2: rosterClaudeConfig('rclaude2'),
  // expectedProcess: the real binary each wrapper execs, not the wrapper name.
  rcodex: {
    detectCmd: 'rcodex',
    launchCmd: 'rcodex',
    expectedProcess: 'codex',
    promptInjectionMode: 'argv',
    preflightTrust: 'codex',
    draftPasteReadySignal: 'codex-composer-prompt',
    draftPasteReadyTimeoutMs: 20_000
  },
  ragy1: {
    detectCmd: 'ragy1',
    launchCmd: 'ragy1',
    expectedProcess: 'agy',
    promptInjectionMode: 'flag-prompt-interactive'
  }
} satisfies Record<'rclaude1' | 'rclaude2' | 'rcodex' | 'ragy1', TuiAgentConfig>
