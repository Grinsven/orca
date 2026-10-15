import { useCallback, type CSSProperties, type HTMLAttributes } from 'react'
import { useAppStore } from '@/store'
import { focusSplitWorkspace } from './split-worktree-actions'
import {
  retainedSplitWorkspace,
  useSplitWorktreeState,
  type SplitLayout
} from './split-worktree-state'

export function splitSurfaceGeometry(layout: SplitLayout, index: number): CSSProperties {
  const first = index === 0
  const offset = first ? 0 : layout.ratio * 100
  const size = (first ? layout.ratio : 1 - layout.ratio) * 100
  return {
    left: layout.axis === 'horizontal' ? `${offset}%` : 0,
    top: layout.axis === 'vertical' ? `${offset}%` : 0,
    width: layout.axis === 'horizontal' ? `${size}%` : '100%',
    height: layout.axis === 'vertical' ? `${size}%` : '100%',
    right: 'auto',
    bottom: 'auto',
    flexDirection: 'column'
  }
}

export function splitWorkspaceHasFocus(worktreeId: string): boolean {
  const split = useSplitWorktreeState.getState()
  if (!retainedSplitWorkspace(worktreeId)) {
    return true
  }
  const state = useAppStore.getState()
  return !split.pending && !split.ownershipUnconfirmed && state.activeWorktreeId === worktreeId
}

export function useSplitWorkspaceHasFocus(worktreeId: string): boolean {
  const active = useAppStore((state) => state.activeWorktreeId === worktreeId)
  const member = useSplitWorktreeState((state) =>
    Boolean(state.layout?.slots.some((ref) => ref.worktreeId === worktreeId))
  )
  const blocked = useSplitWorktreeState((state) => state.pending || state.ownershipUnconfirmed)
  return !member || (active && !blocked)
}

export function useSplitGroupFocus(
  worktreeId: string,
  next: (groupId: string) => void
): (groupId: string) => void {
  return useCallback(
    (groupId) => {
      const ref = retainedSplitWorkspace(worktreeId)
      if (ref && !focusSplitWorkspace(ref)) {
        return
      }
      next(groupId)
    },
    [worktreeId, next]
  )
}

export function useSplitWorktreeSurface(
  worktreeId: string,
  isVisible: boolean
): HTMLAttributes<HTMLDivElement> {
  const layout = useSplitWorktreeState((state) => state.layout)
  const blocked = useSplitWorktreeState((state) => state.pending || state.ownershipUnconfirmed)
  const index = layout?.slots.findIndex((slot) => slot.worktreeId === worktreeId) ?? -1
  if (!layout || index < 0) {
    return {}
  }
  const ref = layout.slots[index === 0 ? 0 : 1]
  const focus = (): void => {
    if (
      !useSplitWorktreeState.getState().ownershipUnconfirmed &&
      useAppStore.getState().activeWorktreeId !== worktreeId
    ) {
      focusSplitWorkspace(ref)
    }
  }
  return {
    inert: !isVisible || blocked,
    style: splitSurfaceGeometry(layout, index),
    onPointerDownCapture: focus,
    onFocusCapture: focus
  }
}

export function applySplitSurfaceGeometry(layout: SplitLayout): void {
  document.querySelectorAll<HTMLElement>('[data-jose-split-workspace]').forEach((element) => {
    const index = layout.slots.findIndex(
      (slot) => slot.worktreeId === element.dataset.joseSplitWorkspace
    )
    if (index === -1) {
      return
    }
    const style = splitSurfaceGeometry(layout, index)
    element.style.left = String(style.left)
    element.style.top = String(style.top)
    element.style.width = String(style.width)
    element.style.height = String(style.height)
  })
}
