// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AppState } from '@/store/types'
import {
  createWorkspaceCleanupBrowseSlice,
  resetWorkspaceCleanupBrowsePersistTimer
} from '@/store/slices/workspace-cleanup-browse'
import { listAppliedWorkspaceCleanupFilters } from '../../../../shared/workspace-cleanup-applied-filters'
import {
  useWorkspaceCleanupBrowseState,
  type WorkspaceCleanupBrowseController
} from './use-workspace-cleanup-browse-state'

const store = create<AppState>()(
  (...a) =>
    ({
      workspaceCleanupDismissals: {},
      ...createWorkspaceCleanupBrowseSlice(...a)
    }) as unknown as AppState
)

vi.mock('@/store', () => ({
  useAppStore: Object.assign(<T,>(selector: (s: AppState) => T): T => store(selector), {
    getState: () => store.getState()
  })
}))

const NOOP_FORMAT = new Proxy({}, { get: () => () => 'chip' }) as Parameters<
  typeof listAppliedWorkspaceCleanupFilters
>[1]

let root: Root | null = null

function mount(): { current: WorkspaceCleanupBrowseController | null } {
  const ref: { current: WorkspaceCleanupBrowseController | null } = { current: null }
  function Probe(): null {
    ref.current = useWorkspaceCleanupBrowseState()
    return null
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<Probe />))
  return ref
}

describe('useWorkspaceCleanupBrowseState same-tick writes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as { window: unknown }).window = {
      ...globalThis.window,
      api: { ui: { set: vi.fn().mockResolvedValue(undefined) } }
    }
    store.setState({
      workspaceCleanupBrowse: {
        ...store.getState().workspaceCleanupBrowse,
        filters: {
          ...store.getState().workspaceCleanupBrowse.filters,
          activity: {
            ...store.getState().workspaceCleanupBrowse.filters.activity,
            idleMinDays: 20
          }
        }
      }
    } as Partial<AppState>)
  })

  afterEach(() => {
    if (root) {
      act(() => root!.unmount())
    }
    root = null
    document.body.replaceChildren()
    resetWorkspaceCleanupBrowsePersistTimer()
    vi.useRealTimers()
  })

  const clearIdleChip = (c: WorkspaceCleanupBrowseController): void => {
    const chip = listAppliedWorkspaceCleanupFilters(
      store.getState().workspaceCleanupBrowse.filters,
      NOOP_FORMAT
    ).find((a) => a.id === 'activity.idleMinDays')
    c.replaceFilters(chip!.clear)
  }

  it('keeps a cleared chip cleared when a facet patch lands in the same tick', () => {
    const c = mount()

    act(() => {
      clearIdleChip(c.current!)
      c.current!.patchFilters('git', { states: ['dirty'] })
    })

    const filters = store.getState().workspaceCleanupBrowse.filters
    expect(filters.activity.idleMinDays).toBeNull()
    expect(filters.git.states).toEqual(['dirty'])
  })

  it('keeps a cleared chip cleared in the opposite call order', () => {
    const c = mount()

    act(() => {
      c.current!.patchFilters('git', { states: ['dirty'] })
      clearIdleChip(c.current!)
    })

    const filters = store.getState().workspaceCleanupBrowse.filters
    expect(filters.activity.idleMinDays).toBeNull()
    expect(filters.git.states).toEqual(['dirty'])
  })

  it('keeps both facet patches when two groups are written in one tick', () => {
    const c = mount()

    act(() => {
      c.current!.patchFilters('size', { maxBytes: 500 })
      c.current!.patchFilters('location', { pathPrefix: '/repos' })
    })

    const filters = store.getState().workspaceCleanupBrowse.filters
    expect(filters.size.maxBytes).toBe(500)
    expect(filters.location.pathPrefix).toBe('/repos')
  })
})
