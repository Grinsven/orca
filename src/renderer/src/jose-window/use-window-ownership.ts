import { useEffect } from 'react'
import { useSplitPreferenceConnection } from '@/jose-split-worktree/split-worktree-preference'
import { useAppStore } from '@/store'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  claimWorktree,
  claimWorktreeSet,
  isMissingOwnershipMethod,
  resolveOwnershipTarget,
  revealWorktreeOwner,
  subscribeOwnership
} from './window-ownership-client'
import { startWindowOwnership } from './window-ownership-session'
import { openWindowOnHost } from './open-window-on-host'

/** Visible workspace ownership stays active while the window is hidden so it can answer reveals. */
export function useWindowOwnership(): void {
  useSplitPreferenceConnection()
  const profileId = useAppStore((state) => state.activeOrcaProfileId)
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
        claimSet: claimWorktreeSet,
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
  }, [environmentId, profileId])
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
