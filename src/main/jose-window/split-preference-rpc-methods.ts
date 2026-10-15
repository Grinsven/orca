import { defineMethod, defineStreamingMethod, type RpcContext } from '../runtime/rpc/core'
import { JoseWindowSplitPreference } from '../../shared/rpc-contract/jose-window-params'
import { windowKeyForCaller } from './window-ownership-registry'
import { splitPreferenceStore } from './split-preference-store'

function requireWindow(ctx: RpcContext): void {
  if (!windowKeyForCaller(ctx.caller)) {
    throw new Error('Only an Orca window can change this preference')
  }
}

let sequence = 0

export const JOSE_SPLIT_PREFERENCE_METHODS = [
  defineMethod({
    name: 'joseWindow.splitPreference.set',
    permission: 'workspace',
    params: JoseWindowSplitPreference,
    handler: async ({ enabled }, ctx) => {
      requireWindow(ctx)
      splitPreferenceStore().write(enabled)
      return { enabled }
    }
  }),
  defineStreamingMethod({
    name: 'joseWindow.splitPreference.subscribe',
    permission: 'workspace',
    params: null,
    handler: async (_params, ctx, emit) => {
      requireWindow(ctx)
      const subscriptionId = `jose-split-preference-${++sequence}`
      await new Promise<void>((resolve) => {
        const stop = splitPreferenceStore().subscribe((enabled) => emit({ enabled }))
        const release = (): void => ctx.runtime.cleanupSubscription(subscriptionId)
        ctx.runtime.registerSubscriptionCleanup(
          subscriptionId,
          () => {
            ctx.signal?.removeEventListener('abort', release)
            stop()
            resolve()
          },
          ctx.connectionId,
          ctx.requestId
        )
        if (ctx.signal?.aborted) {
          release()
        } else {
          ctx.signal?.addEventListener('abort', release, { once: true })
        }
      })
    }
  })
]
