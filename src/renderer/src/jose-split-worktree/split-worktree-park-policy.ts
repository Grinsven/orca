import type { AppState } from '@/store/types'
import { tabHasLivePty } from '@/lib/tab-has-live-pty'
import { canManuallyParkTerminalWorktreeRenderers } from '@/components/terminal-pane/manual-terminal-worktree-park-eligibility'
import { canWatcherCoverParkedTerminalTab } from '@/components/terminal-pane/terminal-parked-tab-watchers'
import { selectPairedRuntimeParkingEnvironmentIds } from '@/components/terminal-pane/terminal-hidden-view-parking'

export function splitManualRestorePolicy(state: AppState) {
  return {
    sshParkingEnabled: state.settings?.terminalSshViewParking !== false,
    pairedRuntimeParkingEnvironmentIds: selectPairedRuntimeParkingEnvironmentIds(
      state.runtimeStatusByEnvironmentId
    )
  }
}

export function canParkSplitWorktree(worktreeId: string, state: AppState): boolean {
  const terminalTabs = state.tabsByWorktree[worktreeId] ?? []
  return (
    canManuallyParkTerminalWorktreeRenderers({
      worktreeId,
      terminalTabs,
      restorePolicy: splitManualRestorePolicy(state),
      pendingStartupByTabId: state.pendingStartupByTabId,
      parkingEnabled: state.settings?.terminalHiddenViewParking !== false,
      hasLivePty: (tabId) => tabHasLivePty(state.ptyIdsByTabId, tabId)
    }) && terminalTabs.every((tab) => canWatcherCoverParkedTerminalTab(worktreeId, tab))
  )
}
