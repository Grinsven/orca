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
let redirectEpoch = 0

function selectionStamp(): string {
  const state = useAppStore.getState()
  return [
    state.activeView,
    state.activeWorkspaceExecutionHostId ?? '',
    state.activeWorktreeId ?? ''
  ].join('|')
}

/** Written by the ownership session from the host's snapshot; null when not connected. */
export function setWindowOwnershipView(
  next: { link: WindowOwnershipLink; ownedElsewhere: Iterable<JoseWindowWorktreeRef> } | null
): void {
  link = next?.link ?? null
  ownedElsewhere = new Set([...(next?.ownedElsewhere ?? [])].map(ownershipKey))
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
  return refOwnedElsewhere(link, worktreeId, opts) !== null
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
  const epoch = ++redirectEpoch
  const expectedSelection = selectionStamp()
  const isStillCurrent = (): boolean =>
    link === current && epoch === redirectEpoch && selectionStamp() === expectedSelection
  const fallBack = (): void => {
    const key = ownershipKey(ref)
    ownedElsewhere = new Set([...ownedElsewhere].filter((owned) => owned !== key))
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
  const current = link
  const ref = refOwnedElsewhere(current, worktreeId, opts)
  if (!current || !ref) {
    return false
  }
  restoreSidebarActiveRow()
  revealThroughLink(current, ref, opts?.intent)
  return true
}

/** Raises the window the host gave `ref` to, on the same path (and fallback rules) as a redirect. */
export function revealOwningWindow(ref: JoseWindowWorktreeRef): void {
  if (link) {
    revealThroughLink(link, ref, undefined)
  }
}
