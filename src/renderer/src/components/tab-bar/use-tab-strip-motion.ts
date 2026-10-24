import { useLayoutEffect, useRef, type RefObject } from 'react'
import { EASE3_CSS, prefersReducedMotion, TAB_MOTION } from '@/fork/diri-motion/motion'
import { getTabStripSlots } from './tab-strip-slot-geometry'

type StripSlot = { id: string; element: HTMLElement }
type StripSnapshot = { scope: string; slots: StripSlot[] }

// Why: a drop ends the drag in the same commit that moves the tab, or just after it.
const DRAG_SETTLE_MS = 300

function readSlots(strip: HTMLElement): StripSlot[] {
  return getTabStripSlots(strip).map((element) => ({
    id: element.dataset.tabStripSlot ?? '',
    element
  }))
}

/** A new tab grows from nothing to its width; the strip's flex layout slides its neighbours. */
export function growTabStripSlot(slot: HTMLElement): void {
  if (typeof slot.animate !== 'function') {
    return
  }
  slot.setAttribute('data-tab-motion', '')
  // Why one keyframe: the run ends on the slot's own width, whatever the strip settles to.
  const animation = slot.animate([{ width: '0px', minWidth: '0px', offset: 0 }], {
    duration: TAB_MOTION.growMs,
    easing: EASE3_CSS
  })
  animation.addEventListener('finish', () => slot.removeAttribute('data-tab-motion'))
  animation.addEventListener('cancel', () => slot.removeAttribute('data-tab-motion'))
}

/** Paints a copy of a closed tab where it was and shrinks it to nothing, then removes it. */
export function shrinkClosedTabStripSlot(
  strip: HTMLElement,
  closed: HTMLElement,
  before: Node | null,
  ghosts: Set<HTMLElement>
): HTMLElement | null {
  const ghost = closed.cloneNode(true)
  if (!(ghost instanceof HTMLElement) || typeof ghost.animate !== 'function') {
    return null
  }
  // Why keep the attributes: the strip's styles key on them; empty values answer no lookup.
  ghost.setAttribute('data-tab-strip-slot', '')
  ghost.setAttribute('data-tab-strip-ghost', '')
  ghost.setAttribute('data-tab-motion', '')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.removeAttribute('data-active-tab-dock')
  ghost.inert = true
  ghost.style.position = 'relative'
  ghost.style.pointerEvents = 'none'
  ghost.querySelectorAll('[id],[data-testid]').forEach((element) => {
    element.removeAttribute('id')
    element.removeAttribute('data-testid')
  })
  ghost.querySelectorAll('[data-tab-id]').forEach((element) => {
    element.setAttribute('data-tab-id', '')
  })
  strip.insertBefore(ghost, before)
  ghosts.add(ghost)
  const animation = ghost.animate([{ width: '0px', minWidth: '0px', offset: 1 }], {
    duration: TAB_MOTION.shrinkMs,
    easing: EASE3_CSS,
    fill: 'forwards'
  })
  animation.addEventListener('finish', () => {
    ghosts.delete(ghost)
    ghost.remove()
  })
  return ghost
}

// Why: a scrolling strip's reveal and end-pinning measure slots; a slot changing width under
// them scrolls the strip, so tabs there land at once.
function stripOverflows(strip: HTMLElement): boolean {
  return strip.scrollWidth > strip.clientWidth + 1
}

function removeGhosts(ghosts: Set<HTMLElement>): void {
  ghosts.forEach((ghost) => ghost.remove())
  ghosts.clear()
}

/** Where a closed slot sat: before the next slot of the old order that is still in the strip. */
function findInsertionPoint(
  strip: HTMLElement,
  previous: readonly StripSlot[],
  index: number,
  currentIds: ReadonlySet<string>,
  current: readonly StripSlot[]
): Node | null {
  for (let next = index + 1; next < previous.length; next++) {
    const slot = previous[next]
    if (slot && currentIds.has(slot.id) && slot.element.parentElement === strip) {
      return slot.element
    }
  }
  return current.at(-1)?.element.nextSibling ?? null
}

/** Tabs grow in when opened and shrink out when closed, neighbours sliding with them. */
export function useTabStripMotion(args: {
  tabStripRef: RefObject<HTMLDivElement | null>
  layoutKey: string
  worktreeId: string
  groupId: string
  isTabDragActive: boolean
}): void {
  const { tabStripRef, layoutKey, worktreeId, groupId, isTabDragActive } = args
  const previousRef = useRef<StripSnapshot | null>(null)
  const dragEndedAtRef = useRef(Number.NEGATIVE_INFINITY)
  const wasDraggingRef = useRef(isTabDragActive)
  const ghostsRef = useRef(new Set<HTMLElement>())

  useLayoutEffect(() => {
    const strip = tabStripRef.current
    const ghosts = ghostsRef.current
    const now = performance.now()
    if (wasDraggingRef.current || isTabDragActive) {
      dragEndedAtRef.current = now
    }
    wasDraggingRef.current = isTabDragActive
    if (!strip) {
      previousRef.current = null
      return
    }
    const scope = `${worktreeId}\u0000${groupId}`
    const slots = readSlots(strip)
    const previous = previousRef.current
    previousRef.current = { scope, slots }
    if (previous?.scope !== scope) {
      removeGhosts(ghosts)
    }
    if (
      !previous ||
      previous.scope !== scope ||
      now - dragEndedAtRef.current < DRAG_SETTLE_MS ||
      prefersReducedMotion()
    ) {
      return
    }
    const previousIds = new Set(previous.slots.map((slot) => slot.id))
    const currentIds = new Set(slots.map((slot) => slot.id))
    const opened = slots.filter((slot) => !previousIds.has(slot.id))
    const closedIndexes = previous.slots.flatMap((slot, index) =>
      currentIds.has(slot.id) ? [] : [index]
    )
    // Why: a preview tab replaced in place is a content swap, not a close and an open.
    const replacedInPlace =
      opened.length === 1 &&
      closedIndexes.length === 1 &&
      opened[0] !== undefined &&
      slots.indexOf(opened[0]) === closedIndexes[0]
    if (replacedInPlace || stripOverflows(strip)) {
      return
    }
    // Why only one: a restore or a group merge fills the strip at once and lands at once.
    if (opened.length === 1 && opened[0]) {
      growTabStripSlot(opened[0].element)
    }
    const painted: HTMLElement[] = []
    for (const index of closedIndexes) {
      const closed = previous.slots[index]
      const before = closed && findInsertionPoint(strip, previous.slots, index, currentIds, slots)
      const ghost = closed
        ? shrinkClosedTabStripSlot(strip, closed.element, before ?? null, ghosts)
        : null
      if (ghost) {
        painted.push(ghost)
      }
    }
    // Copies that would make the strip scroll are dropped before they paint.
    if (painted.length > 0 && stripOverflows(strip)) {
      for (const ghost of painted) {
        ghosts.delete(ghost)
        ghost.remove()
      }
    }
  }, [groupId, isTabDragActive, layoutKey, tabStripRef, worktreeId])

  useLayoutEffect(() => {
    const ghosts = ghostsRef.current
    return () => removeGhosts(ghosts)
  }, [])
}
