import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import type {
  JoseWindowNavigationIntent,
  JoseWindowOwnershipFrame,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import { hasRuntimeRpcErrorCode } from '../../../shared/runtime-rpc-error-code'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { subscribeRuntimeEnvironment } from '@/runtime/runtime-environment-pairing-refresh'
import { isSecondaryWindow } from './is-secondary-window'

/** Window 1 owns through its local runtime; window 2 through the host it is paired to. Anything
 *  without the fork preload (web client, tests) takes no part. */
export function resolveOwnershipTarget(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
): RuntimeClientTarget | null {
  if (typeof window === 'undefined' || !window.joseWindow) {
    return null
  }
  if (!isSecondaryWindow()) {
    return { kind: 'local' }
  }
  const environmentId = settings?.activeRuntimeEnvironmentId?.trim()
  return environmentId ? { kind: 'environment', environmentId } : null
}

/** An older host has none of these methods: treat it as "nobody owns anything". */
export function isMissingOwnershipMethod(error: unknown): boolean {
  return hasRuntimeRpcErrorCode(error, 'method_not_found')
}

export type OwnershipSubscriptionCallbacks = {
  onFrame: (frame: JoseWindowOwnershipFrame) => void
  onError: (error: unknown) => void
  onClose: () => void
}

export async function subscribeOwnership(
  target: RuntimeClientTarget,
  callbacks: OwnershipSubscriptionCallbacks
): Promise<{ unsubscribe: () => void }> {
  const onResponse = (response: RuntimeRpcResponse<unknown>): void => {
    if (!response.ok) {
      callbacks.onError(response.error)
      return
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: joseWindow.subscribe emits only JoseWindowOwnershipFrame values (window-ownership-rpc-methods.ts).
    callbacks.onFrame(response.result as JoseWindowOwnershipFrame)
  }
  if (target.kind === 'local') {
    return window.api.runtime.subscribe({ method: 'joseWindow.subscribe' }, onResponse)
  }
  return subscribeRuntimeEnvironment(
    {
      selector: target.environmentId,
      method: 'joseWindow.subscribe',
      timeoutMs: 15_000,
      expectedEnvironmentPairingRevision: getRuntimeEnvironmentRevision(target.environmentId)
    },
    { onResponse, onError: callbacks.onError, onClose: callbacks.onClose }
  )
}

export async function claimWorktree(
  target: RuntimeClientTarget,
  ref: JoseWindowWorktreeRef | null
): Promise<boolean> {
  const result = await callRuntimeRpc<{ claimed: boolean }>(
    target,
    'joseWindow.claim',
    ref ?? { worktreeId: null },
    { timeoutMs: 10_000 }
  )
  return result.claimed
}

export async function revealWorktreeOwner(
  target: RuntimeClientTarget,
  ref: JoseWindowWorktreeRef,
  intent?: JoseWindowNavigationIntent
): Promise<boolean> {
  const result = await callRuntimeRpc<{ revealed: boolean }>(
    target,
    'joseWindow.reveal',
    { ...ref, ...(intent ? { intent } : {}) },
    { timeoutMs: 10_000 }
  )
  return result.revealed
}
