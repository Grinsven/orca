import {
  JOSE_WINDOW_MAX_CLAIMS,
  type JoseWindowOwnershipFrame,
  type JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { WindowClaimSetDependencies } from './window-ownership-dependencies'
import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { ownershipKey } from './ownership-ref'
import { createWindowClaimAuthority, type WindowClaimAuthority } from './window-claim-authority'
import { resolveWindowClaimPlan } from './window-claim-plan'
import {
  restoreWindowClaimAllocation,
  transitionWindowClaims,
  windowClaimAllocationReady,
  type WindowClaimAllocation
} from './window-claim-transition'
import {
  bindWindowWorkspaceClaimSession,
  publishWindowWorkspaceClaims,
  type WindowWorkspaceClaimPreparation,
  type WindowWorkspaceRef
} from './window-workspace-claims'
import { restoreRefusedWindowClaims } from './window-claim-refusal'
import { createWindowClaimAdmission } from './window-claim-admission'

type Snapshot = Extract<JoseWindowOwnershipFrame, { type: 'snapshot' }>

/** One writer coordinates visible claims across their authenticated runtime authorities. */
export function createWindowClaimSetSession(options: WindowClaimSetDependencies) {
  const { deps, target } = options
  const authorities = new Map<string, WindowClaimAuthority>()
  let stopped = false
  let preparing = false
  let synchronizing = false
  let syncAgain = false
  let pinned: readonly WindowWorkspaceRef[] | null = null
  let prospective: readonly WindowWorkspaceRef[] | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let syncSelection = (): void => {}
  let retry: ReturnType<typeof setTimeout> | null = null
  let retries = 0
  const publish = (
    status?: 'ready' | 'unsupported' | 'unverifiable' | 'refused',
    blockedRefs: readonly WindowWorkspaceRef[] = []
  ): void => {
    if (stopped) {
      return
    }
    admission.refresh()
    const required = resolveWindowClaimPlan(
      deps.store.getState(),
      target,
      prospective ?? pinned ?? []
    )
    const ports = [...authorities.values()].filter(
      (port) => port === primary || required?.has(port.key)
    )
    const ownsRequired =
      required !== null &&
      [...required].every(([key, entry]) => {
        const port = authorities.get(key)
        return (
          port &&
          entry.refs.every((ref) =>
            port.owned().some((owned) => ownershipKey(owned) === ownershipKey(ref))
          )
        )
      })
    const connection = ports.some((port) => port.status() === 'unverifiable')
      ? 'unverifiable'
      : ports.some((port) => port.status() === 'unsupported')
        ? 'unsupported'
        : ownsRequired
          ? 'ready'
          : 'unverifiable'
    publishWindowWorkspaceClaims({
      status: status ?? connection,
      ownedRefs: [...authorities.values()].flatMap((port) => port.viewRefs(port.owned())),
      blockedRefs
    })
  }
  const changed = (): void => {
    publish()
    if (!preparing && !synchronizing && !stopped) {
      queueMicrotask(() => syncSelection())
    }
  }
  const primary = createWindowClaimAuthority(target, deps, false, changed)
  authorities.set(primary.key, primary)
  const admission = createWindowClaimAdmission({
    target,
    deps,
    authorities,
    scope: () => [...(pinned ?? []), ...(prospective ?? [])]
  })
  const serialize = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run, run)
    queue = result.catch(() => {})
    return result
  }
  const settlePrimary = (): void => {
    options.refuseOutside(new Set(primary.owned().map(ownershipKey)))
    primary.owned().forEach((ref) => options.settle(ref, true))
  }
  const allocate = async (
    requested: readonly WindowWorkspaceRef[]
  ): Promise<WindowClaimAllocation | 'unsupported' | 'unverifiable'> => {
    const plan = resolveWindowClaimPlan(deps.store.getState(), target, requested)
    if (!plan) {
      return 'unverifiable'
    }
    const allocation: WindowClaimAllocation = new Map()
    for (const [key, entry] of plan) {
      let port = authorities.get(key)
      if (!port) {
        port = createWindowClaimAuthority(entry.target, deps, true, changed)
        authorities.set(key, port)
      }
      const status = await port.ready()
      if (status !== 'ready') {
        return status
      }
      allocation.set(port, entry.refs)
    }
    return allocation
  }
  const activeViewRef = (): WindowWorkspaceRef | null => {
    const state = deps.store.getState()
    const worktreeId = state.activeWorktreeId
    if (!worktreeId) {
      return null
    }
    const executionHostId =
      state.activeWorkspaceExecutionHostId ?? getKnownExecutionHostIdForWorktree(state, worktreeId)
    return executionHostId ? { worktreeId, executionHostId } : null
  }
  const retrySync = (): void => {
    if (retry || stopped || retries >= 3) {
      return
    }
    retries += 1
    retry = setTimeout(
      () => {
        retry = null
        syncSelection()
      },
      1_000 * 2 ** (retries - 1)
    )
  }
  syncSelection = (): void => {
    if (!primary.supported() || preparing || stopped || primary.status() !== 'ready') {
      return
    }
    if (synchronizing) {
      syncAgain = true
      return
    }
    synchronizing = true
    void serialize(async () => {
      if (preparing || stopped || primary.status() !== 'ready') {
        return
      }
      const active = activeViewRef()
      let requested = pinned ?? (active ? [active] : [])
      const plan = resolveWindowClaimPlan(deps.store.getState(), target, requested)
      // Ordinary navigation to an unrelated runtime keeps its legacy independence until a split uses it.
      if (!pinned && plan && [...plan.keys()].some((key) => !authorities.has(key))) {
        requested = []
      }
      const allocation = await allocate(requested)
      if (typeof allocation === 'string') {
        publish(allocation)
        retrySync()
        return
      }
      const result = await transitionWindowClaims(allocation, authorities.values())
      settlePrimary()
      if (result.status === 'refused') {
        const wasPinned = pinned !== null
        pinned = null
        restoreRefusedWindowClaims({
          deps,
          target,
          authorities,
          active,
          wasPinned,
          primaryRefused: options.refused
        })
      }
      publish(result.status === 'accepted' ? undefined : result.status, result.blockedRefs)
      if (result.status === 'accepted') {
        retries = 0
        options.accepted()
      } else if (result.status === 'unverifiable') {
        retrySync()
      }
    }).finally(() => {
      synchronizing = false
      if (syncAgain) {
        syncAgain = false
        syncSelection()
      }
    })
  }
  const prepare = async (
    requested: readonly WindowWorkspaceRef[]
  ): Promise<WindowWorkspaceClaimPreparation> => {
    if (!primary.supported()) {
      return {
        status: primary.status() === 'unsupported' ? 'unsupported' : 'unverifiable',
        blockedRefs: []
      }
    }
    if (preparing || stopped || primary.status() !== 'ready') {
      return { status: 'unverifiable', blockedRefs: [] }
    }
    const ids = requested.map((ref) => ref.worktreeId)
    if (requested.length > JOSE_WINDOW_MAX_CLAIMS || new Set(ids).size !== ids.length) {
      return { status: 'refused', blockedRefs: requested }
    }
    preparing = true
    prospective = requested
    admission.refresh()
    const previousPinned = pinned
    const result = await serialize(async () => {
      const allocation = await allocate(requested)
      if (typeof allocation === 'string') {
        return {
          status: allocation,
          blockedRefs: requested,
          previous: new Map<WindowClaimAuthority, JoseWindowWorktreeRef[]>(),
          allocation: null
        }
      }
      return { ...(await transitionWindowClaims(allocation, authorities.values())), allocation }
    })
    settlePrimary()
    if (result.status !== 'accepted') {
      preparing = false
      prospective = null
      publish(result.status, result.blockedRefs)
      if (result.status === 'unverifiable') {
        retrySync()
      }
      return { status: result.status, blockedRefs: result.blockedRefs }
    }
    const generations = new Map([...authorities.values()].map((port) => [port, port.generation()]))
    publish()
    let settled = false
    return {
      status: 'accepted',
      commit: () => {
        if (settled) {
          return
        }
        if (
          stopped ||
          [...generations].some(([port, generation]) => port.generation() !== generation) ||
          !result.allocation ||
          !windowClaimAllocationReady(result.allocation)
        ) {
          throw new Error('Workspace ownership changed before the layout was committed.')
        }
        settled = true
        pinned = requested.length > 1 ? [...requested] : null
        preparing = false
        prospective = null
        retries = 0
        admission.refresh()
        queueMicrotask(syncSelection)
      },
      rollback: async () => {
        if (settled) {
          return
        }
        settled = true
        pinned = previousPinned
        const restored = await serialize(() => restoreWindowClaimAllocation(result.previous))
        preparing = false
        prospective = null
        publish(restored ? undefined : 'unverifiable')
        syncSelection()
      }
    }
  }
  const unbind = bindWindowWorkspaceClaimSession({ prepare })
  return {
    isSupported: primary.supported,
    syncSelection,
    owns: primary.owns,
    snapshot: (frame: Snapshot): void => primary.snapshot(frame),
    disconnect: (): void => primary.disconnect(),
    stop: (): void => {
      stopped = true
      pinned = null
      admission.stop()
      if (retry) {
        clearTimeout(retry)
      }
      authorities.forEach((port) => port.stop())
      unbind()
    }
  }
}
