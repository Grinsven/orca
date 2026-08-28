import { useCallback, useEffect, useRef } from 'react'
import { requireGitOwnerTarget } from '../../worktree-git-owner-target'
import type { RuntimeClientTarget } from '../../../../../../shared/runtime-client-target'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { getRuntimeGitCommitCompare } from '@/runtime/runtime-git-diff-client'
import { getConnectionId } from '@/lib/connection-context'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import type { GitHistoryItem } from '../../../../../../shared/git-history'
import type {
  GitBranchChangeEntry,
  GitCommitCompareResult
} from '../../../../../../shared/git-diff-compare-types'
import {
  shouldOpenSourceControlRowAsPreview,
  type SourceControlRowOpenEvent
} from '../listing/split-open'
import type { GitHistoryCommitAction } from './git-history-commit-context-menu'
import type { GitHistoryWorktreeRef } from '../../../../../../shared/git-history-worktree-refs'
import { useGitHistoryCommitMenuActions } from './use-git-history-commit-menu-actions'

const EMPTY_BRANCH_CHANGE_ENTRIES: GitBranchChangeEntry[] = []

type GitHistoryCommitActions = {
  loadCommitFiles: (item: GitHistoryItem) => Promise<GitBranchChangeEntry[]>
  openHistoryCommitDiff: (item: GitHistoryItem) => Promise<void>
  openCommitFile: (
    item: GitHistoryItem,
    entry: GitBranchChangeEntry,
    event?: SourceControlRowOpenEvent
  ) => void
  openCommitWorkingFile: (
    item: GitHistoryItem,
    entry: GitBranchChangeEntry,
    event?: SourceControlRowOpenEvent
  ) => void
  handleCommitAction: (action: GitHistoryCommitAction, item: GitHistoryItem) => void
}

// Commit-history panel actions (expand/load files, open diffs, context-menu
// actions). Extracted from SourceControl to keep that component from growing.
export function useGitHistoryCommitActions({
  activeWorktreeId,
  worktreePath,
  activeRepoTarget,
  gitHistoryWorktreesByBranch,
  resolveSplitTargetGroupId
}: {
  activeWorktreeId: string | null | undefined
  worktreePath: string | null
  activeRepoTarget: RuntimeClientTarget | null
  gitHistoryWorktreesByBranch: ReadonlyMap<string, GitHistoryWorktreeRef>
  resolveSplitTargetGroupId: (event?: SourceControlRowOpenEvent) => string | undefined
}): GitHistoryCommitActions {
  const openCommitAllDiffs = useAppStore((s) => s.openCommitAllDiffs)
  const openFile = useAppStore((s) => s.openFile)
  const openCommitDiff = useAppStore((s) => s.openCommitDiff)

  // Caches each commit's compare result so expanding a commit fetches its files
  // once, and opening a single file (or the combined diff) reuses that same
  // compare metadata without a second round-trip.
  const commitCompareCacheRef = useRef<Map<string, GitCommitCompareResult>>(new Map())

  // Keyed by commit oid; drop it when the workspace changes so the cache stays
  // bounded to the commits expanded in the current worktree's history.
  useEffect(() => {
    commitCompareCacheRef.current = new Map()
  }, [activeWorktreeId])

  const loadCommitFiles = useCallback(
    async (item: GitHistoryItem): Promise<GitBranchChangeEntry[]> => {
      if (!activeWorktreeId || !worktreePath) {
        return EMPTY_BRANCH_CHANGE_ENTRIES
      }
      const cached = commitCompareCacheRef.current.get(item.id)
      if (cached) {
        return cached.entries
      }
      const connectionId = getConnectionId(activeWorktreeId) ?? undefined
      const result = await getRuntimeGitCommitCompare(
        {
          // Why: route the commit compare by the repo OWNER host, not the focused runtime.
          target: requireGitOwnerTarget(activeRepoTarget),
          worktreeId: activeWorktreeId,
          worktreePath,
          connectionId
        },
        item.id
      )
      if (result.summary.status !== 'ready') {
        throw new Error(
          result.summary.errorMessage ??
            translate(
              'auto.components.right.sidebar.SourceControl.8a5ba6a988',
              'Failed to load commit diff'
            )
        )
      }
      commitCompareCacheRef.current.set(item.id, result)
      return result.entries
    },
    [activeRepoTarget, activeWorktreeId, worktreePath]
  )

  const openHistoryCommitDiff = useCallback(
    async (item: GitHistoryItem): Promise<void> => {
      if (!activeWorktreeId || !worktreePath) {
        return
      }
      try {
        // Reuses loadCommitFiles' fetch + cache so expanding a commit and then
        // opening its combined diff costs a single round-trip.
        await loadCommitFiles(item)
        const cached = commitCompareCacheRef.current.get(item.id)
        if (!cached) {
          return
        }
        openCommitAllDiffs(
          activeWorktreeId,
          worktreePath,
          cached.summary,
          cached.entries,
          item.subject,
          item.message
        )
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.right.sidebar.SourceControl.8a5ba6a988',
                'Failed to load commit diff'
              )
        )
      }
    },
    [activeWorktreeId, loadCommitFiles, openCommitAllDiffs, worktreePath]
  )

  const openCommitFile = useCallback(
    (
      item: GitHistoryItem,
      entry: GitBranchChangeEntry,
      event?: SourceControlRowOpenEvent
    ): void => {
      if (!activeWorktreeId || !worktreePath) {
        return
      }
      // The cache is populated by loadCommitFiles when the row is expanded, so a
      // missing entry means the files never loaded — nothing to open.
      const cached = commitCompareCacheRef.current.get(item.id)
      if (!cached) {
        return
      }
      const targetGroupId = resolveSplitTargetGroupId(event)
      openCommitDiff(
        activeWorktreeId,
        worktreePath,
        entry,
        {
          commitOid: cached.summary.commitOid,
          parentOid: cached.summary.parentOid,
          compareRef: cached.summary.compareRef,
          baseRef: cached.summary.baseRef,
          subject: item.subject,
          message: item.message
        },
        detectLanguage(entry.path),
        { targetGroupId, preview: shouldOpenSourceControlRowAsPreview(event, targetGroupId) }
      )
    },
    [activeWorktreeId, openCommitDiff, resolveSplitTargetGroupId, worktreePath]
  )

  // The commit diff shows two historical revisions, so it is read-only; this opens the
  // editable working copy of the same path instead.
  const openCommitWorkingFile = useCallback(
    (
      _item: GitHistoryItem,
      entry: GitBranchChangeEntry,
      event?: SourceControlRowOpenEvent
    ): void => {
      if (!activeWorktreeId || !worktreePath) {
        return
      }
      const targetGroupId = resolveSplitTargetGroupId(event)
      openFile(
        {
          filePath: joinPath(worktreePath, entry.path),
          relativePath: entry.path,
          worktreeId: activeWorktreeId,
          language: detectLanguage(entry.path),
          mode: 'edit'
        },
        { targetGroupId, preview: shouldOpenSourceControlRowAsPreview(event, targetGroupId) }
      )
    },
    [activeWorktreeId, openFile, resolveSplitTargetGroupId, worktreePath]
  )

  const handleCommitAction = useGitHistoryCommitMenuActions({
    activeWorktreeId,
    worktreePath,
    activeRepoTarget,
    gitHistoryWorktreesByBranch
  })

  return {
    loadCommitFiles,
    openHistoryCommitDiff,
    openCommitFile,
    openCommitWorkingFile,
    handleCommitAction
  }
}
