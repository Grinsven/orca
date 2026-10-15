import type {
  JoseWindowNavigationIntent,
  JoseWindowWorktreeRef
} from '../../../shared/rpc-contract/jose-window-params'
import type { ExecutionHostId } from '../../../shared/execution-host'
import { useAppStore } from '@/store'
import { markSidebarWorktreeActiveImmediately } from '@/components/sidebar/worktree-list/rows/option-dom'
import { ownershipKey } from './ownership-ref'

export type WindowOwnershipLink = {
  /** The host-side ref for a workspace as this window names it; null when the host does not serve it. */
  resolve: (
    worktreeId: string,
    executionHostId?: ExecutionHostId | null
  ) => JoseWindowWorktreeRef | null
  /** Resolves false when the host found no other window to raise. */
  reveal: (ref: JoseWindowWorktreeRef, intent?: JoseWindowNavigationIntent) => Promise<boolean>
  /** Carries the request out here after all, when its owner turned out to be gone. */
  activateHere?: (ref: JoseWindowWorktreeRef, intent?: JoseWindowNavigationIntent) => void
}

export type OwnershipTargetOptions = {
  executionHostId?: ExecutionHostId | null
  /** The redirected request in this window's terms; a plain workspace reveal when absent. */
  intent?: JoseWindowNavigationIntent
}

let link: WindowOwnershipLink | null = null
let ownedElsewhere: ReadonlySet<string> = new Set()
const authorityViews = new Map<
  string,
  { link: WindowOwnershipLink; ownedElsewhere: ReadonlySet<string> }
>()
let redirectEpoch = 0
let navigationRevision = 0
let navigationTracked = false

let navigationInterceptor:
  | ((worktreeId: string, options?: OwnershipTargetOptions) => boolean)
  | null = null

export function setWorkspaceNavigationInterceptor(
  next: (worktreeId: string, options?: OwnershipTargetOptions) => boolean
): () => void {
  navigationInterceptor = next
  return () => {
    if (navigationInterceptor === next) {
      navigationInterceptor = null
    }
  }
}

// Why a counter, not the selection value: B to C and back to B ends on the same selection, yet the
// user has navigated since the redirect started.
function trackNavigation(): void {
  if (navigationTracked) {
    return
  }
  navigationTracked = true
  useAppStore.subscribe((state, previous) => {
    if (
      state.activeWorktreeId !== previous.activeWorktreeId ||
      state.activeWorkspaceExecutionHostId !== previous.activeWorkspaceExecutionHostId ||
      state.activeView !== previous.activeView
    ) {
      navigationRevision += 1
    }
  })
}

/** Written by the ownership session from the host's snapshot; null when not connected. */
export function setWindowOwnershipView(
  next: { link: WindowOwnershipLink; ownedElsewhere: Iterable<JoseWindowWorktreeRef> } | null
): void {
  link = next?.link ?? null
  ownedElsewhere = new Set([...(next?.ownedElsewhere ?? [])].map(ownershipKey))
}

/** Independent runtime authorities retain their own host-side identity namespace. */
export function setWindowOwnershipAuthorityView(
  authority: string,
  next: { link: WindowOwnershipLink; ownedElsewhere: Iterable<JoseWindowWorktreeRef> } | null
): void {
  if (next) {
    authorityViews.set(authority, {
      link: next.link,
      ownedElsewhere: new Set([...next.ownedElsewhere].map(ownershipKey))
    })
  } else {
    authorityViews.delete(authority)
  }
}

function matchingOwnershipView(
  worktreeId: string,
  opts?: OwnershipTargetOptions
): { link: WindowOwnershipLink; ref: JoseWindowWorktreeRef } | null {
  const primaryRef = refOwnedElsewhere(link, worktreeId, opts)
  if (link && primaryRef) {
    return { link, ref: primaryRef }
  }
  for (const view of authorityViews.values()) {
    const ref = view.link.resolve(worktreeId, opts?.executionHostId)
    if (ref && view.ownedElsewhere.has(ownershipKey(ref))) {
      return { link: view.link, ref }
    }
  }
  return null
}

