import { access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { AiVaultSession } from '../../shared/ai-vault-types'
import { wslGatedReaddir } from '../native-chat/wsl-transcript-fs-access'
import { WslTranscriptFsError } from '../native-chat/wsl-transcript-fs-gate'
import { extractString, readJsonObjectIfExists } from './session-scanner-values'

const DEFAULT_CURSOR_CHATS_DIR = join(homedir(), '.cursor', 'chats')

export type CursorCwdIndex = {
  bySessionId: Map<string, string>
  byProjectDirName: Map<string, string>
}

export type CursorWorkspaceResolver = {
  enrich(session: AiVaultSession, chatsDir: string): Promise<AiVaultSession>
}

/**
 * Cursor stores agent transcripts under `~/.cursor/projects/<encoded>/…` with
 * no cwd in the JSONL. The real workspace lives in `~/.cursor/chats/<md5>/
 * <sessionId>/meta.json` (`cwd`). Encoding is strip a leading `/` (or Windows
 * drive colon) and replace path separators with `-` — lossy when a segment
 * itself contains hyphens, so chat meta is authoritative.
 */
export function encodeCursorProjectDirName(cwd: string): string {
  const normalized = cwd.trim().replace(/\\/g, '/')
  if (!normalized) {
    return ''
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.replace(/:/, '').replace(/\//g, '-')
  }
  return normalized.replace(/^\//, '').replace(/\//g, '-')
}

export function cursorProjectDirNameFromTranscriptPath(filePath: string): string | null {
  const segments = filePath.split(/[\\/]+/).filter(Boolean)
  const projectsIndex = segments.indexOf('projects')
  const transcriptsIndex = segments.indexOf('agent-transcripts')
  if (projectsIndex < 0 || transcriptsIndex !== projectsIndex + 2) {
    return null
  }
  return segments[projectsIndex + 1] ?? null
}

export function cursorChatsDirFromProjectsDir(projectsDir: string): string {
  return join(dirname(projectsDir), 'chats')
}

export function resolveCursorChatsDir(override?: string, projectsDir?: string): string {
  if (override?.trim()) {
    return override.trim()
  }
  if (projectsDir?.trim()) {
    return cursorChatsDirFromProjectsDir(projectsDir.trim())
  }
  return DEFAULT_CURSOR_CHATS_DIR
}

/**
 * Lossy reverse of `encodeCursorProjectDirName`. Only safe when the resulting
 * path actually exists on disk — hyphenated segments (e.g. `meeting-companion`)
 * decode incorrectly.
 */
export function guessCursorCwdFromProjectDirName(projectDirName: string): string | null {
  const name = projectDirName.trim()
  if (!name) {
    return null
  }
  if (/^[A-Za-z]-/.test(name)) {
    const drive = name[0]
    const rest = name.slice(2).replace(/-/g, '\\')
    return `${drive}:\\${rest}`
  }
  return `/${name.replace(/-/g, '/')}`
}

export function cwdFromCursorIndex(
  index: CursorCwdIndex,
  args: { sessionId: string; projectDirName: string | null }
): string | null {
  const bySession = index.bySessionId.get(args.sessionId)
  if (bySession) {
    return bySession
  }
  if (args.projectDirName) {
    return index.byProjectDirName.get(args.projectDirName) ?? null
  }
  return null
}

export function indexCursorChatsMetas(
  metas: ReadonlyArray<{ sessionId: string; cwd: string }>
): CursorCwdIndex {
  const bySessionId = new Map<string, string>()
  const byProjectDirName = new Map<string, string>()
  for (const meta of metas) {
    const cwd = meta.cwd.trim()
    const sessionId = meta.sessionId.trim()
    if (!cwd || !sessionId) {
      continue
    }
    bySessionId.set(sessionId, cwd)
    const encoded = encodeCursorProjectDirName(cwd)
    if (encoded) {
      byProjectDirName.set(encoded, cwd)
    }
  }
  return { bySessionId, byProjectDirName }
}

export async function readLocalCursorChatsIndex(chatsDir: string): Promise<CursorCwdIndex> {
  const metas: Array<{ sessionId: string; cwd: string }> = []
  let hashDirs: Awaited<ReturnType<typeof wslGatedReaddir>>
  try {
    hashDirs = await wslGatedReaddir(chatsDir, 'scan')
  } catch (error) {
    if (error instanceof WslTranscriptFsError) {
      throw error
    }
    return indexCursorChatsMetas([])
  }
  for (const hashEntry of hashDirs) {
    if (!hashEntry.isDirectory()) {
      continue
    }
    const hashDir = join(chatsDir, hashEntry.name)
    let sessionDirs: Awaited<ReturnType<typeof wslGatedReaddir>>
    try {
      sessionDirs = await wslGatedReaddir(hashDir, 'scan')
    } catch (error) {
      if (error instanceof WslTranscriptFsError) {
        throw error
      }
      continue
    }
    for (const sessionEntry of sessionDirs) {
      if (!sessionEntry.isDirectory()) {
        continue
      }
      const record = await readJsonObjectIfExists(join(hashDir, sessionEntry.name, 'meta.json'))
      const cwd = extractString(record?.cwd)
      if (!cwd) {
        continue
      }
      metas.push({ sessionId: sessionEntry.name, cwd })
    }
  }
  return indexCursorChatsMetas(metas)
}

export function createCursorWorkspaceResolver(
  readIndex: (chatsDir: string) => Promise<CursorCwdIndex>,
  pathExists: (path: string) => Promise<boolean> = localPathExists
): CursorWorkspaceResolver {
  const indexes = new Map<string, Promise<CursorCwdIndex>>()

  return {
    async enrich(session, chatsDir) {
      if (session.agent !== 'cursor' || session.cwd) {
        return session
      }
      let index = indexes.get(chatsDir)
      if (!index) {
        const pending: Promise<CursorCwdIndex> = readIndex(chatsDir).catch((error: unknown) => {
          if (indexes.get(chatsDir) === pending) {
            indexes.delete(chatsDir)
          }
          throw error
        })
        index = pending
        indexes.set(chatsDir, pending)
      }
      const projectDirName = cursorProjectDirNameFromTranscriptPath(session.filePath)
      const fromChats = cwdFromCursorIndex(await index, {
        sessionId: session.sessionId,
        projectDirName
      })
      if (fromChats) {
        return { ...session, cwd: fromChats }
      }
      if (!projectDirName) {
        return session
      }
      const guessed = guessCursorCwdFromProjectDirName(projectDirName)
      if (guessed && (await pathExists(guessed))) {
        return { ...session, cwd: guessed }
      }
      return session
    }
  }
}

async function localPathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
