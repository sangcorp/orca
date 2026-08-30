import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claudeAccountDirNames,
  claudeConfigDirProjectsDir,
  discoverClaudeAccountProjectsDirs,
  _internals
} from './claude-account-projects-dirs'

describe('claudeAccountDirNames', () => {
  it('keeps additional-account config dirs and drops the default and unrelated ones', () => {
    expect(
      claudeAccountDirNames([
        '.claude',
        '.claude-account-1',
        '.claude-account-2',
        '.claude-code-ui',
        '.claude.json',
        '.codex',
        'Documents'
      ])
    ).toEqual(['.claude-account-1', '.claude-account-2', '.claude-code-ui'])
  })

  it('sorts so root order is stable across hosts', () => {
    expect(claudeAccountDirNames(['.claude-b', '.claude-a'])).toEqual(['.claude-a', '.claude-b'])
  })
})

describe('claudeConfigDirProjectsDir', () => {
  it('resolves CLAUDE_CONFIG_DIR to its projects tree', () => {
    expect(claudeConfigDirProjectsDir({ CLAUDE_CONFIG_DIR: '/home/ada/.claude-account-2' })).toBe(
      join('/home/ada/.claude-account-2', 'projects')
    )
  })

  it('ignores an unset or blank value', () => {
    expect(claudeConfigDirProjectsDir({})).toBeUndefined()
    expect(claudeConfigDirProjectsDir({ CLAUDE_CONFIG_DIR: '   ' })).toBeUndefined()
  })
})

describe('discoverClaudeAccountProjectsDirs', () => {
  let home: string

  beforeEach(() => {
    _internals.resetCache()
    home = mkdtempSync(join(tmpdir(), 'orca-claude-accounts-'))
  })

  afterEach(() => {
    _internals.resetCache()
    rmSync(home, { recursive: true, force: true })
  })

  it('finds each additional account that actually has a projects tree', () => {
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true })
    mkdirSync(join(home, '.claude-account-1', 'projects'), { recursive: true })
    mkdirSync(join(home, '.claude-account-2', 'projects'), { recursive: true })
    // Why: a `.claude-*` dir without a projects tree is some other tool's state
    // (e.g. `.claude-code-ui`), not an account — including it would allowlist an
    // arbitrary directory for renderer-supplied subagent paths.
    mkdirSync(join(home, '.claude-code-ui', 'plugins'), { recursive: true })

    expect(discoverClaudeAccountProjectsDirs(home)).toEqual([
      join(home, '.claude-account-1', 'projects'),
      join(home, '.claude-account-2', 'projects')
    ])
  })

  it('follows a symlinked account dir, which is how relocated homes are wired', () => {
    const real = join(home, 'relocated')
    mkdirSync(join(real, 'projects'), { recursive: true })
    symlinkSync(real, join(home, '.claude-account-9'))

    expect(discoverClaudeAccountProjectsDirs(home)).toEqual([
      join(home, '.claude-account-9', 'projects')
    ])
  })

  it('ignores a projects path that is a file rather than a directory', () => {
    mkdirSync(join(home, '.claude-account-3'), { recursive: true })
    writeFileSync(join(home, '.claude-account-3', 'projects'), 'not a dir')

    expect(discoverClaudeAccountProjectsDirs(home)).toEqual([])
  })

  it('returns empty rather than throwing when the home dir is unreadable', () => {
    expect(discoverClaudeAccountProjectsDirs(join(home, 'missing'))).toEqual([])
  })
})