function refOwnedElsewhere(
  current: WindowOwnershipLink | null,
  worktreeId: string,
  opts: OwnershipTargetOptions | undefined
): JoseWindowWorktreeRef | null {
  if (!current || ownedElsewhere.size === 0) {
    return null
  }
  const ref = current.resolve(worktreeId, opts?.executionHostId)
  return ref && ownedElsewhere.has(ownershipKey(ref)) ? ref : null
}

export function isOwnedByAnotherWindow(worktreeId: string, opts?: OwnershipTargetOptions): boolean {
  return matchingOwnershipView(worktreeId, opts) !== null
}

// Why: a sidebar click marks its row active in the DOM before activation runs, and the store never
// changes on a redirect, so React would leave the clicked row looking active.
function restoreSidebarActiveRow(): void {
  if (typeof document === 'undefined') {
    return
  }
  const activeWorktreeId = useAppStore.getState().activeWorktreeId
  if (activeWorktreeId) {
    markSidebarWorktreeActiveImmediately(activeWorktreeId)
    return
  }
  const sidebar = document.querySelector('[data-worktree-sidebar]')
  sidebar
    ?.querySelectorAll('[role="option"][aria-current="page"]')
    .forEach((option) => option.removeAttribute('aria-current'))
  sidebar
    ?.querySelectorAll('[data-worktree-card-surface][data-worktree-card-active]')
    .forEach((surface) => surface.removeAttribute('data-worktree-card-active'))
}

// Why: the fallback acts for this navigation only. A later click or selection, or a newer link,
// makes it obsolete, and only a confirmed "no owner" (not a timeout) justifies acting here.
function revealThroughLink(
  current: WindowOwnershipLink,
  ref: JoseWindowWorktreeRef,
  intent: JoseWindowNavigationIntent | undefined
): void {
  trackNavigation()
  const epoch = ++redirectEpoch
  const revision = navigationRevision
  const isStillCurrent = (): boolean =>
    (link === current || [...authorityViews.values()].some((view) => view.link === current)) &&
    epoch === redirectEpoch &&
    navigationRevision === revision
  const fallBack = (): void => {
    const key = ownershipKey(ref)
    if (link === current) {
      ownedElsewhere = new Set([...ownedElsewhere].filter((owned) => owned !== key))
    }
    for (const view of authorityViews.values()) {
      if (view.link === current) {
        view.ownedElsewhere = new Set([...view.ownedElsewhere].filter((owned) => owned !== key))
      }
    }
    if (intent) {
      current.activateHere?.(ref, intent)
    } else {
      current.activateHere?.(ref)
    }
  }
  const revealed = intent ? current.reveal(ref, intent) : current.reveal(ref)
  void revealed.then(
    (wasRevealed) => {
      if (!wasRevealed && isStillCurrent()) {
        fallBack()
      }
    },
    (error: unknown) => {
      console.warn('[jose-window] reveal unverifiable; not opening the worktree here', error)
    }
  )
}

/**
 * Synchronous click guard: when another Orca window has this workspace (on this host) active, ask
 * the host to raise that window instead of opening it here. Back/forward history is guarded too,
 * so it never flashes the worktree here or seeds a terminal before the host refuses the claim.
 */
export function redirectIfOwnedElsewhere(
  worktreeId: string,
  opts?: OwnershipTargetOptions
): boolean {
  const match = matchingOwnershipView(worktreeId, opts)
  if (!match) {
    if (navigationInterceptor?.(worktreeId, opts)) {
      return true
    }
    return false
  }
  restoreSidebarActiveRow()
  revealThroughLink(match.link, match.ref, opts?.intent)
  return true
}

/** Raises the window the host gave `ref` to, on the same path (and fallback rules) as a redirect. */
export function revealOwningWindow(ref: JoseWindowWorktreeRef): void {
  if (link) {
    revealThroughLink(link, ref, undefined)
  }
}
