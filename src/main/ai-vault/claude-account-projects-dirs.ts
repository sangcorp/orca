import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Claude Code keeps its transcripts under `<config dir>/projects`, and the
 * config dir is `~/.claude` only for the default account. A host running more
 * than one account points each extra one at its own config dir via
 * `CLAUDE_CONFIG_DIR` (the `claude1` / `claude2` wrapper pattern), so those
 * sessions — and the `subagents/` transcripts beneath them — are invisible to a
 * scanner that knows about `~/.claude` alone.
 *
 * These helpers enumerate the extra roots. They are used both to DISCOVER
 * sessions and to ACCEPT renderer-supplied paths, so the shape stays deliberately
 * strict: only a `.claude-<account>` dir under home whose `projects` entry is
 * really a directory qualifies.
 */

// Why: `.claude-*`, not `.claude*` — the latter also matches `~/.claude` itself
// (already a root) and `~/.claude.json` (a file).
const CLAUDE_ACCOUNT_DIR_PATTERN = /^\.claude-[A-Za-z0-9._-]+$/

const PROJECTS_DIR_NAME = 'projects'

// Why: the roots are consulted per scan and per subagent-list request. A newly
// created account dir should not need an app restart, so cache briefly rather
// than forever, and key by home dir so WSL/test homes cannot share an entry.
const DISCOVERY_CACHE_TTL_MS = 60_000

type DiscoveryCacheEntry = { readAt: number; dirs: string[] }

const discoveryCache = new Map<string, DiscoveryCacheEntry>()

/** Pure name filter, split out so the directory-shape rule is testable without
 *  a filesystem. Sorted so root order is stable across hosts. */
export function claudeAccountDirNames(entryNames: readonly string[]): string[] {
  return entryNames.filter((name) => CLAUDE_ACCOUNT_DIR_PATTERN.test(name)).sort()
}

/** The projects tree of an explicitly configured `CLAUDE_CONFIG_DIR`, when set.
 *  Treated as a single path: Claude Code reads one config dir, and splitting on
 *  a separator would corrupt a legitimate path that contains one. */
export function claudeConfigDirProjectsDir(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim()
  return configDir ? join(configDir, PROJECTS_DIR_NAME) : undefined
}

/** Every `.claude-<account>` dir under `homeDir` whose `projects` entry exists
 *  as a directory. Best-effort:
 *  an unreadable home is not an error, it just contributes no extra roots. */
export function discoverClaudeAccountProjectsDirs(homeDir: string): string[] {
  const cached = discoveryCache.get(homeDir)
  const now = Date.now()
  if (cached && now - cached.readAt < DISCOVERY_CACHE_TTL_MS) {
    return cached.dirs
  }
  let entryNames: string[]
  try {
    entryNames = readdirSync(homeDir)
  } catch {
    entryNames = []
  }
  const dirs: string[] = []
  for (const name of claudeAccountDirNames(entryNames)) {
    const projectsDir = join(homeDir, name, PROJECTS_DIR_NAME)
    try {
      // statSync, not lstatSync: an adopted/relocated home is a symlink and must
      // still resolve to its real projects tree.
      if (statSync(projectsDir).isDirectory()) {
        dirs.push(projectsDir)
      }
    } catch {
      // No projects tree — some other tool's `.claude-*` state, not an account.
    }
  }
  discoveryCache.set(homeDir, { readAt: now, dirs })
  return dirs
}

export const _internals = {
  resetCache: (): void => {
    discoveryCache.clear()
  }
}
