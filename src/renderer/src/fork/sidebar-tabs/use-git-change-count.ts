import { create } from 'zustand'
import { useAppStore } from '@/store'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import type { GitStatusResult } from '../../../../shared/git-status-types'
import { activeGitCountContext, gitCountConnectionKey } from './git-change-count-owner'
import { countChangedFiles, gitChangeCountKey, type GitChangeCount } from './git-change-count'

type Snapshot = GitChangeCount & { connectionKey: string }
// Only count projections are retained, bounded independently of the file-status cache.
const MAX_COUNT_SNAPSHOTS = 128
type CountScope = { context: RuntimeGitContext; valid: boolean }
const scopes = new Map<string, CountScope>()
let unsubscribe: (() => void) | undefined
export const useGitChangeCounts = create<{ snapshots: ReadonlyMap<string, Snapshot> }>(() => ({
  snapshots: new Map()
}))

function observeCountOwners(): void {
  unsubscribe ??= useAppStore.subscribe((state, previous) => {
    if (
      state.runtimeStatusByEnvironmentId === previous.runtimeStatusByEnvironmentId &&
      state.sshConnectionStates === previous.sshConnectionStates &&
      state.sshStateByEnvironment === previous.sshStateByEnvironment &&
      state.gitStatusByWorktree === previous.gitStatusByWorktree
    ) {
      return
    }
    const removed = new Set<string>()
    for (const [key, scope] of scopes) {
      const id = scope.context.worktreeId
      const purged = id && previous.gitStatusByWorktree[id] && !state.gitStatusByWorktree[id]
      if (purged || gitCountConnectionKey(state, scope.context) === null) {
        scope.valid = false
        scopes.delete(key)
        removed.add(key)
      }
    }
    if (removed.size > 0) {
      useGitChangeCounts.setState((current) => ({
        snapshots: new Map([...current.snapshots].filter(([key]) => !removed.has(key)))
      }))
    }
  })
}

import.meta.hot?.dispose(() => unsubscribe?.())

/** Observes an existing request; it never fetches or schedules Git work. */
export function createGitChangeCountPublisher(
  context: RuntimeGitContext
): (status: GitStatusResult) => void {
  observeCountOwners()
  const key = gitChangeCountKey(context)
  const connectionKey = gitCountConnectionKey(useAppStore.getState(), context)
  const scope = scopes.get(key) ?? { context, valid: true }
  scopes.delete(key)
  scopes.set(key, scope)
  if (scopes.size > MAX_COUNT_SNAPSHOTS) {
    const oldest = scopes.entries().next().value
    if (oldest) {
      oldest[1].valid = false
      scopes.delete(oldest[0])
      useGitChangeCounts.setState((current) => {
        const snapshots = new Map(current.snapshots)
        snapshots.delete(oldest[0])
        return { snapshots }
      })
    }
  }
  return (status) => {
    if (
      !scope.valid ||
      connectionKey === null ||
      connectionKey !== gitCountConnectionKey(useAppStore.getState(), context)
    ) {
      return
    }
    const value = countChangedFiles(status)
    useGitChangeCounts.setState((state) => {
      const previous = state.snapshots.get(key)
      if (
        previous?.count === value.count &&
        previous.partial === value.partial &&
        previous.connectionKey === connectionKey
      ) {
        return state
      }
      const snapshots = new Map(state.snapshots)
      snapshots.delete(key)
      snapshots.set(key, { ...value, connectionKey })
      if (snapshots.size > MAX_COUNT_SNAPSHOTS) {
        const oldest = snapshots.keys().next().value
        if (oldest !== undefined) {
          snapshots.delete(oldest)
        }
      }
      return { snapshots }
    })
  }
}

export function useActiveGitChangeCount(): GitChangeCount | null {
  const key = useAppStore((state) => {
    const context = activeGitCountContext(state)
    return context ? gitChangeCountKey(context) : null
  })
  const connectionKey = useAppStore((state) => {
    const context = activeGitCountContext(state)
    return context ? gitCountConnectionKey(state, context) : null
  })
  const snapshot = useGitChangeCounts((state) => (key ? state.snapshots.get(key) : undefined))
  return snapshot && connectionKey !== null && snapshot.connectionKey === connectionKey
    ? snapshot
    : null
}
