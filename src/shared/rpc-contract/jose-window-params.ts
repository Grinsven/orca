import { z } from 'zod'

// Fork-only: worktree ownership between Orca windows (src/main/jose-window).

/** One workspace on the ownership host, named as that host sees it: its own checkouts are
 *  `local`, an SSH target it serves is `ssh:<id>`. `repoId::path` ids repeat across hosts. */
export const JoseWindowWorktreeRef = z.object({
  worktreeId: z.string().min(1),
  executionHostId: z.string().min(1)
})
export type JoseWindowWorktreeRef = z.infer<typeof JoseWindowWorktreeRef>

/** What the redirected request asked for, so the owner can do it after raising. Tab ids are the
 *  ownership host's; each window maps them to its own. */
export const JoseWindowNavigationIntent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('workspace') }),
  z.object({
    kind: z.literal('file'),
    filePath: z.string().min(1),
    relativePath: z.string(),
    preview: z.boolean().optional()
  }),
  z.object({
    kind: z.literal('diff'),
    filePath: z.string().min(1),
    relativePath: z.string(),
    staged: z.boolean()
  }),
  z.object({
    kind: z.literal('terminal'),
    tabId: z.string().min(1),
    leafId: z.string().nullable().optional(),
    flashFocusedPane: z.boolean().optional(),
    scrollToBottomIfOutputSinceLastView: z.boolean().optional()
  }),
  z.object({
    kind: z.literal('tab'),
    tabId: z.string().min(1),
    userInitiated: z.boolean().optional()
  })
])
export type JoseWindowNavigationIntent = z.infer<typeof JoseWindowNavigationIntent>

// Why optional fields: an older window sends bare ids (read as `local`) and no intent; an older
// host drops the intent, so its owner only raises.
export const JoseWindowClaimParams = z.object({
  worktreeId: z.string().min(1).nullable(),
  executionHostId: z.string().min(1).optional()
})

export const JoseWindowRevealParams = z.object({
  worktreeId: z.string().min(1),
  executionHostId: z.string().min(1).optional(),
  intent: JoseWindowNavigationIntent.optional()
})

export type JoseWindowClaimResult = { claimed: boolean }
export type JoseWindowRevealResult = { revealed: boolean }

/** Stream frames of `joseWindow.subscribe`, projected per window. `ownedHere` is the caller's own
 *  claim as the host holds it, so a window re-claims after the host dropped it on a reconnect.
 *  The bare-id fields stay for older windows; `*Ref` fields carry the host as well. */
export type JoseWindowOwnershipFrame =
  | {
      type: 'snapshot'
      ownedElsewhere: string[]
      ownedHere: string | null
      ownedElsewhereRefs?: JoseWindowWorktreeRef[]
      ownedHereRef?: JoseWindowWorktreeRef | null
    }
  | {
      type: 'reveal'
      worktreeId: string
      executionHostId?: string
      intent?: JoseWindowNavigationIntent
    }
  | { type: 'end' }
