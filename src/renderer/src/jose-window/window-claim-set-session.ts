import type {
  JoseWindowOwnershipFrame,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { WindowOwnershipDeps } from './window-ownership-session'
import {
  activeOwnershipRef,
  ownershipKey,
  resolveOwnershipRef,
  viewExecutionHostId
} from './ownership-ref'
import {
  bindWindowWorkspaceClaimSession,
  publishWindowWorkspaceClaims,
  type WindowWorkspaceClaimPreparation,
  type WindowWorkspaceRef
} from './window-workspace-claims'

type Snapshot = Extract<JoseWindowOwnershipFrame, { type: 'snapshot' }>
type Dependencies = {
  target: RuntimeClientTarget
  deps: WindowOwnershipDeps
  settle: (ref: JoseWindowWorktreeRef, accepted: boolean) => void
  refuseOutside: (keys: ReadonlySet<string>) => void
  accepted: () => void
  refused: (ref: JoseWindowWorktreeRef) => void
}

const sameRefs = (
  a: readonly JoseWindowWorktreeRef[],
  b: readonly JoseWindowWorktreeRef[]
): boolean =>
  a.length === b.length && a.every((ref, index) => ownershipKey(ref) === ownershipKey(b[index]!))

/** One serialized writer owns both automatic selection claims and prepared split claims. */
export function createWindowClaimSetSession(options: Dependencies) {
  const { deps, target } = options
  let sessionId: string | null = null
  let revision = 0
  let generation = 0
  let supported = false
  let observedSnapshot = false
  let stopped = false
  let preparing = false
  let pinned: JoseWindowWorktreeRef[] | null = null
  let owned: JoseWindowWorktreeRef[] = []
  let queue: Promise<unknown> = Promise.resolve()

  const viewRefs = (refs: readonly JoseWindowWorktreeRef[]): WindowWorkspaceRef[] =>
    refs.flatMap((ref) => {
      const executionHostId = viewExecutionHostId(ref, target)
      return executionHostId ? [{ worktreeId: ref.worktreeId, executionHostId }] : []
    })
  const publish = (
    status: 'ready' | 'unsupported' | 'unverifiable' | 'refused',
    blocked: JoseWindowWorktreeRef[] = []
  ): void =>
    publishWindowWorkspaceClaims({
      status,
      ownedRefs: viewRefs(owned),
      blockedRefs: viewRefs(blocked)
    })
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run, run)
    queue = result.catch(() => {})
    return result
  }

  const replace = async (
    refs: JoseWindowWorktreeRef[]
  ): Promise<'accepted' | 'refused' | 'unverifiable'> => {
    if (!sessionId || stopped || !deps.claimSet) {
      return 'unverifiable'
    }
    const sentGeneration = generation
    const sentSessionId = sessionId
    const sentRevision = ++revision
    try {
      const result = await deps.claimSet(target, {
        worktrees: refs,
        sessionId: sentSessionId,
        revision: sentRevision
      })
      if (stopped || generation !== sentGeneration || sessionId !== sentSessionId) {
        return 'unverifiable'
      }
      revision = Math.max(revision, result.revision)
      owned = result.ownedRefs
      if (!result.claimed && result.reason !== 'conflict') {
        publish('unverifiable')
        return 'unverifiable'
      }
      options.refuseOutside(new Set(owned.map(ownershipKey)))
      refs.forEach((ref) => options.settle(ref, result.claimed))
      publish(result.claimed ? 'ready' : 'refused', result.blockedRefs)
      return result.claimed ? 'accepted' : 'refused'
    } catch {
      if (!stopped && generation === sentGeneration) {
        publish('unverifiable')
      }
      return 'unverifiable'
    }
  }

  const syncSelection = (): void => {
    if (!supported || preparing || stopped || !sessionId) {
      return
    }
    void serialize(async () => {
      if (preparing || stopped || !sessionId) {
        return
      }
      const active = activeOwnershipRef(deps.store.getState(), target)
      const refs = pinned ?? (active ? [active] : [])
      if (sameRefs(refs, owned)) {
        refs.forEach((ref) => options.settle(ref, true))
        options.accepted()
        return
      }
      const result = await replace(refs)
      if (result === 'accepted') {
        options.accepted()
      } else if (result === 'refused' && !pinned && active) {
        const latest = activeOwnershipRef(deps.store.getState(), target)
        if (latest && ownershipKey(active) === ownershipKey(latest)) {
          options.refused(active)
        }
      }
    })
  }

  const prepare = async (
    requested: readonly WindowWorkspaceRef[]
  ): Promise<WindowWorkspaceClaimPreparation> => {
    if (!supported) {
      return { status: observedSnapshot ? 'unsupported' : 'unverifiable', blockedRefs: [] }
    }
    if (preparing || stopped || !sessionId) {
      return { status: 'unverifiable', blockedRefs: [] }
    }
    const rawIds = requested.map((ref) => ref.worktreeId)
    if (requested.length > 2 || new Set(rawIds).size !== rawIds.length) {
      return { status: 'refused', blockedRefs: requested }
    }
    const refs = requested.map((ref) =>
      resolveOwnershipRef(deps.store.getState(), target, ref.worktreeId, ref.executionHostId)
    )
    if (refs.some((ref) => ref === null)) {
      return { status: 'unsupported', blockedRefs: requested }
    }
    const resolved = refs.filter((ref) => ref !== null)
    preparing = true
    const previousPinned = pinned
    let previousOwned = [...owned]
    const preparedGeneration = generation
    const result = await serialize(() => {
      previousOwned = [...owned]
      return replace(resolved)
    })
    if (result !== 'accepted') {
      preparing = false
      if (result === 'unverifiable') {
        syncSelection()
      }
      return {
        status: result,
        blockedRefs: requested.filter(
          (ref) =>
            !viewRefs(owned).some(
              (current) =>
                current.worktreeId === ref.worktreeId &&
                current.executionHostId === ref.executionHostId
            )
        )
      }
    }
    let settled = false
    return {
      status: 'accepted',
      commit: () => {
        if (settled) {
          return
        }
        settled = true
        if (stopped || preparedGeneration !== generation) {
          preparing = false
          throw new Error('Workspace ownership changed before the layout was committed.')
        }
        pinned = resolved.length > 1 ? resolved : null
        preparing = false
        // The caller synchronously activates a singleton survivor before automatic navigation resumes.
        queueMicrotask(syncSelection)
      },
      rollback: async () => {
        if (settled) {
          return
        }
        settled = true
        pinned = previousPinned
        await serialize(() => replace(previousOwned))
        preparing = false
        syncSelection()
      }
    }
  }
  const unbind = bindWindowWorkspaceClaimSession({ prepare })
  return {
    isSupported: (): boolean => supported,
    syncSelection,
    owns: (ref: JoseWindowWorktreeRef): boolean =>
      owned.some((current) => ownershipKey(current) === ownershipKey(ref)),
    snapshot: (frame: Snapshot): void => {
      observedSnapshot = true
      const nextSessionId = frame.claimSetSessionId ?? null
      supported = Boolean(nextSessionId && frame.ownedHereRefs && deps.claimSet)
      if (sessionId !== nextSessionId) {
        generation += 1
        sessionId = nextSessionId
        revision = frame.claimSetRevision ?? 0
      } else {
        revision = Math.max(revision, frame.claimSetRevision ?? 0)
      }
      owned = frame.ownedHereRefs ?? (frame.ownedHereRef ? [frame.ownedHereRef] : [])
      publish(supported ? 'ready' : 'unsupported')
    },
    disconnect: (): void => {
      generation += 1
      sessionId = null
      owned = []
      publish('unverifiable')
    },
    stop: (): void => {
      stopped = true
      pinned = null
      unbind()
    }
  }
}
