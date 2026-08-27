import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import type {
  GitHistoryItem,
  GitHistoryResult,
  GitHistoryScope
} from '../../../../../../shared/git-history'
import {
  GIT_HISTORY_PANEL_DEFAULT_HEIGHT,
  GIT_HISTORY_PANEL_MAX_HEIGHT,
  GIT_HISTORY_PANEL_MIN_HEIGHT
} from '../../../../../../shared/git-history'
import type { GitHistoryWorktreeRef } from '../../../../../../shared/git-history-worktree-refs'
import type { GitBranchChangeEntry } from '../../../../../../shared/git-diff-compare-types'
import {
  buildDefaultGitHistoryColorMap,
  buildGitHistoryViewModels
} from '../../../../../../shared/git-history-graph'
import { GitHistoryPanelHeader } from './git-history-panel-header'
import { GitHistoryRow } from './git-history-row'
import { GitHistoryCommitFiles, type GitHistoryCommitFilesState } from './git-history-commit-files'
import {
  GitHistoryCommitContextMenu,
  type GitHistoryCommitAction
} from './git-history-commit-context-menu'
import type { SourceControlRowOpenEvent } from '../listing/split-open'
import { translate } from '@/i18n/i18n'

export type GitHistoryPanelState =
  | { status: 'idle' | 'loading'; result?: GitHistoryResult; error?: string }
  | { status: 'refreshing' | 'ready'; result: GitHistoryResult; error?: string }
  | { status: 'error'; result?: GitHistoryResult; error: string }

// Shared with the settings sanitizer so a dragged height is never clamped differently on persist.
const DEFAULT_GIT_HISTORY_PANEL_HEIGHT = GIT_HISTORY_PANEL_DEFAULT_HEIGHT
const MIN_GIT_HISTORY_PANEL_HEIGHT = GIT_HISTORY_PANEL_MIN_HEIGHT
const MAX_GIT_HISTORY_PANEL_HEIGHT = GIT_HISTORY_PANEL_MAX_HEIGHT
// Why so tall: the graph is the whole point of the all-branches scope, and the drag handle has to
// actually move it. The old 520px/33vh pair silently swallowed the drag on any large window.
const MAX_GIT_HISTORY_PANEL_VIEWPORT_HEIGHT = '85vh'

type GitHistoryResizeSession = {
  startY: number
  startHeight: number
  previousCursor: string
  previousUserSelect: string
}

function clampGitHistoryPanelHeight(height: number): number {
  return Math.min(MAX_GIT_HISTORY_PANEL_HEIGHT, Math.max(MIN_GIT_HISTORY_PANEL_HEIGHT, height))
}

