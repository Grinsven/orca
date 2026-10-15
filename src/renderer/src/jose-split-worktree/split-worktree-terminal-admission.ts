import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useAppStore } from '@/store'
import {
  applyTerminalColdActivation,
  type TerminalColdActivationController
} from '@/components/terminal-cold-activation'
import { useActivationDeferredTabAdmission } from '@/components/terminal/use-activation-deferred-tab-admission'
import type { StartupTerminalTabHold } from '@/components/terminal/startup-terminal-tab-hold'
import { canAdmitTerminalTabsForStartup } from '@/components/terminal/background-terminal-worktree-mount'
import { selectPairedRuntimeParkingEnvironmentIds } from '@/components/terminal-pane/terminal-hidden-view-parking'
import { captureParkedTerminalBuffers } from '@/components/terminal-pane/parked-terminal-buffer-capture'
import { shutdownBufferCaptures } from '@/components/terminal-pane/shutdown-buffer-captures'
import type { AppState } from '@/store/types'
import { useSplitWorktreeState, type SplitLayout } from './split-worktree-state'
import { useSplitWorktreeLifecycle } from './split-worktree-lifecycle'

/** Runs the existing admission policy for the other visible workspace without a second controller. */
export function useSplitWorktreeAdmission(controller: TerminalColdActivationController): void {
  useSplitWorktreeLifecycle()
  const layout = useSplitWorktreeState((state) => state.layout)
  const lastActivationWorktreeIdRef = useRef<string | null>(null)
  const startupTerminalTabHoldRef = useRef<StartupTerminalTabHold | null>(null)
  const other =
    controller.activeView === 'terminal' && canAdmitTerminalTabsForStartup(controller)
      ? layout?.slots.find((ref) => ref.worktreeId !== controller.renderedActiveWorktreeId)
      : undefined
  const view = {
    ...controller,
    renderedActiveWorktreeId: other?.worktreeId ?? null,
    activeWorktreeDeferralHostId: other?.executionHostId ?? null,
    activeTabId: other ? (controller.activeTabIdByWorktree[other.worktreeId] ?? null) : null,
    lastActivationWorktreeIdRef,
    startupTerminalTabHoldRef
  }
  const admitted = { ...view, ...applyTerminalColdActivation(view) }
  useActivationDeferredTabAdmission(admitted)
  controller.anyMountedWorktreeHasLayout ||= admitted.anyMountedWorktreeHasLayout
  controller.activationDeferralPlanRevision = admitted.activationDeferralPlanRevision
}

export function addSplitForegroundTerminals(
  ids: Set<string>,
  state: AppState,
  layout: SplitLayout | null
): void {
  if (state.activeView !== 'terminal') {
    return
  }
  for (const ref of layout?.slots ?? []) {
    const tabs = state.unifiedTabsByWorktree[ref.worktreeId] ?? []
    for (const group of state.groupsByWorktree[ref.worktreeId] ?? []) {
      const tab = tabs.find((candidate) => candidate.id === group.activeTabId)
      if (tab?.contentType === 'terminal') {
        ids.add(tab.entityId)
      }
    }
  }
}

export function useSplitManualParkingReset(
  setParked: Dispatch<SetStateAction<ReadonlySet<string>>>
): void {
  const layout = useSplitWorktreeState((state) => state.layout)
  const activeView = useAppStore((state) => state.activeView)
  useEffect(() => {
    if (!layout || activeView !== 'terminal') {
      return
    }
    setParked((current) => {
      if (!layout.slots.some((ref) => current.has(ref.worktreeId))) {
        return current
      }
      const next = new Set(current)
      layout.slots.forEach((ref) => next.delete(ref.worktreeId))
      return next
    })
  }, [layout, activeView, setParked])
}

export function splitManualRestorePolicy(state: AppState) {
  return {
    sshParkingEnabled: state.settings?.terminalSshViewParking !== false,
    pairedRuntimeParkingEnvironmentIds: selectPairedRuntimeParkingEnvironmentIds(
      state.runtimeStatusByEnvironmentId
    )
  }
}

export function captureManuallyParkedSplit(worktreeId: string, state: AppState): boolean {
  return captureParkedTerminalBuffers({
    worktreeId,
    tabIds: (state.tabsByWorktree[worktreeId] ?? [])
      .map((tab) => tab.id)
      .filter((id) => shutdownBufferCaptures.has(id)),
    repos: state.repos,
    localOnly: true
  })
}
