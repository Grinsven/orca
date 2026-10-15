import { create } from 'zustand'
import type { WindowWorkspaceRef } from '@/jose-window/window-workspace-claims'
import { getWindowWorkspaceClaims } from '@/jose-window/window-workspace-claims'

export type SplitWorkspaceRef = WindowWorkspaceRef
export type SplitEdge = 'left' | 'right' | 'top' | 'bottom'
export type SplitLayout = {
  slots: readonly [SplitWorkspaceRef, SplitWorkspaceRef]
  axis: 'horizontal' | 'vertical'
  ratio: number
}
export type SplitPreview = {
  edge: SplitEdge | null
  rect: { left: number; top: number; width: number; height: number }
  label: string
}
type SplitWorktreeState = {
  layout: SplitLayout | null
  revision: number
  pending: boolean
  preview: SplitPreview | null
  dragging: boolean
  ownershipUnconfirmed: boolean
}
export const useSplitWorktreeState = create<SplitWorktreeState>(() => ({
  layout: null,
  revision: 0,
  pending: false,
  preview: null,
  dragging: false,
  ownershipUnconfirmed: false
}))

export function sameSplitWorkspace(a: SplitWorkspaceRef, b: SplitWorkspaceRef): boolean {
  return a.worktreeId === b.worktreeId && a.executionHostId === b.executionHostId
}

export function publishSplitLayout(layout: SplitLayout | null): void {
  const claims = getWindowWorkspaceClaims()
  const confirmed =
    claims.status !== 'unverifiable' &&
    claims.status !== 'unsupported' &&
    (layout?.slots.every((slot) => claims.ownedRefs.some((ref) => sameSplitWorkspace(slot, ref))) ??
      true)
  useSplitWorktreeState.setState((state) => ({
    layout,
    revision: state.revision + 1,
    pending: false,
    ownershipUnconfirmed: layout !== null && !confirmed
  }))
}

export function isSplitWorktreeVisible(worktreeId: string, activeView: string): boolean {
  return (
    activeView === 'terminal' &&
    Boolean(
      useSplitWorktreeState.getState().layout?.slots.some((slot) => slot.worktreeId === worktreeId)
    )
  )
}

export function retainedSplitWorkspace(worktreeId: string): SplitWorkspaceRef | undefined {
  return useSplitWorktreeState
    .getState()
    .layout?.slots.find((slot) => slot.worktreeId === worktreeId)
}

export function planSplitLayout(
  layout: SplitLayout | null,
  active: SplitWorkspaceRef,
  source: SplitWorkspaceRef,
  edge: SplitEdge
): SplitLayout {
  const first = edge === 'left' || edge === 'top'
  const other = layout ? layout.slots[first ? 1 : 0] : active
  return {
    slots: first ? [source, other] : [other, source],
    axis: edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical',
    ratio: 0.5
  }
}
