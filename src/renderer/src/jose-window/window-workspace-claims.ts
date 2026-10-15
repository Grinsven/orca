import type { ExecutionHostId } from '../../../shared/execution-host'

export type WindowWorkspaceRef = { worktreeId: string; executionHostId: ExecutionHostId }
export type WindowWorkspaceClaimState = {
  status: 'ready' | 'unsupported' | 'unverifiable' | 'refused'
  ownedRefs: readonly WindowWorkspaceRef[]
  blockedRefs: readonly WindowWorkspaceRef[]
}
export type WindowWorkspaceClaimPreparation =
  | { status: 'accepted'; commit: () => void; rollback: () => Promise<void> }
  | {
      status: 'refused' | 'unsupported' | 'unverifiable'
      blockedRefs: readonly WindowWorkspaceRef[]
    }

export type WindowWorkspaceClaimSession = {
  prepare: (refs: readonly WindowWorkspaceRef[]) => Promise<WindowWorkspaceClaimPreparation>
}

let session: WindowWorkspaceClaimSession | null = null
let state: WindowWorkspaceClaimState = { status: 'unverifiable', ownedRefs: [], blockedRefs: [] }
const listeners = new Set<(next: WindowWorkspaceClaimState) => void>()

export function publishWindowWorkspaceClaims(next: WindowWorkspaceClaimState): void {
  state = next
  listeners.forEach((listener) => listener(next))
}

export function bindWindowWorkspaceClaimSession(next: WindowWorkspaceClaimSession): () => void {
  session = next
  return () => {
    if (session === next) {
      session = null
      publishWindowWorkspaceClaims({ status: 'unverifiable', ownedRefs: [], blockedRefs: [] })
    }
  }
}

/** Claims the complete prospective layout before its workspace surfaces mount. */
export function prepareWindowWorkspaceClaims(
  refs: readonly WindowWorkspaceRef[]
): Promise<WindowWorkspaceClaimPreparation> {
  return session?.prepare(refs) ?? Promise.resolve({ status: 'unverifiable', blockedRefs: [] })
}

export function getWindowWorkspaceClaims(): WindowWorkspaceClaimState {
  return state
}

export function subscribeWindowWorkspaceClaims(
  listener: (next: WindowWorkspaceClaimState) => void
): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
