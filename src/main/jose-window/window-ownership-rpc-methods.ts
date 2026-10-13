import { defineMethod, defineStreamingMethod, type RpcContext } from '../runtime/rpc/core'
import {
  JoseWindowClaimParams,
  JoseWindowRevealParams,
  type JoseWindowClaimResult,
  type JoseWindowRevealResult
} from '../../shared/rpc-contract/jose-window-params'
import {
  toWorktreeRef,
  windowKeyForCaller,
  windowOwnershipRegistry
} from './window-ownership-registry'

let subscriptionSeq = 0

function requireWindowKey(ctx: Pick<RpcContext, 'caller'>): string {
  const windowKey = windowKeyForCaller(ctx.caller)
  if (!windowKey) {
    throw new Error('Only an Orca window can own worktrees')
  }
  return windowKey
}

export const JOSE_WINDOW_METHODS = [
  defineStreamingMethod({
    name: 'joseWindow.subscribe',
    permission: 'workspace',
    params: null,
    handler: async (_params, ctx, emit) => {
      const windowKey = requireWindowKey(ctx)
      const { runtime, connectionId, requestId, signal } = ctx
      await new Promise<void>((resolve) => {
        const unsubscribe = windowOwnershipRegistry.subscribe(windowKey, emit)
        const subscriptionId = `jose-window-${connectionId ?? 'inproc'}-${++subscriptionSeq}`
        let ended = false
        const end = (): void => {
          if (ended) {
            return
          }
          ended = true
          signal?.removeEventListener('abort', release)
          unsubscribe()
          emit({ type: 'end' })
          resolve()
        }
        // Why: a closing socket reaps through the registry; an IPC unsubscribe aborts the signal.
        const release = (): void => runtime.cleanupSubscription(subscriptionId)
        runtime.registerSubscriptionCleanup(subscriptionId, end, connectionId, requestId)
        if (signal?.aborted) {
          release()
        } else {
          signal?.addEventListener('abort', release, { once: true })
        }
      })
    }
  }),
  defineMethod({
    name: 'joseWindow.claim',
    permission: 'workspace',
    params: JoseWindowClaimParams,
    handler: async (params, ctx): Promise<JoseWindowClaimResult> =>
      windowOwnershipRegistry.claim(
        requireWindowKey(ctx),
        params.worktreeId === null ? null : toWorktreeRef(params.worktreeId, params.executionHostId)
      )
  }),
  defineMethod({
    name: 'joseWindow.reveal',
    permission: 'workspace',
    params: JoseWindowRevealParams,
    handler: async (params, ctx): Promise<JoseWindowRevealResult> =>
      windowOwnershipRegistry.reveal(
        requireWindowKey(ctx),
        toWorktreeRef(params.worktreeId, params.executionHostId)
      )
  })
]
