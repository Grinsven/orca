import type React from 'react'
import { toast } from 'sonner'
import type { Worktree } from '../../../shared/worktree/types'
import { getWorktreeHostIdentity } from '../../../shared/worktree/host-qualified-identity'
import type { WorktreeDragRuntime } from '@/components/sidebar/worktree-list/drag/use-runtime'
import type {
  WorktreeDropCommitContext,
  WorktreeStatusDropAtIndexArgs
} from '@/components/sidebar/worktree-list/drag/drop-commit-context'
import {
  clearWorkspaceKanbanSidebarDropTargetVisual,
  isWorkspaceKanbanSidebarDropPointInBoard
} from '@/components/sidebar/workspace-kanban-sidebar-drop'
import { openSplitWorktree, splitWorkspaceFromRow } from './split-worktree-actions'
import { splitWorkspaceDragEnabled, useSplitPreference } from './split-worktree-preference'
import { pointInSplitRect, splitEdgeAt, type SplitRect } from './split-worktree-drop-zones'
import { useSplitWorktreeState } from './split-worktree-state'
import {
  clearSplitFallback,
  moveSplitFallback,
  releaseSplitFallback
} from './split-worktree-pointer-fallback'

export type SplitDragSession = {
  source: Worktree
  selected: readonly Worktree[]
  runtime: WorktreeDragRuntime
  fallback: boolean
  pointerId: number
  sourceRow: HTMLElement
  startX: number
  startY: number
}
let session: SplitDragSession | null = null

function showCardPreview(visible: boolean): void {
  if (typeof document === 'undefined') {
    return
  }
  const preview = document.querySelector<HTMLElement>('[data-worktree-sidebar-drag-preview]')
  if (preview) {
    preview.style.opacity = visible ? '' : '0'
  }
}

export function getSplitDragSession(): SplitDragSession | null {
  return session
}

export function captureSplitWorktreeDrag(
  event: React.PointerEvent<HTMLDivElement>,
  worktree: Worktree,
  selectedWorktreeIds: ReadonlySet<string>,
  selectedWorktrees: readonly Worktree[],
  runtime: WorktreeDragRuntime,
  hasLegacyGroup: boolean
): void {
  if (!splitWorkspaceDragEnabled()) {
    return
  }
  clearSplitWorktreeDrag()
  session = {
    source: worktree,
    selected:
      selectedWorktreeIds.has(getWorktreeHostIdentity(worktree)) && selectedWorktrees.length > 1
        ? selectedWorktrees
        : [worktree],
    runtime,
    fallback: !hasLegacyGroup,
    pointerId: event.pointerId,
    sourceRow: event.currentTarget,
    startX: event.clientX,
    startY: event.clientY
  }
}

export function splitWorktreeGestureActive(): boolean {
  return session !== null
}

export function clearSplitWorktreeDrag(): void {
  showCardPreview(true)
  clearSplitFallback()
  session = null
  useSplitWorktreeState.setState({ dragging: false, preview: null })
}

function workspaceRect(): SplitRect | null {
  const root = document.querySelector<HTMLElement>('[data-jose-split-host]')
  if (!root || root.getClientRects().length === 0) {
    return null
  }
  const rect = root.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

export function routeSplitWorktreeDrag(x: number, y: number): boolean {
  const drag = session
  if (!drag) {
    return false
  }
  if (isWorkspaceKanbanSidebarDropPointInBoard(x, y)) {
    showCardPreview(true)
    useSplitWorktreeState.setState({ dragging: false, preview: null })
    return false
  }
  const rect = workspaceRect()
  if (!rect) {
    return false
  }
  const inside = pointInSplitRect(rect, x, y)
  const edge = inside && drag.selected.length === 1 ? splitEdgeAt(rect, x, y) : null
  showCardPreview(edge === null)
  const replacing = useSplitWorktreeState.getState().layout !== null
  const preview = {
    rect,
    edge,
    label: edge ? (replacing ? `Replace ${edge}` : `Open on the ${edge}`) : ''
  }
  useSplitWorktreeState.setState({ dragging: true, preview })
  if (!inside) {
    return false
  }
  clearWorkspaceKanbanSidebarDropTargetVisual()
  drag.runtime.setDragOverStatus(null)
  drag.runtime.setDragOverStatusGroupKey(null)
  drag.runtime.setPinDragOver(false)
  return true
}

export function consumeSplitWorktreeDrop(
  event: PointerEvent,
  ctx: WorktreeDropCommitContext
): boolean {
  const drag = session
  if (!drag || isWorkspaceKanbanSidebarDropPointInBoard(event.clientX, event.clientY)) {
    return false
  }
  const rect = workspaceRect()
  if (!rect || !pointInSplitRect(rect, event.clientX, event.clientY)) {
    return false
  }
  const edge = splitEdgeAt(rect, event.clientX, event.clientY)
  const source = drag.selected.length === 1 ? splitWorkspaceFromRow(drag.source) : null
  ctx.clearWorktreeDrag()
  if (edge && source) {
    void openSplitWorktree(source, edge)
  } else if (edge && drag.selected.length > 1) {
    toast.error('Drag one workspace to open a split view.')
  }
  return true
}

export function dispatchSplitFallbackMove(event: PointerEvent, threshold: number): boolean {
  return session?.fallback === true && moveSplitFallback(event, session, threshold)
}

export function dispatchSplitFallbackRelease(
  event: PointerEvent,
  ctx: WorktreeDropCommitContext,
  boardDrop: (args: WorktreeStatusDropAtIndexArgs) => void
): boolean {
  return session?.fallback === true && releaseSplitFallback(event, session, ctx, boardDrop)
}

export function cancelSplitPointer(event?: PointerEvent): void {
  if (!session || (event && event.pointerId !== session.pointerId)) {
    return
  }
  const runtime = session.runtime
  clearSplitWorktreeDrag()
  runtime.clearWorktreeDrag()
}

export function cleanupSplitPointerClick(): void {
  if (session && !useSplitWorktreeState.getState().dragging) {
    clearSplitWorktreeDrag()
  }
}

useSplitPreference.subscribe((next, previous) => {
  if (next.enabled !== previous.enabled || next.ready !== previous.ready) {
    cancelSplitPointer()
  }
})
