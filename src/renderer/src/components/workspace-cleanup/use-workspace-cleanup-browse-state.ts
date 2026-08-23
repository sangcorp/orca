import { useCallback } from 'react'
import { useAppStore } from '@/store'
import {
  createDefaultWorkspaceCleanupFilterState,
  type WorkspaceCleanupFilterState,
  type WorkspaceCleanupSortField,
  type WorkspaceCleanupSortState
} from '../../../../shared/workspace-cleanup-filter-model'

export type WorkspaceCleanupBrowseController = {
  filters: WorkspaceCleanupFilterState
  sort: WorkspaceCleanupSortState
  patchFilters: <K extends keyof WorkspaceCleanupFilterState>(
    key: K,
    value: Partial<WorkspaceCleanupFilterState[K]> | WorkspaceCleanupFilterState[K]
  ) => void
  toggleSortField: (field: WorkspaceCleanupSortField) => void
  clearFilters: () => void
  /** Applies a whole-state transform, for callers that clear one named constraint. */
  replaceFilters: (
    transform: (filters: WorkspaceCleanupFilterState) => WorkspaceCleanupFilterState
  ) => void
}

/**
 * Single seam over the persisted browse slice so reopening the dialog keeps the
 * user's filters and sort.
 */
export function useWorkspaceCleanupBrowseState(): WorkspaceCleanupBrowseController {
  const browse = useAppStore((s) => s.workspaceCleanupBrowse)
  const updateBrowse = useAppStore((s) => s.updateWorkspaceCleanupBrowseState)

  // Why the store and not the rendered `browse`: a chip clear and a facet patch can
  // land in the same tick, and whichever read the render snapshot would undo the other.
  const patchFilters = useCallback<WorkspaceCleanupBrowseController['patchFilters']>(
    (key, value) => {
      const latest = useAppStore.getState().workspaceCleanupBrowse
      const group = latest.filters[key]
      const next =
        typeof group === 'object' && group !== null ? { ...group, ...(value as object) } : value
      // Cast: a computed key over a union widens the spread result past
      // WorkspaceCleanupFilterState even though `key` is constrained to it.
      const filters = { ...latest.filters, [key]: next } as WorkspaceCleanupFilterState
      updateBrowse({ ...latest, filters })
    },
    [updateBrowse]
  )

  // Why: re-picking the active sort flips its direction.
  const toggleSortField = useCallback(
    (field: WorkspaceCleanupSortField) => {
      const latest = useAppStore.getState().workspaceCleanupBrowse
      const direction =
        latest.sort.field === field && latest.sort.direction === 'asc' ? 'desc' : 'asc'
      updateBrowse({ ...latest, sort: { field, direction } })
    },
    [updateBrowse]
  )

  // Why read the store rather than the rendered `browse`: a chip click and any other
  // filter write can land in the same tick, and the rendered snapshot would drop one.
  const replaceFilters = useCallback<WorkspaceCleanupBrowseController['replaceFilters']>(
    (transform) => {
      const current = useAppStore.getState().workspaceCleanupBrowse
      updateBrowse({ ...current, filters: transform(current.filters) })
    },
    [updateBrowse]
  )

  const clearFilters = useCallback(() => {
    updateBrowse({
      ...useAppStore.getState().workspaceCleanupBrowse,
      filters: createDefaultWorkspaceCleanupFilterState()
    })
  }, [updateBrowse])

  return {
    filters: browse.filters,
    sort: browse.sort,
    patchFilters,
    toggleSortField,
    clearFilters,
    replaceFilters
  }
}
