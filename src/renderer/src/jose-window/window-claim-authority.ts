import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type {
  JoseWindowOwnershipFrame,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { WindowOwnershipDeps } from './window-ownership-dependencies'
import { createOwnershipLink } from './navigation-intent'
import { setWindowOwnershipAuthorityView } from './ownership-guard'
import { ownershipKey, snapshotRefs, viewExecutionHostId } from './ownership-ref'
import { revealOwnedWorkspace } from './ownership-reveal'
import type { WindowWorkspaceRef } from './window-workspace-claims'

export type ClaimAuthorityStatus = 'ready' | 'unsupported' | 'unverifiable'
export type ClaimReplacement = {
  status: 'accepted' | 'refused' | 'unverifiable'
  blockedRefs: WindowWorkspaceRef[]
}
export const claimAuthorityKey = (target: RuntimeClientTarget): string =>
  target.kind === 'local' ? 'local' : `environment:${encodeURIComponent(target.environmentId)}`
export const sameClaimRefs = (
  a: readonly JoseWindowWorktreeRef[],
  b: readonly JoseWindowWorktreeRef[]
): boolean =>
  a.length === b.length && a.every((ref, index) => ownershipKey(ref) === ownershipKey(b[index]!))

/** A subscription and revision fence for one authenticated runtime authority. */
export function createWindowClaimAuthority(
  target: RuntimeClientTarget,
  deps: WindowOwnershipDeps,
  managedSubscription: boolean,
  changed: () => void
) {
  const key = claimAuthorityKey(target)
  const link = createOwnershipLink(target, deps)
  let status: ClaimAuthorityStatus = 'unverifiable'
  let supported = false
  let sessionId: string | null = null
  let revision = 0
  let generation = 0
  let stopped = false
  let owned: JoseWindowWorktreeRef[] = []
  let connectionGeneration = 0
  let subscription: { unsubscribe: () => void } | null = null
  let opening: Promise<void> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  const readyWaiters = new Set<() => void>()
  const notify = (): void => {
    readyWaiters.forEach((waiter) => waiter())
    changed()
  }
  const viewRefs = (refs: readonly JoseWindowWorktreeRef[]): WindowWorkspaceRef[] =>
    refs.flatMap((ref) => {
      const executionHostId = viewExecutionHostId(ref, target)
      return executionHostId ? [{ worktreeId: ref.worktreeId, executionHostId }] : []
    })
  const owns = (ref: JoseWindowWorktreeRef): boolean =>
    owned.some((current) => ownershipKey(current) === ownershipKey(ref))
  const snapshot = (frame: Extract<JoseWindowOwnershipFrame, { type: 'snapshot' }>): void => {
    const next = frame.claimSetSessionId ?? null
    supported = Boolean(next && frame.ownedHereRefs && deps.claimSet)
    status = supported ? 'ready' : 'unsupported'
    if (sessionId !== next) {
      generation += 1
      sessionId = next
      revision = frame.claimSetRevision ?? 0
    } else {
      revision = Math.max(revision, frame.claimSetRevision ?? 0)
    }
    owned = frame.ownedHereRefs ?? (frame.ownedHereRef ? [frame.ownedHereRef] : [])
    if (managedSubscription) {
      setWindowOwnershipAuthorityView(key, { link, ownedElsewhere: snapshotRefs(frame).elsewhere })
    }
    notify()
  }
  const disconnect = (): void => {
    generation += 1
    sessionId = null
    owned = []
    status = 'unverifiable'
    if (managedSubscription) {
      setWindowOwnershipAuthorityView(key, null)
    }
    notify()
  }
  const connectionClosed = (expected: number): void => {
    if (stopped || expected !== connectionGeneration) {
      return
    }
    connectionGeneration += 1
    subscription?.unsubscribe()
    subscription = null
    opening = null
    disconnect()
    if (retry === null) {
      retry = setTimeout(() => {
        retry = null
        void open()
      }, 1_000)
    }
  }
  const open = (): Promise<void> => {
    if (stopped || !managedSubscription || subscription || opening) {
      return opening ?? Promise.resolve()
    }
    const expected = ++connectionGeneration
    opening = deps
      .subscribe(target, {
        onFrame: (frame) => {
          if (stopped || expected !== connectionGeneration) {
            return
          }
          if (frame.type === 'end') {
            connectionClosed(expected)
          } else if (frame.type === 'snapshot') {
            snapshot(frame)
          } else {
            revealOwnedWorkspace(
              target,
              deps,
              owns,
              { worktreeId: frame.worktreeId, executionHostId: frame.executionHostId ?? 'local' },
              frame.intent
            )
          }
        },
        onError: (error) => {
          if (stopped || expected !== connectionGeneration) {
            return
          }
          if (deps.isMissingMethod(error)) {
            status = 'unsupported'
            supported = false
            notify()
          } else {
            connectionClosed(expected)
          }
        },
        onClose: () => connectionClosed(expected)
      })
      .then(
        (handle) => {
          if (stopped || expected !== connectionGeneration) {
            handle.unsubscribe()
          } else {
            subscription = handle
          }
        },
        (error: unknown) => {
          if (stopped || expected !== connectionGeneration) {
            return
          }
          if (deps.isMissingMethod(error)) {
            status = 'unsupported'
            supported = false
            notify()
          } else {
            connectionClosed(expected)
          }
        }
      )
      .finally(() => {
        if (expected === connectionGeneration) {
          opening = null
        }
      })
    return opening
  }
  return {
    key,
    target,
    snapshot,
    disconnect,
    owns,
    viewRefs,
    status: (): ClaimAuthorityStatus => status,
    supported: (): boolean => supported,
    generation: (): number => generation,
    owned: (): JoseWindowWorktreeRef[] => [...owned],
    ready: async (): Promise<ClaimAuthorityStatus> => {
      if (status !== 'unverifiable' || !managedSubscription) {
        return status
      }
      void open()
      if (status !== 'unverifiable') {
        return status
      }
      await new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer)
          readyWaiters.delete(finish)
          resolve()
        }
        const timer = setTimeout(finish, 10_000)
        readyWaiters.add(finish)
      })
      return status
    },
    replace: async (refs: JoseWindowWorktreeRef[]): Promise<ClaimReplacement> => {
      if (!sessionId || stopped || !deps.claimSet || status !== 'ready') {
        return { status: 'unverifiable', blockedRefs: [] }
      }
      const sentGeneration = generation
      try {
        const result = await deps.claimSet(target, {
          worktrees: refs,
          sessionId,
          revision: ++revision
        })
        if (stopped || sentGeneration !== generation) {
          return { status: 'unverifiable', blockedRefs: [] }
        }
        revision = Math.max(revision, result.revision)
        owned = result.ownedRefs
        if (!result.claimed && result.reason !== 'conflict') {
          return { status: 'unverifiable', blockedRefs: [] }
        }
        return {
          status: result.claimed ? 'accepted' : 'refused',
          blockedRefs: viewRefs(result.blockedRefs)
        }
      } catch {
        return { status: 'unverifiable', blockedRefs: [] }
      }
    },
    stop: (): void => {
      stopped = true
      connectionGeneration += 1
      if (retry !== null) {
        clearTimeout(retry)
      }
      subscription?.unsubscribe()
      subscription = null
      disconnect()
    }
  }
}
export type WindowClaimAuthority = ReturnType<typeof createWindowClaimAuthority>
