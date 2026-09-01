import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import {
  createCursorWorkspaceResolver,
  cwdFromCursorIndex,
  encodeCursorProjectDirName,
  guessCursorCwdFromProjectDirName,
  cursorProjectDirNameFromTranscriptPath,
  indexCursorChatsMetas,
  readLocalCursorChatsIndex
} from './session-scanner-cursor-cwd'
import type { AiVaultSession } from '../../shared/ai-vault-types'

function cursorSession(overrides: Partial<AiVaultSession> = {}): AiVaultSession {
  return {
    id: 'local:cursor:sess:/tmp/projects/home-ada-repo/agent-transcripts/sess/sess.jsonl',
    executionHostId: 'local',
    agent: 'cursor',
    sessionId: 'sess',
    title: 'Hello',
    cwd: null,
    branch: null,
    model: null,
    filePath: '/tmp/projects/home-ada-repo/agent-transcripts/sess/sess.jsonl',
    codexHome: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    modifiedAt: '2026-05-01T10:00:00.000Z',
    messageCount: 1,
    totalTokens: null,
    previewMessages: [],
    queuedMessageCount: 0,
    subagentTranscriptCount: 0,
    resumeCommand: "agent --resume 'sess'",
    subagent: null,
    ...overrides
  }
}

describe('encodeCursorProjectDirName', () => {
  it('encodes POSIX paths the way Cursor names project folders', () => {
    expect(encodeCursorProjectDirName('/home/sang/sangai')).toBe('home-sang-sangai')
    expect(encodeCursorProjectDirName('/home/sang/sangai/repos/meeting-companion')).toBe(
      'home-sang-sangai-repos-meeting-companion'
    )
  })

  it('encodes Windows drive paths without the colon', () => {
    expect(encodeCursorProjectDirName('C:/Users/ada/repo')).toBe('C-Users-ada-repo')
  })
})

describe('cursorProjectDirNameFromTranscriptPath', () => {
  it('reads the projects/<name>/agent-transcripts segment', () => {
    expect(
      cursorProjectDirNameFromTranscriptPath(
        '/home/ada/.cursor/projects/home-ada-repo/agent-transcripts/abc/abc.jsonl'
      )
    ).toBe('home-ada-repo')
  })

  it('returns null when the agent-transcripts layout is missing', () => {
    expect(cursorProjectDirNameFromTranscriptPath('/tmp/cursor-session.jsonl')).toBeNull()
  })
})

describe('cwdFromCursorIndex', () => {
  it('prefers session id, then shared project-dir encoding', () => {
    const index = indexCursorChatsMetas([
      { sessionId: 'a', cwd: '/home/ada/repo' },
      { sessionId: 'b', cwd: '/home/ada/other' }
    ])
    expect(
      cwdFromCursorIndex(index, {
        sessionId: 'a',
        projectDirName: 'home-ada-other'
      })
    ).toBe('/home/ada/repo')
    expect(
      cwdFromCursorIndex(index, {
        sessionId: 'missing',
        projectDirName: 'home-ada-other'
      })
    ).toBe('/home/ada/other')
  })
})

describe('guessCursorCwdFromProjectDirName', () => {
  it('reverses simple POSIX encodings', () => {
    expect(guessCursorCwdFromProjectDirName('home-ada-repo')).toBe('/home/ada/repo')
  })
})

describe('createCursorWorkspaceResolver', () => {
  it('fills cwd from chat meta by session id', async () => {
    const resolver = createCursorWorkspaceResolver(async () =>
      indexCursorChatsMetas([{ sessionId: 'sess', cwd: '/home/ada/repo' }])
    )
    const enriched = await resolver.enrich(cursorSession(), '/unused/chats')
    expect(enriched.cwd).toBe('/home/ada/repo')
  })

  it('fills cwd from another session under the same project encoding', async () => {
    const resolver = createCursorWorkspaceResolver(async () =>
      indexCursorChatsMetas([{ sessionId: 'sibling', cwd: '/home/ada/repo' }])
    )
    const enriched = await resolver.enrich(cursorSession({ sessionId: 'orphan' }), '/unused/chats')
    expect(enriched.cwd).toBe('/home/ada/repo')
  })

  it('falls back to an existing path decoded from the project folder name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orcacwdXXXXXX'))
    const workspace = join(root, 'workspace')
    await mkdir(workspace, { recursive: true })
    // Only safe when no path segment contains a hyphen (lossy encode).
    const encoded = encodeCursorProjectDirName(workspace)
    expect(guessCursorCwdFromProjectDirName(encoded)).toBe(workspace)
    const resolver = createCursorWorkspaceResolver(async () => indexCursorChatsMetas([]))
    const enriched = await resolver.enrich(
      cursorSession({
        sessionId: 'no-meta',
        filePath: join('/tmp/projects', encoded, 'agent-transcripts', 'no-meta', 'no-meta.jsonl')
      }),
      join(root, 'empty-chats')
    )
    expect(enriched.cwd).toBe(workspace)
  })

  it('leaves cwd null when nothing resolves', async () => {
    const resolver = createCursorWorkspaceResolver(
      async () => indexCursorChatsMetas([]),
      async () => false
    )
    const enriched = await resolver.enrich(cursorSession(), '/unused/chats')
    expect(enriched.cwd).toBeNull()
  })
})

describe('readLocalCursorChatsIndex', () => {
  it('indexes meta.json cwd values under chats/<hash>/<sessionId>/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orca-cursor-chats-'))
    const sessionDir = join(root, 'abcdef0123456789abcdef0123456789', 'chat-sess-1')
    await mkdir(sessionDir, { recursive: true })
    await writeFile(join(sessionDir, 'meta.json'), JSON.stringify({ cwd: '/home/ada/repo' }))
    const index = await readLocalCursorChatsIndex(root)
    expect(index.bySessionId.get('chat-sess-1')).toBe('/home/ada/repo')
    expect(index.byProjectDirName.get('home-ada-repo')).toBe('/home/ada/repo')
  })
})
