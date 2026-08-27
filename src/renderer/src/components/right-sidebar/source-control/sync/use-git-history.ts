import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { requireGitOwnerTarget } from '../../worktree-git-owner-target'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import { getConnectionId } from '@/lib/connection-context'
import { getRuntimeGitHistory } from '@/runtime/runtime-git-status-client'
import {
  GIT_HISTORY_DEFAULT_LIMIT,
  GIT_HISTORY_MAX_LIMIT,
  type GitHistoryScope
} from '../../../../../../shared/git-history'
import type { GitHistoryPanelState } from './git-history-panel'

const EMPTY_GIT_HISTORY_STATE: GitHistoryPanelState = { status: 'idle' }

/**
 * Loads commit history for the active worktree.
 *
 * State is kept per worktree so switching tabs restores the previous result instead of reloading,
 * and entries are pruned when `worktreeMap` drops a worktree. Fetching is gated on the panel being
 * expanded and visible, and stale responses are discarded by per-worktree request id.
 *
 * The window starts at `GIT_HISTORY_DEFAULT_LIMIT` and grows a page at a time through
 * `loadMoreGitHistory`, which the all-branches scope needs: there the page is shared by every ref,
 * so the workspace's own commits (HEAD included) can fall outside the first page.
 *
 * `refreshGitHistoryRef` exists for callers that must refresh from an effect without re-subscribing
 * whenever the callback identity changes.
 */
