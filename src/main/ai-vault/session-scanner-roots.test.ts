import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _internals as accountDirInternals } from './claude-account-projects-dirs'
import { claudeProjectsRootDirs, ompSessionsRootDirs } from './session-scanner-roots'

describe('ompSessionsRootDirs', () => {
  it('drops a degenerate root that would resolve to the process cwd', () => {
    // normalizeAgentSessionsDir('/') returns ''. Kept, that root would resolve()
    // to the cwd and allowlist it for renderer-supplied subagent paths.
    expect(ompSessionsRootDirs({ ompSessionsDir: '' })).toEqual([])
    expect(ompSessionsRootDirs({ ompSessionsDir: '   ' })).toEqual([])
  })

  it('keeps the host root and one root per distinct WSL distro home', () => {
    expect(
      ompSessionsRootDirs({
        ompSessionsDir: '/home/ada/.omp/agent/sessions',
        wslHomeDirs: ['/wsl/ubuntu/home/ada', '/wsl/ubuntu/home/ada', '  ']
      })
    ).toEqual([
      '/home/ada/.omp/agent/sessions',
      join('/wsl/ubuntu/home/ada', '.omp', 'agent', 'sessions')
    ])
  })
})

describe('claudeProjectsRootDirs', () => {
  let home: string

  beforeEach(() => {
    accountDirInternals.resetCache()
    home = mkdtempSync(join(tmpdir(), 'orca-claude-roots-'))
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
    mkdirSync(join(home, '.claude-account-1', 'projects'), { recursive: true })
    mkdirSync(join(home, '.claude-account-2', 'projects'), { recursive: true })
  })

  afterEach(() => {
    accountDirInternals.resetCache()
    rmSync(home, { recursive: true, force: true })
  })

  it('covers every additional Claude account, not just the default config dir', () => {
    // Why: `claude1`/`claude2`-style wrappers point each account at its own
    // CLAUDE_CONFIG_DIR, so their sessions (and the subagent transcripts under
    // them) live outside `~/.claude/projects` and were previously unreachable.
    expect(claudeProjectsRootDirs({ homeDir: home, env: {} })).toEqual([
      join(home, '.claude', 'projects'),
      join(home, '.claude-account-1', 'projects'),
      join(home, '.claude-account-2', 'projects')
    ])
  })

  it('includes an explicitly configured CLAUDE_CONFIG_DIR outside home', () => {
    expect(
      claudeProjectsRootDirs({
        homeDir: home,
        env: { CLAUDE_CONFIG_DIR: '/elsewhere/.claude-work' }
      })
    ).toEqual([
      join(home, '.claude', 'projects'),
      join('/elsewhere/.claude-work', 'projects'),
      join(home, '.claude-account-1', 'projects'),
      join(home, '.claude-account-2', 'projects')
    ])
  })

  it('deduplicates when CLAUDE_CONFIG_DIR names a root already discovered', () => {
    expect(
      claudeProjectsRootDirs({
        homeDir: home,
        env: { CLAUDE_CONFIG_DIR: join(home, '.claude-account-1') }
      })
    ).toEqual([
      join(home, '.claude', 'projects'),
      join(home, '.claude-account-1', 'projects'),
      join(home, '.claude-account-2', 'projects')
    ])
  })

  it('keeps an explicit projects-dir override authoritative', () => {
    // Why: the override is how scans are pinned to a fixture tree. Folding the
    // host's real accounts in would break that isolation.
    expect(
      claudeProjectsRootDirs({
        claudeProjectsDir: '/fixture/claude-projects',
        homeDir: home,
        env: { CLAUDE_CONFIG_DIR: join(home, '.claude-account-1') },
        wslHomeDirs: ['/wsl/ubuntu/home/ada']
      })
    ).toEqual(['/fixture/claude-projects', join('/wsl/ubuntu/home/ada', '.claude', 'projects')])
  })

  it('still contributes one root per WSL distro home', () => {
    expect(
      claudeProjectsRootDirs({
        homeDir: home,
        env: {},
        wslHomeDirs: ['/wsl/ubuntu/home/ada', '/wsl/ubuntu/home/ada']
      })
    ).toEqual([
      join(home, '.claude', 'projects'),
      join(home, '.claude-account-1', 'projects'),
      join(home, '.claude-account-2', 'projects'),
      join('/wsl/ubuntu/home/ada', '.claude', 'projects')
    ])
  })
})
