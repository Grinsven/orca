export type WindowOwnershipLink = {
  /** Resolves false when the host found no other window to raise. */
  reveal: (worktreeId: string) => Promise<boolean>
  /** Opens the worktree here after all, when its owner turned out to be gone. */
  activateHere?: (worktreeId: string) => void
}

let link: WindowOwnershipLink | null = null
let ownedElsewhere: ReadonlySet<string> = new Set()

/** Written by use-window-ownership from the host's snapshot; null when not connected. */
export function setWindowOwnershipView(
  next: { link: WindowOwnershipLink; ownedElsewhere: Iterable<string> } | null
): void {
  link = next?.link ?? null
  ownedElsewhere = new Set(next?.ownedElsewhere ?? [])
}

export function isOwnedByAnotherWindow(worktreeId: string): boolean {
  return link !== null && ownedElsewhere.has(worktreeId)
}

/**
 * Synchronous click guard: when another Orca window has `worktreeId` active, ask the host to raise
 * that window instead of opening it here. Back/forward history is guarded too, so it never flashes
 * the worktree here or seeds a terminal before the host refuses the claim.
 */
export function redirectIfOwnedElsewhere(worktreeId: string): boolean {
  const current = link
  if (!current || !ownedElsewhere.has(worktreeId)) {
    return false
  }
  const fallBack = (): void => {
    if (link !== current) {
      return
    }
    const rest = new Set(ownedElsewhere)
    rest.delete(worktreeId)
    ownedElsewhere = rest
    current.activateHere?.(worktreeId)
  }
  void current.reveal(worktreeId).then(
    (revealed) => {
      if (!revealed) {
        fallBack()
      }
    },
    (error: unknown) => {
      console.warn('[jose-window] reveal failed', error)
      fallBack()
    }
  )
  return true
}
