import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import type { OpenFile } from '@/store/slices/editor'

// Flip to false (or set localStorage 'orca-fork.changesView' to 'off') to get Orca's Monaco "View all" back.
const CHANGES_VIEW_ENABLED = true
const CHANGES_VIEW_STORAGE_KEY = 'orca-fork.changesView'

export const ForkChangesView = lazy(() => import('./changes-view'))

function isTurnedOffLocally(): boolean {
  try {
    return window.localStorage.getItem(CHANGES_VIEW_STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}

/** The T3-style view replaces "View all" for working tree and branch tabs; commit tabs keep Monaco. */
export function shouldUseForkChangesView(file: OpenFile): boolean {
  if (!CHANGES_VIEW_ENABLED || file.mode !== 'diff' || isTurnedOffLocally()) {
    return false
  }
  return (
    file.diffSource === 'combined-uncommitted' ||
    file.diffSource === 'combined-branch' ||
    file.diffSource === 'combined-all'
  )
}
