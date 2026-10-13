import type {
  JoseWindowOwnershipFrame,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import {
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  type ExecutionHostId
} from '../../../shared/execution-host'
import { isFloatingWorkspaceId } from '../../../shared/floating-workspace-worktree'
import { composeWorktreeHostIdentity } from '../../../shared/worktree/host-qualified-identity'
import type { RuntimeClientTarget } from '@/runtime/runtime-rpc-client'
import {
  resolveWorktreeOperationRouteForHost,
  type WorktreeOperationRouteState
} from '@/lib/worktree-operation-route'
import {
  getExecutionHostIdForWorktree,
  getRuntimeEnvironmentIdForWorktree,
  type WorktreeRuntimeOwnerState
} from '@/lib/worktree-runtime-owner'

export type OwnershipState = WorktreeRuntimeOwnerState & WorktreeOperationRouteState

/** Stable key for a ref; the host side compares the same composition. */
export function ownershipKey(ref: JoseWindowWorktreeRef): string {
  return composeWorktreeHostIdentity(parseExecutionHostId(ref.executionHostId)?.id, ref.worktreeId)
}

function hostEnvironmentId(target: RuntimeClientTarget): string | null {
  return target.kind === 'environment' ? target.environmentId : null
}

/**
 * The host-side ref for a workspace as this window names it, or null when the ownership host does
 * not serve it. Window 2 sees the host's own checkouts as `runtime:<env>`; the host calls them
 * `local`. Same-id workspaces on any other host are never shared between windows.
 */
export function resolveOwnershipRef(
  state: OwnershipState,
  target: RuntimeClientTarget,
  worktreeId: string,
  executionHostId?: ExecutionHostId | null
): JoseWindowWorktreeRef | null {
  if (isFloatingWorkspaceId(worktreeId)) {
    return null
  }
  let runtimeEnvironmentId: string | null
  let viewHost: ExecutionHostId
  if (executionHostId) {
    const route = resolveWorktreeOperationRouteForHost(state, worktreeId, executionHostId)
    if (!route) {
      return null
    }
    runtimeEnvironmentId = route.runtimeEnvironmentId
    viewHost = executionHostId
  } else {
    runtimeEnvironmentId = getRuntimeEnvironmentIdForWorktree(state, worktreeId)
    viewHost = getExecutionHostIdForWorktree(state, worktreeId)
  }
  const hostEnv = hostEnvironmentId(target)
  if (runtimeEnvironmentId !== hostEnv) {
    return null
  }
  const parsed = parseExecutionHostId(viewHost)
  if (parsed?.kind === 'runtime') {
    // Only the ownership host itself maps to its `local`.
    return hostEnv !== null && parsed.environmentId === hostEnv
      ? { worktreeId, executionHostId: 'local' }
      : null
  }
  return parsed ? { worktreeId, executionHostId: parsed.id } : null
}

/** The ref this window has active, read with its selected host. */
export function activeOwnershipRef(
  state: OwnershipState,
  target: RuntimeClientTarget
): JoseWindowWorktreeRef | null {
  const worktreeId = state.activeWorktreeId
  return worktreeId
    ? resolveOwnershipRef(state, target, worktreeId, state.activeWorkspaceExecutionHostId)
    : null
}

/** How this window names a host-side ref's execution host: the inverse of resolveOwnershipRef. */
export function viewExecutionHostId(
  ref: JoseWindowWorktreeRef,
  target: RuntimeClientTarget
): ExecutionHostId | undefined {
  const parsed = parseExecutionHostId(ref.executionHostId)
  const hostEnv = hostEnvironmentId(target)
  if (parsed?.kind === 'local' && hostEnv !== null) {
    return toRuntimeExecutionHostId(hostEnv)
  }
  return parsed?.id
}

export const keyOf = (ref: JoseWindowWorktreeRef | null): string | null =>
  ref ? ownershipKey(ref) : null

/** Snapshot refs, reading an older host's bare ids as its own checkouts. */
export function snapshotRefs(frame: Extract<JoseWindowOwnershipFrame, { type: 'snapshot' }>): {
  elsewhere: JoseWindowWorktreeRef[]
  here: JoseWindowWorktreeRef | null
} {
  const local = (worktreeId: string): JoseWindowWorktreeRef => ({
    worktreeId,
    executionHostId: 'local'
  })
  return {
    elsewhere: frame.ownedElsewhereRefs ?? frame.ownedElsewhere.map(local),
    here:
      frame.ownedHereRef !== undefined
        ? frame.ownedHereRef
        : frame.ownedHere
          ? local(frame.ownedHere)
          : null
  }
}
