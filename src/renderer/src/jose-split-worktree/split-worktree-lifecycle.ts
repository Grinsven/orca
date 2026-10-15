import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { setWorkspaceNavigationInterceptor } from '@/jose-window/ownership-guard'
import { getResolvedExecutionHostIdForWorktree } from '@/lib/resolved-worktree-execution-host'
import {
  subscribeWindowWorkspaceClaims,
  getWindowWorkspaceClaims
} from '@/jose-window/window-workspace-claims'
import { canAdmitTerminalTabsForStartup } from '@/components/terminal/background-terminal-worktree-mount'
import {
  activeSplitWorkspace,
  acceptLayout,
  cancelSplitWorktreeTransition,
  routeSplitWorkspaceNavigation
} from './split-worktree-actions'
import {
  readSplitWorktreeLayout,
  saveSplitWorktreeLayout,
  splitPersistenceKey
} from './split-worktree-persistence'
import { publishSplitLayout, useSplitWorktreeState } from './split-worktree-state'
import { cancelSplitPointer } from './split-worktree-drag'

export function useSplitWorktreeLifecycle(): void {
  useEffect(() => {
    let scope = splitPersistenceKey()
    let restoreAttempted = false
    const stopNavigation = setWorkspaceNavigationInterceptor((worktreeId, options) => {
      const host =
        options?.executionHostId ??
        getResolvedExecutionHostIdForWorktree(useAppStore.getState(), worktreeId)
      return host ? routeSplitWorkspaceNavigation({ worktreeId, executionHostId: host }) : false
    })
    const checkRestore = (): void => {
      const nextScope = splitPersistenceKey()
      if (scope !== nextScope) {
        scope = nextScope
        restoreAttempted = false
        cancelSplitWorktreeTransition()
        cancelSplitPointer()
        publishSplitLayout(null)
      }
      const state = useAppStore.getState()
      if (
        !restoreAttempted &&
        canAdmitTerminalTabsForStartup(state) &&
        state.activeWorktreeId &&
        getWindowWorkspaceClaims().status === 'ready'
      ) {
        restoreAttempted = true
        const saved = readSplitWorktreeLayout()
        if (saved) {
          void acceptLayout(saved.layout, saved.focus)
        }
      }
      const layout = useSplitWorktreeState.getState().layout
      const focus = activeSplitWorkspace()
      if (layout && focus && layout.slots.some((ref) => ref.worktreeId === focus.worktreeId)) {
        saveSplitWorktreeLayout(layout, focus)
      }
    }
    const stopStore = useAppStore.subscribe((state, previous) => {
      if (
        state.activeWorktreeId !== previous.activeWorktreeId ||
        state.activeWorkspaceExecutionHostId !== previous.activeWorkspaceExecutionHostId ||
        state.activeOrcaProfileId !== previous.activeOrcaProfileId ||
        state.settings?.activeRuntimeEnvironmentId !==
          previous.settings?.activeRuntimeEnvironmentId ||
        state.workspaceSessionReady !== previous.workspaceSessionReady ||
        state.hydrationSucceeded !== previous.hydrationSucceeded ||
        state.startupWorktreeRefreshCompleted !== previous.startupWorktreeRefreshCompleted
      ) {
        checkRestore()
      }
    })
    const stopClaims = subscribeWindowWorkspaceClaims((claims) => {
      const layout = useSplitWorktreeState.getState().layout
      if (layout) {
        useSplitWorktreeState.setState({
          ownershipUnconfirmed: claims.status === 'unverifiable' || claims.status === 'unsupported'
        })
        if (
          claims.status === 'refused' &&
          claims.blockedRefs.some((ref) =>
            layout.slots.some(
              (slot) =>
                slot.worktreeId === ref.worktreeId && slot.executionHostId === ref.executionHostId
            )
          )
        ) {
          publishSplitLayout(null)
        }
      }
      checkRestore()
    })
    checkRestore()
    return () => {
      stopNavigation()
      stopStore()
      stopClaims()
      cancelSplitWorktreeTransition()
      cancelSplitPointer()
    }
  }, [])
}
