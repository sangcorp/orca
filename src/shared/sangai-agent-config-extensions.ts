// Why a separate file: a single re-export point for sangai's per-provider
// TUI agent config extensions (sangai-claude-account-agents.ts,
// sangai-antigravity-instance-agents.ts, ...), so tui-agent-config.ts only
// pays a one-line import cost per addition instead of one import per file —
// that file is already at oxlint's 300-line budget for upstream stablyai/orca
// content and every extra sangai import line eats into it.
export { SANGAI_CLAUDE_ACCOUNT_CONFIGS } from './sangai-claude-account-agents'
export { SANGAI_ANTIGRAVITY_INSTANCE_CONFIGS } from './sangai-antigravity-instance-agents'
