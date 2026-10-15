import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import { resolveStrictWorktreeOperationRouteResultForHost } from '@/lib/worktree-operation-route'
import { canAdmitTerminalTabsForStartup } from '@/components/terminal/background-terminal-worktree-mount'
import { captureParkedTerminalBuffers } from '@/components/terminal-pane/parked-terminal-buffer-capture'
import { shutdownBufferCaptures } from '@/components/terminal-pane/shutdown-buffer-captures'
import { requestManualTerminalWorktreePark } from '@/lib/manual-terminal-worktree-parking'
import { prepareWindowWorkspaceClaims } from '@/jose-window/window-workspace-claims'
import { redirectIfOwnedElsewhere } from '@/jose-window/ownership-guard'
import { isFloatingWorkspaceId } from '../../../shared/floating-workspace-worktree'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { parseExecutionHostId } from '../../../shared/execution-host'
import type { Worktree } from '../../../shared/worktree/types'
import {
  planSplitLayout,
  publishSplitLayout,
  sameSplitWorkspace,
  useSplitWorktreeState,
  type SplitEdge,
  type SplitLayout,
  type SplitWorkspaceRef
} from './split-worktree-state'
import { saveSplitWorktreeLayout } from './split-worktree-persistence'
import { canParkSplitWorktree } from './split-worktree-park-policy'

let activating = false
let operation = 0

export function splitWorkspaceFromRow(worktree: Worktree): SplitWorkspaceRef | null {
  const executionHostId =
    parseExecutionHostId(worktree.hostId)?.id ??
    getResolvedExecutionHostIdForWorktree(useAppStore.getState(), worktree.id)
  return executionHostId ? { worktreeId: worktree.id, executionHostId } : null
}

export function activeSplitWorkspace(): SplitWorkspaceRef | null {
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  const executionHostId = getResolvedExecutionHostIdForWorktree(state, worktreeId)
  return worktreeId && executionHostId ? { worktreeId, executionHostId } : null
}

function hasSplitWorkspaceFocus(ref: SplitWorkspaceRef): boolean {
  const state = useAppStore.getState()
  return (
    state.activeView === 'terminal' &&
    state.activeWorktreeId === ref.worktreeId &&
    (state.activeWorkspaceExecutionHostId ??
      getResolvedExecutionHostIdForWorktree(state, ref.worktreeId)) === ref.executionHostId
  )
}

export function focusSplitWorkspace(ref: SplitWorkspaceRef): boolean {
  // Restored pane focus must not restart activation while its PTY is still reconnecting.
  if (hasSplitWorkspaceFocus(ref)) {
    return true
  }
  activating = true
  try {
    const result = activateAndRevealWorkspace(ref.worktreeId, {
      executionHostId: ref.executionHostId,
      revealInSidebar: false
    })
    return result !== false && hasSplitWorkspaceFocus(ref)
  } finally {
    activating = false
  }
}

function canOpen(ref: SplitWorkspaceRef): boolean {
  const state = useAppStore.getState()
  if (isFloatingWorkspaceId(ref.worktreeId)) {
    return false
  }
  const scope = parseWorkspaceKey(ref.worktreeId)
  const exists =
    scope?.type === 'folder'
      ? state.folderWorkspaces.some((folder) => folder.id === scope.folderWorkspaceId)
      : Boolean(state.getKnownWorktreeById(ref.worktreeId, ref.executionHostId))
  return (
    exists &&
    resolveStrictWorktreeOperationRouteResultForHost(state, ref.worktreeId, ref.executionHostId)
      .kind === 'resolved'
  )
}

function parkRemovedWorkspaces(
  previous: SplitLayout | null,
  retained: readonly SplitWorkspaceRef[]
): void {
  for (const ref of previous?.slots ?? []) {
    if (retained.some((next) => sameSplitWorkspace(next, ref))) {
      continue
    }
    const state = useAppStore.getState()
    const captured = captureParkedTerminalBuffers({
      worktreeId: ref.worktreeId,
      tabIds: (state.tabsByWorktree[ref.worktreeId] ?? [])
        .map((tab) => tab.id)
        .filter((id) => shutdownBufferCaptures.has(id)),
      repos: state.repos,
      localOnly: true
    })
    // Keep automatic split cleanup silent when parking safety checks fail.
    if (captured && canParkSplitWorktree(ref.worktreeId, useAppStore.getState())) {
      requestManualTerminalWorktreePark(ref.worktreeId)
    }
  }
}

export async function openSplitWorktree(
  source: SplitWorkspaceRef,
  edge: SplitEdge
): Promise<boolean> {
  const state = useAppStore.getState()
  const active = activeSplitWorkspace()
  const before = useSplitWorktreeState.getState()
  if (before.pending || !active) {
    return false
  }
  if (!canAdmitTerminalTabsForStartup(state) || !canOpen(source)) {
    toast.error('This workspace is not ready to open in a split.')
    return false
  }
  const currentSlots = before.layout?.slots ?? [active]
  if (currentSlots.some((ref) => sameSplitWorkspace(ref, source))) {
    return focusSplitWorkspace(source)
  }
  const next = planSplitLayout(before.layout, active, source, edge)
  if (next.slots[0].worktreeId === next.slots[1].worktreeId) {
    toast.error('Workspaces with the same ID on different hosts cannot share a split view.')
    return false
  }
  return acceptLayout(next, source)
}

