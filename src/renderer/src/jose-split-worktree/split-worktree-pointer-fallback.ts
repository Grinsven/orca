import type { SplitDragSession } from './split-worktree-drag'
import {
  clearSplitWorktreeDrag,
  consumeSplitWorktreeDrop,
  routeSplitWorktreeDrag
} from './split-worktree-drag'
import {
  createSidebarDragPreview,
  setSidebarPointerDragDocumentStyles,
  updateSidebarDragPreviewPosition
} from '@/components/sidebar/worktree-sidebar-pointer-drag-dom'
import {
  getWorkspaceKanbanSidebarDropGroups,
  getWorkspaceKanbanSidebarDropTarget,
  resolveWorkspaceKanbanSidebarFullLaneDropIndex,
  updateWorkspaceKanbanSidebarDropTargetVisual
} from '@/components/sidebar/workspace-kanban-sidebar-drop'
import { getWorkspaceStatusGroupKey } from '@/components/sidebar/workspace-status'
import type {
  WorktreeDropCommitContext,
  WorktreeStatusDropAtIndexArgs
} from '@/components/sidebar/worktree-list/drag/drop-commit-context'

let preview: ReturnType<typeof createSidebarDragPreview> | null = null

export function clearSplitFallback(): void {
  if (!preview) {
    return
  }
  preview.preview.remove()
  preview = null
  setSidebarPointerDragDocumentStyles(false)
}

export function moveSplitFallback(
  event: PointerEvent,
  drag: SplitDragSession,
  threshold: number
): boolean {
  if (event.pointerId !== drag.pointerId) {
    return false
  }
  if (!preview) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < threshold) {
      return true
    }
    preview = createSidebarDragPreview({
      sourceRow: drag.sourceRow,
      pointerX: event.clientX,
      pointerY: event.clientY,
      draggedCount: drag.selected.length
    })
    setSidebarPointerDragDocumentStyles(true)
  }
  event.preventDefault()
  event.stopPropagation()
  drag.runtime.suppressWorktreeClickUntilRef.current = performance.now() + 500
  updateSidebarDragPreviewPosition({
    preview: preview.preview,
    pointerX: event.clientX,
    pointerY: event.clientY,
    offsetX: preview.offsetX,
    offsetY: preview.offsetY
  })
  if (!routeSplitWorktreeDrag(event.clientX, event.clientY)) {
    updateWorkspaceKanbanSidebarDropTargetVisual({
      x: event.clientX,
      y: event.clientY,
      shouldShowDropIndicator: (target) => Boolean(target.status || target.isPinDrop)
    })
  }
  return true
}

export function releaseSplitFallback(
  event: PointerEvent,
  drag: SplitDragSession,
  ctx: WorktreeDropCommitContext,
  boardDrop: (args: WorktreeStatusDropAtIndexArgs) => void
): boolean {
  if (event.pointerId !== drag.pointerId) {
    return false
  }
  if (!preview) {
    clearSplitWorktreeDrag()
    return false
  }
  event.preventDefault()
  event.stopPropagation()
  drag.runtime.suppressWorktreeClickUntilRef.current = performance.now() + 500
  if (consumeSplitWorktreeDrop(event, ctx)) {
    return true
  }
  const target = getWorkspaceKanbanSidebarDropTarget(event.clientX, event.clientY)
  const ids = drag.selected.map((worktree) => worktree.id)
  if (target.isPinDrop) {
    ctx.onPinWorktrees(ids)
  } else if (target.status) {
    boardDrop({
      worktreeIds: ids,
      status: target.status,
      targetGroupKey: getWorkspaceStatusGroupKey(target.status),
      dropIndex: resolveWorkspaceKanbanSidebarFullLaneDropIndex(target.status, target.dropIndex),
      groups: getWorkspaceKanbanSidebarDropGroups()
    })
  }
  ctx.clearWorktreeDrag()
  return true
}
