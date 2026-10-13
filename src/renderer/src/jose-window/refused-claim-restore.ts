import type { ExecutionHostId } from '../../../shared/execution-host'
import { isFloatingWorkspaceId } from '../../../shared/floating-workspace-worktree'
import { getExecutionHostIdFromWorktreeHostIdentity } from '../../../shared/worktree/host-qualified-identity'
import type { JoseWindowWorktreeRef } from '../../../shared/rpc-contract/jose-window-params'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import type { AppState } from '@/store/types'
import { getWorktreeIdFromVisitKey } from '@/lib/worktree-visit-recency'
import { keyOf, ownershipKey, resolveOwnershipRef } from './ownership-ref'

export type WorkspaceSelection = {
  worktreeId: string
  executionHostId: ExecutionHostId | undefined
}

/**
 * Where a window goes when the host refuses its selection: the last selection it held this run,
 * then the workspaces it visited most recently (startup restore has no earlier selection).
 */
export function restoreCandidates(
  lastVisitedAtByWorktreeId: Readonly<Record<string, number>>,
  previous: WorkspaceSelection | null
): WorkspaceSelection[] {
  const visited = Object.entries(lastVisitedAtByWorktreeId)
    .sort(([, a], [, b]) => b - a)
    .map(([visitKey]) => ({
      worktreeId: getWorktreeIdFromVisitKey(visitKey),
      executionHostId: getExecutionHostIdFromWorktreeHostIdentity(visitKey)
    }))
  return [...(previous ? [previous] : []), ...visited].filter(
    (candidate) => !isFloatingWorkspaceId(candidate.worktreeId)
  )
}

/** Activates the first candidate this window may show; with none left, the deliberate empty state. */
export function restoreSelectionAfterRefusal(args: {
  state: AppState
  target: RuntimeClientTarget
  refused: JoseWindowWorktreeRef
  previous: WorkspaceSelection | null
  ownedElsewhereKeys: ReadonlySet<string>
  activateHere: (worktreeId: string, executionHostId: ExecutionHostId | undefined) => boolean
}): void {
  const { state, target, ownedElsewhereKeys } = args
  const refusedKey = ownershipKey(args.refused)
  const restored = restoreCandidates(state.lastVisitedAtByWorktreeId, args.previous).some(
    (candidate) => {
      const key = keyOf(
        resolveOwnershipRef(state, target, candidate.worktreeId, candidate.executionHostId)
      )
      return (
        key !== refusedKey &&
        (key === null || !ownedElsewhereKeys.has(key)) &&
        args.activateHere(candidate.worktreeId, candidate.executionHostId)
      )
    }
  )
  if (!restored) {
    state.setActiveWorktree(null)
  }
}
