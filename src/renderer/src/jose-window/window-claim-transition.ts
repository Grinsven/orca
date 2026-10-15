import {
  JOSE_WINDOW_MAX_CLAIMS,
  type JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import { ownershipKey } from './ownership-ref'
import {
  sameClaimRefs,
  type ClaimReplacement,
  type WindowClaimAuthority
} from './window-claim-authority'

export type WindowClaimAllocation = Map<WindowClaimAuthority, JoseWindowWorktreeRef[]>

export function windowClaimAllocationReady(desired: WindowClaimAllocation): boolean {
  return [...desired].every(
    ([authority, refs]) => authority.status() === 'ready' && sameClaimRefs(authority.owned(), refs)
  )
}

/** Restores the accepted allocation with newer revisions after a failed or abandoned transition. */
export async function restoreWindowClaimAllocation(
  previous: WindowClaimAllocation
): Promise<boolean> {
  let restored = true
  for (const [authority, refs] of previous) {
    // Even matching snapshots need a newer revision to fence a timed-out request.
    restored = (await authority.replace(refs)).status === 'accepted' && restored
  }
  return restored
}

/** Acquires additions before releasing claims held on another authority. */
export async function transitionWindowClaims(
  desired: WindowClaimAllocation,
  authorities: Iterable<WindowClaimAuthority>
): Promise<ClaimReplacement & { previous: WindowClaimAllocation }> {
  const previous = new Map([...authorities].map((authority) => [authority, authority.owned()]))
  const changed = new Map<WindowClaimAuthority, JoseWindowWorktreeRef[]>()
  const fail = async (result: ClaimReplacement) => {
    const restored = await restoreWindowClaimAllocation(changed)
    return { ...result, status: restored ? result.status : ('unverifiable' as const), previous }
  }
  for (const [authority, refs] of desired) {
    const before = authority.owned()
    const held = new Set(before.map(ownershipKey))
    if (refs.every((ref) => held.has(ownershipKey(ref)))) {
      continue
    }
    const union = [...new Map([...before, ...refs].map((ref) => [ownershipKey(ref), ref])).values()]
    changed.set(authority, before)
    const result = await authority.replace(union.length <= JOSE_WINDOW_MAX_CLAIMS ? union : refs)
    if (result.status !== 'accepted') {
      return fail(result)
    }
  }
  for (const authority of previous.keys()) {
    const refs = desired.get(authority) ?? []
    if (sameClaimRefs(authority.owned(), refs)) {
      continue
    }
    if (!changed.has(authority)) {
      changed.set(authority, previous.get(authority) ?? [])
    }
    const result = await authority.replace(refs)
    if (result.status !== 'accepted') {
      return fail(result)
    }
  }
  if (!windowClaimAllocationReady(desired)) {
    return fail({ status: 'unverifiable', blockedRefs: [] })
  }
  return { status: 'accepted', blockedRefs: [], previous: changed }
}
