import type { JoseWindowWorktreeRef } from '../../../shared/rpc-contract/jose-window-params'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { ownershipKey } from './ownership-ref'
import {
  CLAIM_WAIT_DEADLINE_MS,
  pendingWindowWorkspaceAdmission
} from './window-workspace-admission'
export { CLAIM_WAIT_DEADLINE_MS } from './window-workspace-admission'

export type OwnershipClaimGate = {
  resolve: (
    worktreeId: string,
    executionHostId?: ExecutionHostId | null
  ) => JoseWindowWorktreeRef | null
  /** Settles true once the host accepts this window's claim on `key`, false when it refuses. */
  waitForClaim: (key: string) => Promise<boolean>
}

// Set by the ownership session while its stream has no snapshot yet, i.e. the click guard has no
// fresh evidence about who owns what.
let gate: OwnershipClaimGate | null = null

export function setOwnershipClaimGate(next: OwnershipClaimGate | null): void {
  gate = next
}

/** This window's pending claim on a workspace it may not own, or null when nothing is in doubt. */
function pendingClaim(
  workspaceKey: string,
  executionHostId: ExecutionHostId | null | undefined
): Promise<boolean> | null {
  const admission = pendingWindowWorkspaceAdmission(workspaceKey, executionHostId)
  if (admission !== undefined) {
    return admission
  }
  const ref = gate?.resolve(workspaceKey, executionHostId)
  return gate && ref ? gate.waitForClaim(ownershipKey(ref)) : null
}

/**
 * Terminal seeding for an empty workspace starts here. With no ownership evidence yet, it waits
 * for this window's claim; a refused claim yields `refused` and nothing is seeded.
 */
export function afterOwnershipClaim<T>(
  workspaceKey: string,
  executionHostId: ExecutionHostId | null | undefined,
  start: () => Promise<T>,
  refused: T
): Promise<T> {
  const wait = pendingClaim(workspaceKey, executionHostId)
  return wait ? wait.then((claimed) => (claimed ? start() : refused)) : start()
}

/** True when `run` (a terminal-creating step) was deferred until the claim succeeds. */
export function deferredUntilOwnershipClaim(workspaceKey: string, run: () => void): boolean {
  const wait = pendingClaim(workspaceKey, undefined)
  if (!wait) {
    return false
  }
  void wait.then((claimed) => {
    if (claimed) {
      run()
    }
  })
  return true
}

type CancelTimer = () => void
type Waiter = { resolve: (claimed: boolean) => void; cancelDeadline: CancelTimer }

/** Pending waits on this window's own claims, settled by the ownership session. A wait that
 *  outlives the deadline settles false: an uncertain claim never authorises seeding. */
export class ClaimWaiters {
  private readonly byKey = new Map<string, Waiter[]>()

  constructor(private readonly setTimer: (callback: () => void, ms: number) => CancelTimer) {}

  wait(key: string): Promise<boolean> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        resolve,
        cancelDeadline: this.setTimer(() => this.expire(key, waiter), CLAIM_WAIT_DEADLINE_MS)
      }
      this.byKey.set(key, [...(this.byKey.get(key) ?? []), waiter])
    })
  }

  settle(key: string, claimed: boolean): void {
    const waiters = this.byKey.get(key) ?? []
    this.byKey.delete(key)
    waiters.forEach((waiter) => {
      waiter.cancelDeadline()
      waiter.resolve(claimed)
    })
  }

  /** A claim for any other key means these will never be claimed by this activation. */
  refuseAllBut(key: string | null): void {
    this.refuseOutside(key === null ? new Set() : new Set([key]))
  }

  refuseOutside(keys: ReadonlySet<string>): void {
    for (const pendingKey of this.byKey.keys()) {
      if (!keys.has(pendingKey)) {
        this.settle(pendingKey, false)
      }
    }
  }

  settleAll(claimed: boolean, which: (key: string) => boolean = () => true): void {
    for (const pendingKey of this.byKey.keys()) {
      if (which(pendingKey)) {
        this.settle(pendingKey, claimed)
      }
    }
  }

  private expire(key: string, waiter: Waiter): void {
    const remaining = (this.byKey.get(key) ?? []).filter((pending) => pending !== waiter)
    if (remaining.length > 0) {
      this.byKey.set(key, remaining)
    } else {
      this.byKey.delete(key)
    }
    waiter.resolve(false)
  }
}
