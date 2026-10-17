import { defineMethod, defineStreamingMethod, type RpcContext } from '../runtime/rpc/core'
import { JOSE_SPLIT_PREFERENCE_METHODS } from './split-preference-rpc-methods'
import {
  JoseWindowClaimParams,
  JoseWindowClaimSetParams,
  type JoseWindowClaimSetResult,
  JoseWindowRevealParams,
  type JoseWindowClaimResult,
  type JoseWindowOpenWindowResult,
  type JoseWindowOwnersResult,
  type JoseWindowRevealResult
} from '../../shared/rpc-contract/jose-window-params'
import { isSecondWindowSlotProfile } from '../fork/second-window/second-window-slots'
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

// Why here and not in the asking window: a window opened by window 2 would pair to window 2's own
// runtime instead of to the host every window shares.
async function openWindowOnThisHost(): Promise<JoseWindowOpenWindowResult> {
  if (isSecondWindowSlotProfile(process.env.ORCA_USER_DATA_PATH ?? '')) {
    throw new Error('Only the main Orca window opens new windows')
  }
  // Lazy for the same reason as the menu item: the opener pulls in runtime and persistence modules.
  const { openSecondWindow } = await import('../fork/second-window/open-second-window')
  return { outcome: await openSecondWindow() }
}

export const JOSE_WINDOW_METHODS = [
  ...JOSE_SPLIT_PREFERENCE_METHODS,
  defineMethod({
    name: 'joseWindow.claimSet',
    permission: 'workspace',
    params: JoseWindowClaimSetParams,
    handler: async (params, ctx): Promise<JoseWindowClaimSetResult> =>
      windowOwnershipRegistry.claimSet(requireWindowKey(ctx), params)
  }),
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
        toWorktreeRef(params.worktreeId, params.executionHostId),
        params.intent
      )
  }),
  defineMethod({
    name: 'joseWindow.owners',
    permission: 'workspace',
    params: null,
    // Why no window key: the CLI owns no window but must not sleep a workspace another window shows.
    handler: async (): Promise<JoseWindowOwnersResult> => ({
      owners: windowOwnershipRegistry.liveOwners()
    })
  }),
  defineMethod({
    name: 'joseWindow.openWindow',
    permission: 'workspace',
    params: null,
    handler: async (_params, ctx): Promise<JoseWindowOpenWindowResult> => {
      requireWindowKey(ctx)
      return openWindowOnThisHost()
    }
  })
]