export function useSourceControlGitHistory({
  activeRepoTarget,
  activeWorktreeId,
  worktreePath,
  compareBaseRef,
  gitHistoryScope,
  isFolder,
  isBranchVisible,
  isGitHistoryExpanded,
  isGitHistoryVisible,
  worktreeMap
}: {
  activeRepoTarget: RuntimeClientTarget | null
  activeWorktreeId: string | null
  worktreePath: string | null
  compareBaseRef: string | null
  gitHistoryScope: GitHistoryScope
  isFolder: boolean
  isBranchVisible: boolean
  isGitHistoryExpanded: boolean
  isGitHistoryVisible: boolean
  worktreeMap: ReadonlyMap<string, unknown>
}): {
  gitHistoryState: GitHistoryPanelState
  canLoadMoreGitHistory: boolean
  loadMoreGitHistory: () => Promise<void>
  refreshGitHistory: () => Promise<void>
  refreshGitHistoryRef: RefObject<() => Promise<void>>
} {
  const [gitHistoryByWorktree, setGitHistoryByWorktree] = useState<
    Record<string, GitHistoryPanelState>
  >({})
  const [gitHistoryLimitByWorktree, setGitHistoryLimitByWorktree] = useState<
    Record<string, number>
  >({})
  const gitHistoryRequestSeqRef = useRef(0)
  const gitHistoryRequestByWorktreeRef = useRef<Record<string, number>>({})
  const gitHistoryState = activeWorktreeId
    ? (gitHistoryByWorktree[activeWorktreeId] ?? EMPTY_GIT_HISTORY_STATE)
    : EMPTY_GIT_HISTORY_STATE
  const gitHistoryLimit = activeWorktreeId
    ? (gitHistoryLimitByWorktree[activeWorktreeId] ?? GIT_HISTORY_DEFAULT_LIMIT)
    : GIT_HISTORY_DEFAULT_LIMIT
  // Why: the read is routed by owner host, so track it as a stable string — a new settings object alone must not refetch.
  const ownerHostKey =
    activeRepoTarget?.kind === 'environment' ? activeRepoTarget.environmentId : ''

  useEffect(() => {
    setGitHistoryByWorktree((prev) => {
      let changed = false
      const next: Record<string, GitHistoryPanelState> = {}
      for (const key of Object.keys(prev)) {
        if (worktreeMap.has(key)) {
          next[key] = prev[key]
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
    setGitHistoryLimitByWorktree((prev) => {
      let changed = false
      const next: Record<string, number> = {}
      for (const key of Object.keys(prev)) {
        if (worktreeMap.has(key)) {
          next[key] = prev[key]
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
    for (const key of Object.keys(gitHistoryRequestByWorktreeRef.current)) {
      if (!worktreeMap.has(key)) {
        delete gitHistoryRequestByWorktreeRef.current[key]
      }
    }
  }, [worktreeMap])

  const fetchGitHistory = useCallback(
    async (limit: number): Promise<void> => {
      if (
        !activeWorktreeId ||
        !worktreePath ||
        isFolder ||
        !isBranchVisible ||
        !isGitHistoryExpanded ||
        !isGitHistoryVisible
      ) {
        return
      }
      const worktreeId = activeWorktreeId
      const requestId = gitHistoryRequestSeqRef.current + 1
      gitHistoryRequestSeqRef.current = requestId
      gitHistoryRequestByWorktreeRef.current[worktreeId] = requestId
      setGitHistoryByWorktree((prev) => {
        const previous = prev[worktreeId]
        return {
          ...prev,
          [worktreeId]: previous?.result
            ? { status: 'refreshing', result: previous.result }
            : { status: 'loading' }
        }
      })
      try {
        const connectionId = getConnectionId(worktreeId) ?? undefined
        const result = await getRuntimeGitHistory(
          {
            // Why: route the history read by the repo OWNER host, not the focused runtime.
            target: requireGitOwnerTarget(activeRepoTarget),
            worktreeId,
            worktreePath,
            connectionId
          },
          { limit, baseRef: compareBaseRef, scope: gitHistoryScope }
        )
        if (gitHistoryRequestByWorktreeRef.current[worktreeId] !== requestId) {
          return
        }
        setGitHistoryByWorktree((prev) => ({
          ...prev,
          [worktreeId]: { status: 'ready', result }
        }))
      } catch (error) {
        if (gitHistoryRequestByWorktreeRef.current[worktreeId] !== requestId) {
          return
        }
        const message = error instanceof Error ? error.message : 'Failed to load commits'
        setGitHistoryByWorktree((prev) => {
          const previous = prev[worktreeId]
          return {
            ...prev,
            [worktreeId]: previous?.result
              ? { status: 'error', result: previous.result, error: message }
              : { status: 'error', error: message }
          }
        })
      }
    },
    [
      activeRepoTarget,
      activeWorktreeId,
      compareBaseRef,
      gitHistoryScope,
      isBranchVisible,
      isFolder,
      isGitHistoryExpanded,
      isGitHistoryVisible,
      worktreePath
    ]
  )

  const refreshGitHistory = useCallback(
    (): Promise<void> => fetchGitHistory(gitHistoryLimit),
    [fetchGitHistory, gitHistoryLimit]
  )

  const canLoadMoreGitHistory =
    Boolean(activeWorktreeId) &&
    Boolean(gitHistoryState.result?.hasMore) &&
    gitHistoryLimit < GIT_HISTORY_MAX_LIMIT

  const loadMoreGitHistory = useCallback(async (): Promise<void> => {
    if (!activeWorktreeId) {
      return
    }
    const nextLimit = Math.min(GIT_HISTORY_MAX_LIMIT, gitHistoryLimit + GIT_HISTORY_DEFAULT_LIMIT)
    if (nextLimit === gitHistoryLimit) {
      return
    }
    setGitHistoryLimitByWorktree((prev) => ({ ...prev, [activeWorktreeId]: nextLimit }))
    // Why fetch with the explicit limit: the state update lands after this call, so reading the
    // memoized limit back here would re-request the page the user already has.
    await fetchGitHistory(nextLimit)
  }, [activeWorktreeId, fetchGitHistory, gitHistoryLimit])

  const refreshGitHistoryRef = useRef(refreshGitHistory)
  // Why: publish in an effect, not the render body — a discarded render must not install its callback. Declared first so the effect below sees the fresh one.
  useEffect(() => {
    refreshGitHistoryRef.current = refreshGitHistory
  }, [refreshGitHistory])

  useEffect(() => {
    // Why: history shells out to git; defer first load until the user expands Commits so source control stays cheap for large/remote repos.
    if (!isBranchVisible || !isGitHistoryExpanded || !isGitHistoryVisible) {
      return
    }
    void refreshGitHistoryRef.current()
  }, [
    // Why: history is fetched with compareBaseRef, so re-run when it changes (effectiveBaseRef can stay put while it moves).
    activeWorktreeId,
    compareBaseRef,
    gitHistoryScope,
    isBranchVisible,
    isFolder,
    isGitHistoryExpanded,
    isGitHistoryVisible,
    // Why: same worktree + path can switch owner host; without this the panel keeps the previous host's commits.
    ownerHostKey,
    worktreePath
  ])

  return {
    gitHistoryState,
    canLoadMoreGitHistory,
    loadMoreGitHistory,
    refreshGitHistory,
    refreshGitHistoryRef
  }
}