export async function acceptLayout(next: SplitLayout, focus: SplitWorkspaceRef): Promise<boolean> {
  const previous = useSplitWorktreeState.getState().layout
  const previousFocus = activeSplitWorkspace()
  const revision = ++operation
  useSplitWorktreeState.setState({ pending: true })
  const preparation = await prepareWindowWorkspaceClaims(next.slots)
  if (preparation.status !== 'accepted') {
    useSplitWorktreeState.setState({ pending: false })
    if (preparation.status === 'refused') {
      const blocked = preparation.blockedRefs[0]
      toast.error(
        'This workspace is already open in another window.',
        blocked
          ? {
              action: {
                label: 'Show other window',
                onClick: () =>
                  redirectIfOwnedElsewhere(blocked.worktreeId, {
                    executionHostId: blocked.executionHostId
                  })
              }
            }
          : {}
      )
    } else {
      toast.error(
        preparation.status === 'unsupported'
          ? 'Update the workspace host to use split views.'
          : 'Workspace ownership could not be confirmed. Try again when the host is connected.'
      )
    }
    return false
  }
  if (revision !== operation || next.slots.some((ref) => !canOpen(ref))) {
    await preparation.rollback()
    useSplitWorktreeState.setState({ pending: false })
    return false
  }
  try {
    for (const ref of next.slots) {
      useAppStore.getState().reconcileWorktreeTabModel(ref.worktreeId)
      useAppStore.getState().ensureWorktreeRootGroup(ref.worktreeId)
    }
    publishSplitLayout(next)
    if (!focusSplitWorkspace(focus)) {
      throw new Error('Workspace activation was refused')
    }
    preparation.commit()
    saveSplitWorktreeLayout(next, focus)
    parkRemovedWorkspaces(previous, next.slots)
    return true
  } catch {
    publishSplitLayout(previous)
    await preparation.rollback()
    if (previousFocus) {
      focusSplitWorkspace(previousFocus)
    }
    toast.error('Could not open this workspace in the split view.')
    return false
  }
}

export async function closeSplitWorktree(worktreeId: string): Promise<void> {
  const previous = useSplitWorktreeState.getState().layout
  if (!previous || useSplitWorktreeState.getState().pending) {
    return
  }
  const survivor = previous.slots.find((ref) => ref.worktreeId !== worktreeId)
  if (!survivor) {
    return
  }
  const state = useAppStore.getState()
  captureParkedTerminalBuffers({
    worktreeId,
    tabIds: (state.tabsByWorktree[worktreeId] ?? [])
      .map((tab) => tab.id)
      .filter((id) => shutdownBufferCaptures.has(id)),
    repos: state.repos,
    localOnly: true
  })
  useSplitWorktreeState.setState({ pending: true })
  const preparation = await prepareWindowWorkspaceClaims([survivor])
  if (preparation.status !== 'accepted') {
    useSplitWorktreeState.setState({ pending: false })
    toast.error('Could not confirm workspace ownership. Reconnect before closing this split.')
    return
  }
  try {
    if (!focusSplitWorkspace(survivor)) {
      throw new Error('Surviving workspace could not be activated')
    }
    preparation.commit()
    publishSplitLayout(null)
    saveSplitWorktreeLayout(null, survivor)
    parkRemovedWorkspaces(previous, [survivor])
  } catch {
    await preparation.rollback()
    publishSplitLayout(previous)
    toast.error('Could not close this split. Workspace ownership changed.')
  }
}

export function leaveEmptySplitWorkspace(
  worktreeId: string,
  executionHostId?: SplitWorkspaceRef['executionHostId']
): boolean {
  const layout = useSplitWorktreeState.getState().layout
  const removed = layout?.slots.find(
    (ref) =>
      ref.worktreeId === worktreeId && (!executionHostId || ref.executionHostId === executionHostId)
  )
  const survivor = layout?.slots.find((ref) => ref.worktreeId !== worktreeId)
  if (!removed || !survivor || !focusSplitWorkspace(survivor)) {
    return false
  }
  void closeSplitWorktree(worktreeId)
  return true
}

export function routeSplitWorkspaceNavigation(source: SplitWorkspaceRef): boolean {
  const { layout } = useSplitWorktreeState.getState()
  if (activating || !layout || layout.slots.some((ref) => sameSplitWorkspace(ref, source))) {
    return false
  }
  const active = activeSplitWorkspace()
  const first = active ? sameSplitWorkspace(layout.slots[0], active) : true
  const edge = layout.axis === 'horizontal' ? (first ? 'left' : 'right') : first ? 'top' : 'bottom'
  void openSplitWorktree(source, edge)
  return true
}

export function cancelSplitWorktreeTransition(): void {
  operation += 1
  useSplitWorktreeState.setState({ pending: false })
}
