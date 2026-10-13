import { z } from 'zod'

// Fork-only: worktree ownership between Orca windows (src/main/jose-window).
export const JoseWindowClaimParams = z.object({
  worktreeId: z.string().min(1).nullable()
})

export const JoseWindowRevealParams = z.object({
  worktreeId: z.string().min(1)
})

export type JoseWindowClaimResult = { claimed: boolean }
export type JoseWindowRevealResult = { revealed: boolean }

/** Stream frames of `joseWindow.subscribe`, projected per window. `ownedHere` is the caller's own
 *  claim as the host holds it, so a window re-claims after the host dropped it on a reconnect. */
export type JoseWindowOwnershipFrame =
  | { type: 'snapshot'; ownedElsewhere: string[]; ownedHere: string | null }
  | { type: 'reveal'; worktreeId: string }
  | { type: 'end' }
