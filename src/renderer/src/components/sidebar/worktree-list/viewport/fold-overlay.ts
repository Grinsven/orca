import { FOLD_MOTION } from '@/fork/diri-motion/motion'
import {
  cancelMotion,
  playMotion,
  readMotionState,
  REST_STATE,
  type MotionState
} from '@/fork/diri-motion/motion-tracks'

/** A row's layout box relative to the overlay host, which covers the list viewport. */
export type FoldBox = {
  top: number
  left: number
  width: number
  height: number
}

export type FoldCopySource = {
  /** Every sidebar identity the copied element draws; it is copied only when all of them go. */
  identities: readonly string[]
  element: HTMLElement
  box: FoldBox
  state: MotionState
}

export type FoldHandoff = { box: FoldBox; state: MotionState }

// Why strip these: a copy must never answer a lookup meant for the live row (option ids for
// aria-activedescendant, reveal and drag queries, virtual-row bookkeeping, E2E test ids).
const COPY_IDENTITY_ATTRIBUTES = [
  'id',
  'data-testid',
  'data-index',
  'data-worktree-id',
  'data-worktree-row-key',
  'data-worktree-host-identity',
  'data-worktree-section-key',
  'data-worktree-drag-id',
  'data-worktree-drag-group-key',
  'data-worktree-drag-group-index',
  'data-worktree-virtual-row',
  'data-worktree-virtual-row-key',
  'data-worktree-virtual-row-start'
]
const COPY_IDENTITY_SELECTOR = COPY_IDENTITY_ATTRIBUTES.map((name) => `[${name}]`).join(',')

function stripCopyIdentity(element: Element): void {
  for (const name of COPY_IDENTITY_ATTRIBUTES) {
    element.removeAttribute(name)
  }
}

/** Live overlay copies and the identities each one draws. */
export type FoldCopies = Map<HTMLElement, readonly string[]>

/** Paints `source` in `host` at its old box and fades it out while it rises. */
export function addFoldCopy(host: HTMLElement, copies: FoldCopies, source: FoldCopySource): void {
  const clone = source.element.cloneNode(true)
  if (!(clone instanceof HTMLElement)) {
    return
  }
  stripCopyIdentity(clone)
  clone.querySelectorAll(COPY_IDENTITY_SELECTOR).forEach(stripCopyIdentity)
  const frame = host.ownerDocument.createElement('div')
  frame.style.position = 'absolute'
  frame.style.top = `${source.box.top}px`
  frame.style.left = `${source.box.left}px`
  frame.style.width = `${source.box.width}px`
  frame.style.height = `${source.box.height}px`
  frame.appendChild(clone)
  host.appendChild(frame)
  copies.set(frame, source.identities)
  playMotion(
    frame,
    {
      from: source.state,
      to: { y: -FOLD_MOTION.offsetPx, opacity: 0 },
      durationMs: FOLD_MOTION.closeMs
    },
    () => {
      copies.delete(frame)
      frame.remove()
    }
  )
}

/** Removes every copy; returns where each identity was drawn so a reopen starts there. */
export function clearFoldCopies(copies: FoldCopies): Map<string, FoldHandoff> {
  const handoff = new Map<string, FoldHandoff>()
  copies.forEach((identities, frame) => {
    const state = readMotionState(frame)
    if (state) {
      const box: FoldBox = {
        top: Number.parseFloat(frame.style.top),
        left: Number.parseFloat(frame.style.left),
        width: Number.parseFloat(frame.style.width),
        height: Number.parseFloat(frame.style.height)
      }
      for (const identity of identities) {
        handoff.set(identity, { box, state })
      }
    }
    cancelMotion(frame)
    frame.remove()
  })
  copies.clear()
  return handoff
}

export function mountedRows(scrollElement: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>()
  scrollElement.querySelectorAll<HTMLElement>('[data-worktree-virtual-row-key]').forEach((row) => {
    // Why: a pinned header is positioned by `sticky`, not by its slot, so it never moves.
    if (!row.hasAttribute('data-worktree-sticky-header-active')) {
      rows.set(row.dataset.worktreeVirtualRowKey ?? '', row)
    }
  })
  return rows
}

export function contentOf(row: HTMLElement): HTMLElement | null {
  const content = row.firstElementChild
  return content instanceof HTMLElement ? content : null
}

function identityOf(option: HTMLElement): string {
  return `wt:${option.dataset.worktreeRowKey ?? ''}`
}

export function memberElement(row: HTMLElement, identity: string): HTMLElement | null {
  const rowKey = identity.slice('wt:'.length)
  return row.querySelector<HTMLElement>(`[data-worktree-row-key="${CSS.escape(rowKey)}"]`)
}

/** Visible rows and lineage children with their layout boxes, captured before a close. */
export function captureCopySources(
  scrollElement: HTMLElement,
  host: HTMLElement
): FoldCopySource[] {
  const hostRect = host.getBoundingClientRect()
  const sources: FoldCopySource[] = []
  const capture = (element: HTMLElement, identities: string[]): void => {
    const rect = element.getBoundingClientRect()
    if (rect.bottom < hostRect.top || rect.top > hostRect.bottom || rect.height === 0) {
      return
    }
    const state = readMotionState(element) ?? REST_STATE
    const box = {
      top: rect.top - hostRect.top - state.y,
      left: rect.left - hostRect.left,
      width: rect.width,
      height: rect.height
    }
    sources.push({ identities, element, box, state })
  }
  mountedRows(scrollElement).forEach((row) => {
    const content = contentOf(row)
    if (!content) {
      return
    }
    const options = Array.from(row.querySelectorAll<HTMLElement>('[data-worktree-row-key]'))
    capture(
      content,
      options.length > 0 ? options.map(identityOf) : [row.dataset.worktreeVirtualRowKey ?? '']
    )
    // Lineage children draw inside their parent's card; each can close on its own.
    for (const option of options.slice(1)) {
      const nested = Array.from(option.querySelectorAll<HTMLElement>('[data-worktree-row-key]'))
      capture(option, [identityOf(option), ...nested.map(identityOf)])
    }
  })
  return sources
}