export function GitHistoryPanel({
  state,
  collapsed,
  scope,
  height,
  worktreesByBranch,
  canLoadMore,
  onHeightChange,
  onToggle,
  onToggleScope,
  onLoadMore,
  onRefresh,
  onOpenCommit,
  onLoadCommitFiles,
  onOpenCommitFile,
  onCommitAction
}: {
  state: GitHistoryPanelState
  collapsed: boolean
  scope: GitHistoryScope
  height?: number
  worktreesByBranch?: ReadonlyMap<string, GitHistoryWorktreeRef>
  canLoadMore?: boolean
  onHeightChange?: (height: number) => void
  onToggle: () => void
  onToggleScope: () => void
  onLoadMore?: () => void
  onRefresh: () => void
  onOpenCommit?: (item: GitHistoryItem) => void
  onLoadCommitFiles?: (item: GitHistoryItem) => Promise<GitBranchChangeEntry[]>
  onOpenCommitFile?: (
    item: GitHistoryItem,
    entry: GitBranchChangeEntry,
    event?: SourceControlRowOpenEvent
  ) => void
  onCommitAction?: (action: GitHistoryCommitAction, item: GitHistoryItem) => void
}): React.JSX.Element | null {
  const result = state.result
  const viewModels = useMemo(() => {
    if (!result) {
      return []
    }
    return buildGitHistoryViewModels(
      result.items,
      buildDefaultGitHistoryColorMap(result),
      result.currentRef,
      result.remoteRef,
      result.baseRef,
      result.hasIncomingChanges,
      result.hasOutgoingChanges,
      result.mergeBase
    )
  }, [result])

  const loading = state.status === 'loading' || state.status === 'refreshing'
  const count = result?.items.length ?? 0
  const resizeSessionRef = useRef<GitHistoryResizeSession | null>(null)
  const [panelHeight, setPanelHeight] = useState(height ?? DEFAULT_GIT_HISTORY_PANEL_HEIGHT)
  const latestHeightRef = useRef(panelHeight)
  latestHeightRef.current = panelHeight
  // Adopt an externally restored height (settings load, another window) without fighting a live drag.
  const [appliedHeight, setAppliedHeight] = useState(height)
  if (height !== undefined && height !== appliedHeight && !resizeSessionRef.current) {
    setAppliedHeight(height)
    setPanelHeight(height)
  }

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [filesByCommit, setFilesByCommit] = useState<Record<string, GitHistoryCommitFilesState>>({})
  // Tracks commits whose files have been loaded (or are in flight) so re-expanding
  // never refetches; an entry is cleared on error to allow a retry.
  const loadedCommitsRef = useRef<{
    result: GitHistoryResult | undefined
    ids: Set<string>
  }>(undefined!)
  loadedCommitsRef.current ??= { result, ids: new Set() }

  // A new history result can reorder or replace commits, so drop any expansion
  // and cached file lists rather than risk showing stale files under a row.
  const [historyResult, setHistoryResult] = useState(result)
  if (historyResult !== result) {
    setHistoryResult(result)
    setExpanded(new Set())
    setFilesByCommit({})
  }

  const handleToggleExpand = useCallback(
    (item: GitHistoryItem): void => {
      const id = item.id
      const willExpand = !expanded.has(id)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (willExpand) {
          next.add(id)
        } else {
          next.delete(id)
        }
        return next
      })
      // Why: clear the in-flight lock in the click handler, not during render —
      // a new history result can reuse commit ids with different file lists.
      if (loadedCommitsRef.current.result !== result) {
        loadedCommitsRef.current = { result, ids: new Set() }
      }
      if (!willExpand || !onLoadCommitFiles || loadedCommitsRef.current.ids.has(id)) {
        return
      }
      loadedCommitsRef.current.ids.add(id)
      setFilesByCommit((prev) => ({ ...prev, [id]: { status: 'loading' } }))
      onLoadCommitFiles(item)
        .then((entries) => {
          setFilesByCommit((prev) => ({ ...prev, [id]: { status: 'ready', entries } }))
        })
        .catch((error: unknown) => {
          if (loadedCommitsRef.current.result === result) {
            loadedCommitsRef.current.ids.delete(id)
          }
          setFilesByCommit((prev) => ({
            ...prev,
            [id]: {
              status: 'error',
              error:
                error instanceof Error
                  ? error.message
                  : translate(
                      'auto.components.right.sidebar.GitHistoryPanel.6d1e0a7c3b',
                      'Failed to load commit files'
                    )
            }
          }))
        })
    },
    [expanded, onLoadCommitFiles, result]
  )

  const stopResize = useCallback((): void => {
    const session = resizeSessionRef.current
    if (!session) {
      return
    }
    resizeSessionRef.current = null
    document.body.style.cursor = session.previousCursor
    document.body.style.userSelect = session.previousUserSelect
    // Why on release, not per move: persisting mid-drag would write a settings update per pointer event.
    onHeightChange?.(latestHeightRef.current)
  }, [onHeightChange])

  const handleResizePointerMove = useCallback((event: PointerEvent): void => {
    const session = resizeSessionRef.current
    if (!session) {
      return
    }
    const next = clampGitHistoryPanelHeight(session.startHeight + session.startY - event.clientY)
    latestHeightRef.current = next
    setPanelHeight(next)
  }, [])

  useEffect(() => {
    window.addEventListener('pointermove', handleResizePointerMove)
    window.addEventListener('pointerup', stopResize)
    window.addEventListener('pointercancel', stopResize)
    window.addEventListener('blur', stopResize)
    return () => {
      window.removeEventListener('pointermove', handleResizePointerMove)
      window.removeEventListener('pointerup', stopResize)
      window.removeEventListener('pointercancel', stopResize)
      window.removeEventListener('blur', stopResize)
      stopResize()
    }
  }, [handleResizePointerMove, stopResize])

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (collapsed) {
        return
      }
      event.preventDefault()
      resizeSessionRef.current = {
        startY: event.clientY,
        startHeight: panelHeight,
        previousCursor: document.body.style.cursor,
        previousUserSelect: document.body.style.userSelect
      }
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [collapsed, panelHeight]
  )

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const step = event.shiftKey ? 32 : 16
      const applyHeight = (next: number): void => {
        const clamped = clampGitHistoryPanelHeight(next)
        latestHeightRef.current = clamped
        setPanelHeight(clamped)
        onHeightChange?.(clamped)
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        applyHeight(latestHeightRef.current + step)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        applyHeight(latestHeightRef.current - step)
      } else if (event.key === 'Home') {
        event.preventDefault()
        applyHeight(MIN_GIT_HISTORY_PANEL_HEIGHT)
      } else if (event.key === 'End') {
        event.preventDefault()
        applyHeight(MAX_GIT_HISTORY_PANEL_HEIGHT)
      }
    },
    [onHeightChange]
  )

  const expandedBodyClassName = 'overflow-y-auto scrollbar-sleek'
  const expandedBodyStyle = {
    height: `min(${panelHeight}px, ${MAX_GIT_HISTORY_PANEL_VIEWPORT_HEIGHT})`
  }

  return (
    <div className="relative">
      {!collapsed && (
        <div
          role="separator"
          aria-label={translate(
            'auto.components.right.sidebar.GitHistoryPanel.e5e81e59a6',
            'Resize commits'
          )}
          aria-orientation="horizontal"
          aria-valuemin={MIN_GIT_HISTORY_PANEL_HEIGHT}
          aria-valuemax={MAX_GIT_HISTORY_PANEL_HEIGHT}
          aria-valuenow={panelHeight}
          tabIndex={0}
          className="absolute inset-x-0 -top-1 z-10 h-2 cursor-row-resize outline-none focus-visible:bg-ring/30"
          onPointerDown={startResize}
          onKeyDown={handleResizeKeyDown}
        />
      )}
      <GitHistoryPanelHeader
        collapsed={collapsed}
        count={count}
        hasCounts={Boolean(result)}
        hasMore={Boolean(result?.hasMore)}
        loading={loading}
        scope={scope}
        onToggle={onToggle}
        onToggleScope={onToggleScope}
        onRefresh={onRefresh}
      />
      {!collapsed && state.status === 'error' && !result && (
        <div
          className={cn(expandedBodyClassName, 'px-6 py-2 text-[11px] text-destructive')}
          style={expandedBodyStyle}
        >
          {state.error}
        </div>
      )}
      {!collapsed && (state.status === 'idle' || state.status === 'loading') && !result && (
        <div
          className={cn(
            expandedBodyClassName,
            'flex items-start gap-2 px-6 py-2 text-[11px] text-muted-foreground'
          )}
          style={expandedBodyStyle}
        >
          <RefreshCw className="size-3 animate-spin" />
          <span>
            {translate(
              'auto.components.right.sidebar.GitHistoryPanel.781a8bcf7b',
              'Loading graph...'
            )}
          </span>
        </div>
      )}
      {!collapsed && result && viewModels.length === 0 && (
        <div
          className={cn(expandedBodyClassName, 'px-6 py-2 text-[11px] text-muted-foreground')}
          style={expandedBodyStyle}
        >
          {translate('auto.components.right.sidebar.GitHistoryPanel.cf7cad58d2', 'No commits yet')}
        </div>
      )}
      {!collapsed && viewModels.length > 0 && (
        <div className={expandedBodyClassName} style={expandedBodyStyle}>
          {viewModels.map((viewModel) => {
            const item = viewModel.historyItem
            const isBoundaryNode =
              viewModel.kind === 'incoming-changes' || viewModel.kind === 'outgoing-changes'
            const canExpand =
              !isBoundaryNode && Boolean(onLoadCommitFiles) && Boolean(onOpenCommitFile)
            const isExpanded = canExpand && expanded.has(item.id)
            const row = (
              <GitHistoryRow
                viewModel={viewModel}
                expanded={isExpanded}
                preserveRefIds={result?.baseRef ? [result.baseRef.id] : undefined}
                worktreesByBranch={worktreesByBranch}
                onOpenCommit={onOpenCommit}
                onToggleExpand={canExpand ? handleToggleExpand : undefined}
              />
            )
            return (
              <React.Fragment key={`${viewModel.kind}:${item.id}`}>
                {onCommitAction && !isBoundaryNode ? (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                    <GitHistoryCommitContextMenu
                      item={item}
                      worktreesByBranch={worktreesByBranch}
                      onAction={onCommitAction}
                    />
                  </ContextMenu>
                ) : (
                  row
                )}
                {isExpanded && (
                  <GitHistoryCommitFiles
                    state={filesByCommit[item.id] ?? { status: 'loading' }}
                    author={item.author}
                    timestamp={item.timestamp}
                    onOpenFile={(entry, event) => onOpenCommitFile?.(item, entry, event)}
                    onOpenAll={onOpenCommit ? () => onOpenCommit(item) : undefined}
                  />
                )}
              </React.Fragment>
            )
          })}
          {canLoadMore && onLoadMore && (
            <div className="px-6 py-1">
              <button
                type="button"
                className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
                disabled={loading}
                onClick={onLoadMore}
              >
                {translate(
                  'auto.components.right.sidebar.GitHistoryPanel.a3d2f18b47',
                  'Load more commits'
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
