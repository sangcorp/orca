import type { AgentCatalogEntry } from './agent-catalog'

// Catalog entries for the four roster-scoped CLI wrappers, kept out of
// agent-catalog.tsx for the same reason as roster-agent-configs.ts: they are a
// host customization, and the catalog file is at its max-lines budget.
export const ROSTER_AGENT_CATALOG: AgentCatalogEntry[] = [
  {
    id: 'rclaude1',
    label: 'rclaude1',
    cmd: 'rclaude1',
    homepageUrl: 'https://code.claude.com/docs'
  },
  {
    id: 'rclaude2',
    label: 'rclaude2',
    cmd: 'rclaude2',
    homepageUrl: 'https://code.claude.com/docs'
  },
  {
    id: 'rcodex',
    label: 'rcodex',
    cmd: 'rcodex',
    homepageUrl: 'https://developers.openai.com/codex/cli'
  },
  {
    id: 'ragy1',
    label: 'ragy1',
    cmd: 'ragy1',
    faviconDomain: 'antigravity.google',
    homepageUrl: 'https://antigravity.google/docs/cli-overview'
  }
]
