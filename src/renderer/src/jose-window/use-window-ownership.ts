import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  claimWorktree,
  isMissingOwnershipMethod,
  resolveOwnershipTarget,
  revealWorktreeOwner,
  subscribeOwnership
} from './window-ownership-client'
import { startWindowOwnership } from './window-ownership-session'
import { openWindowOnHost } from './open-window-on-host'

/** One worktree per Orca window (fork). Deliberately not parked while hidden: a hidden window
 *  still owns its worktree and must still answer a reveal. */
export function useWindowOwnership(): void {
  const environmentId = useAppStore((s) => {
    const target = resolveOwnershipTarget(s.settings)
    return target === null ? undefined : target.kind === 'local' ? null : target.environmentId
  })
  useEffect(() => {
    if (environmentId === undefined) {
      return undefined
    }
    return startWindowOwnership(
      environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId },
      {
        store: useAppStore,
        subscribe: subscribeOwnership,
        claim: claimWorktree,
        reveal: revealWorktreeOwner,
        raise: () => {
          window.joseWindow?.raise?.().catch((error: unknown) => {
            console.warn('[jose-window] raise failed', error)
          })
        },
        applyIntent: (request) => {
          window.joseWindow?.applyIntent?.(request).catch((error: unknown) => {
            console.warn('[jose-window] applying a redirected request failed', error)
          })
        },
        activateHere: (worktreeId, executionHostId) =>
          activateAndRevealWorkspace(worktreeId, executionHostId ? { executionHostId } : {}) !==
          false,
        isMissingMethod: isMissingOwnershipMethod
      }
    )
  }, [environmentId])
  useEffect(() => {
    // Only a second window forwards New Window; the host window's menu opens it directly.
    if (!environmentId) {
      return undefined
    }
    return window.joseWindow?.onOpenWindowRequest?.(() => {
      void openWindowOnHost({ kind: 'environment', environmentId })
    })
  }, [environmentId])
}
