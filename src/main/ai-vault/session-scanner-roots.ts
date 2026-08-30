import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  claudeConfigDirProjectsDir,
  discoverClaudeAccountProjectsDirs
} from './claude-account-projects-dirs'
import { normalizeAgentSessionsDir } from './session-scanner-values'

// The default local root for the agent whose subagent transcripts are read back
// by renderer-supplied path alongside Claude. Discovery scans these; the IPC
// listers use the root enumerations below to reject arbitrary paths. Claude's
// roots are computed per call (see claudeProjectsRootDirs) because a host can
// run several accounts, each with its own config dir.
export const OMP_SESSIONS_DIR = normalizeAgentSessionsDir(
  process.env.OMP_CODING_AGENT_DIR?.trim() || join(homedir(), '.omp', 'agent', 'sessions'),
  '.omp'
)

// The local host's Claude projects roots plus each WSL distro's `~/.claude/projects`.
// Callers reading Claude session files by path use these roots to reject arbitrary paths.
//
// Why more than `~/.claude/projects`: a host that runs several Claude accounts gives
// each one its own CLAUDE_CONFIG_DIR (the `claude1` / `claude2` wrapper pattern), and
// every account keeps a separate `<config dir>/projects` tree. Scanning only the default
// dir hid those sessions — and the `subagents/` transcripts beneath them — entirely.
//
// An explicit `claudeProjectsDir` stays authoritative and suppresses host discovery: it is
// how a scan is pinned to a fixture tree, and folding real accounts in would break that.
// Discovery is local-home only; WSL homes contribute their default root as before, since
// walking a UNC home to enumerate account dirs is exactly the kind of stall the WSL
// transcript gate exists to avoid.
export function claudeProjectsRootDirs(args: {
  claudeProjectsDir?: string
  wslHomeDirs?: readonly string[]
  homeDir?: string
  env?: Record<string, string | undefined>
}): string[] {
  const wslRootDirs = normalizedWslHomeDirs(args.wslHomeDirs).map((homeDir) =>
    join(homeDir, '.claude', 'projects')
  )
  if (args.claudeProjectsDir !== undefined) {
    return dedupeRootDirs([args.claudeProjectsDir, ...wslRootDirs])
  }
  const localHomeDir = args.homeDir ?? homedir()
  const configuredDir = claudeConfigDirProjectsDir(args.env ?? process.env)
  return dedupeRootDirs([
    join(localHomeDir, '.claude', 'projects'),
    ...(configuredDir ? [configuredDir] : []),
    ...discoverClaudeAccountProjectsDirs(localHomeDir),
    ...wslRootDirs
  ])
}

// Why: the same tree can be named twice (CLAUDE_CONFIG_DIR pointing at an account dir
// that discovery also finds). A duplicated root would double every session it holds.
function dedupeRootDirs(rootDirs: readonly string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const rootDir of rootDirs) {
    if (seen.has(rootDir)) {
      continue
    }
    seen.add(rootDir)
    unique.push(rootDir)
  }
  return unique
}

// The local host and each WSL distro's OMP sessions root. Callers reading OMP
// session files by path use these roots to reject arbitrary paths.
export function ompSessionsRootDirs(args: {
  ompSessionsDir?: string
  wslHomeDirs?: readonly string[]
}): string[] {
  return (
    sessionRootDirs(
      args.ompSessionsDir ?? OMP_SESSIONS_DIR,
      normalizedWslHomeDirs(args.wslHomeDirs),
      ['.omp', 'agent', 'sessions']
    )
      // Why: OMP_CODING_AGENT_DIR='/' normalizes to '', which resolve()s to the
      // process cwd — an empty root would silently allowlist it.
      .filter((rootDir) => rootDir.trim().length > 0)
  )
}

export function normalizedWslHomeDirs(homeDirs: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const homeDir of homeDirs ?? []) {
    const trimmed = homeDir.trim()
    if (!trimmed || seen.has(trimmed)) {
      continue
    }
    seen.add(trimmed)
    unique.push(trimmed)
  }
  return unique
}

export function sessionRootDirs(
  hostRootDir: string,
  wslHomeDirs: readonly string[],
  segments: readonly string[]
): string[] {
  return [hostRootDir, ...wslHomeDirs.map((homeDir) => join(homeDir, ...segments))]
}
