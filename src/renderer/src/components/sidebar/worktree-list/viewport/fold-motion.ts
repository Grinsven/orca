import type { VirtualItem } from '@tanstack/react-virtual'
import {
  FOLD_MOTION,
  foldRowDelayMs,
  prefersReducedMotion,
  ROW_REMOVAL_MOTION
} from '@/fork/diri-motion/motion'
import {
  playMotion,
  readMotionState,
  REST_STATE,
  shiftMotion,
  type MotionState
} from '@/fork/diri-motion/motion-tracks'
import type { RenderRow } from '../listing/render-row'
import {
  addFoldCopy,
  captureCopySources,
  clearFoldCopies,
  contentOf,
  memberElement,
  mountedRows,
  type FoldCopies,
  type FoldCopySource,
  type FoldHandoff
} from './fold-overlay'
import {
  buildVirtualRowRemovalMotions,
  getRenderRowIdentities,
  getViewportDelta,
  type VirtualRowLayoutSnapshot
} from './use-row-removal-animation'

export type FoldDirection = 'open' | 'close'

/** Everything one commit hands the fold: the list as rendered and the virtualizer's view of it. */
export type FoldCommit = {
  scrollElement: HTMLElement
  overlayHost: HTMLElement | null
  renderRows: readonly RenderRow[]
  rowIdentityKeys: ReadonlySet<string>
  virtualItems: readonly VirtualItem[]
  measurements: readonly VirtualItem[]
  rekeyedRowKeys: ReadonlyMap<string, string>
  dragActive: boolean
}

type PendingFold = {
  direction: FoldDirection
  at: number
  layout: VirtualRowLayoutSnapshot
  copies: FoldCopySource[]
  handoff: ReadonlyMap<string, FoldHandoff>
}

type ActiveFold = {
  startedAt: number
  endsAt: number
  rankByIdentity: ReadonlyMap<string, number>
  revealed: WeakSet<Element>
}

// Why a window: the collapse commits in the same task as the click; a fold that never commits
// (an empty group) must not claim a later data change.
const PENDING_FOLD_TTL_MS = 250
const EMPTY_KEYS: ReadonlySet<string> = new Set()

function startsOf(items: readonly VirtualItem[]): Map<string, number> {
  return new Map(items.map((item) => [String(item.key), item.start]))
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  left.forEach((key) => {
    if (!right.has(key)) {
      out.add(key)
    }
  })
  return out
}

export function createSidebarFoldMotion() {
  const copies: FoldCopies = new Map()
  let previous: VirtualRowLayoutSnapshot | null = null
  let pending: PendingFold | null = null
  let active: ActiveFold | null = null

  const glide = (element: HTMLElement | null, deltaY: number, durationMs: number): void => {
    if (!element || Math.abs(deltaY) <= 0.5) {
      return
    }
    const state = readMotionState(element) ?? REST_STATE
    playMotion(element, {
      from: { y: state.y + deltaY, opacity: state.opacity },
      durationMs
    })
  }

  const reveal = (fold: ActiveFold, element: HTMLElement, from: MotionState, id: string): void => {
    const delayMs = foldRowDelayMs(fold.rankByIdentity.get(id) ?? 0)
    fold.revealed.add(element)
    playMotion(element, {
      from,
      delayMs: delayMs - (performance.now() - fold.startedAt),
      durationMs: FOLD_MOTION.openMs - delayMs
    })
  }

  const play = (fold: PendingFold, commit: FoldCommit, current: VirtualRowLayoutSnapshot): void => {
    const now = performance.now()
    const added = difference(current.rowIdentityKeys, fold.layout.rowIdentityKeys)
    const removed = difference(fold.layout.rowIdentityKeys, current.rowIdentityKeys)
    const rankByIdentity = new Map<string, number>()
    for (const row of fold.direction === 'open' ? commit.renderRows : []) {
      for (const identity of getRenderRowIdentities(row)) {
        if (added.has(identity)) {
          rankByIdentity.set(identity, rankByIdentity.size)
        }
      }
    }
    const next: ActiveFold = {
      startedAt: now,
      endsAt: now + (fold.direction === 'open' ? FOLD_MOTION.openMs : FOLD_MOTION.closeMs),
      rankByIdentity,
      revealed: new WeakSet()
    }
    active = next
    if (fold.direction === 'close' && commit.overlayHost) {
      const copied: HTMLElement[] = []
      for (const source of fold.copies) {
        if (
          source.identities.every((identity) => removed.has(identity)) &&
          !copied.some((element) => element.contains(source.element))
        ) {
          addFoldCopy(commit.overlayHost, copies, source)
          copied.push(source.element)
        }
      }
    }
    // Plan first: a reopen reads where each row lands before any animation dirties layout.
    const hostTop =
      fold.handoff.size > 0 ? (commit.overlayHost?.getBoundingClientRect().top ?? 0) : 0
    const reveals: {
      element: HTMLElement
      from: MotionState
      identity: string
    }[] = []
    const plan = (element: HTMLElement, identity: string): void => {
      const handoff = fold.handoff.get(identity)
      const from = handoff
        ? {
            y: handoff.box.top + handoff.state.y - (element.getBoundingClientRect().top - hostTop),
            opacity: handoff.state.opacity
          }
        : { y: -FOLD_MOTION.offsetPx, opacity: 0 }
      reveals.push({ element, from, identity })
    }
    const glides: { element: HTMLElement | null; deltaY: number }[] = []
    const rows = mountedRows(commit.scrollElement)
    for (const item of commit.virtualItems) {
      const row = rows.get(String(item.key))
      const renderRow = commit.renderRows[item.index]
      const content = row ? contentOf(row) : null
      if (!row || !renderRow || !content) {
        continue
      }
      const identities = getRenderRowIdentities(renderRow)
      if (identities.every((identity) => added.has(identity))) {
        plan(content, identities[0] ?? '')
        continue
      }
      for (const identity of identities) {
        const member = added.has(identity) ? memberElement(row, identity) : null
        if (member) {
          plan(member, identity)
        }
      }
      const deltaY = getViewportDelta(fold.layout, current, String(item.key), commit.rekeyedRowKeys)
      glides.push({ element: content, deltaY: deltaY ?? 0 })
    }
    for (const entry of reveals) {
      reveal(next, entry.element, entry.from, entry.identity)
    }
    for (const entry of glides) {
      glide(entry.element, entry.deltaY, next.endsAt - now)
    }
  }

  // Measurement settles inserted rows after the fold started; keep everything continuous.
  const correct = (
    fold: ActiveFold,
    commit: FoldCommit,
    last: VirtualRowLayoutSnapshot,
    current: VirtualRowLayoutSnapshot
  ): void => {
    const remainingMs = fold.endsAt - performance.now()
    const rows = mountedRows(commit.scrollElement)
    for (const item of commit.virtualItems) {
      const row = rows.get(String(item.key))
      const renderRow = commit.renderRows[item.index]
      const content = row ? contentOf(row) : null
      if (!renderRow || !content) {
        continue
      }
      const identity = getRenderRowIdentities(renderRow)[0] ?? ''
      if (fold.rankByIdentity.has(identity) && !fold.revealed.has(content)) {
        reveal(fold, content, { y: -FOLD_MOTION.offsetPx, opacity: 0 }, identity)
        continue
      }
      const deltaY = getViewportDelta(last, current, String(item.key), commit.rekeyedRowKeys)
      if (deltaY !== null && Math.abs(deltaY) > 0.5) {
        shiftMotion(content, deltaY, remainingMs)
      }
    }
  }

  return {
    /** Call in the toggle path, before the collapse or expand commits. */
    begin(args: {
      direction: FoldDirection
      scrollElement: HTMLElement
      overlayHost: HTMLElement | null
      measurements: readonly VirtualItem[]
    }): void {
      const handoff = clearFoldCopies(copies)
      if (prefersReducedMotion() || !previous) {
        pending = null
        return
      }
      pending = {
        direction: args.direction,
        at: performance.now(),
        layout: {
          rowIdentityKeys: previous.rowIdentityKeys,
          scrollTop: args.scrollElement.scrollTop,
          startsByKey: startsOf(args.measurements)
        },
        copies:
          args.direction === 'close' && args.overlayHost
            ? captureCopySources(args.scrollElement, args.overlayHost)
            : [],
        handoff
      }
    },

    commit(commit: FoldCommit): void {
      const now = performance.now()
      if (pending && now - pending.at > PENDING_FOLD_TTL_MS) {
        pending = null
      }
      const fold = active && now < active.endsAt ? active : null
      const last = previous
      const current: VirtualRowLayoutSnapshot = {
        rowIdentityKeys: commit.rowIdentityKeys,
        scrollTop: commit.scrollElement.scrollTop,
        startsByKey: startsOf(fold || pending ? commit.measurements : commit.virtualItems)
      }
      previous = current
      if (!last || prefersReducedMotion()) {
        return
      }
      const sameRows = last.rowIdentityKeys === current.rowIdentityKeys
      const added = sameRows
        ? EMPTY_KEYS
        : difference(current.rowIdentityKeys, last.rowIdentityKeys)
      const removed = sameRows
        ? EMPTY_KEYS
        : difference(last.rowIdentityKeys, current.rowIdentityKeys)
      if (added.size === 0 && removed.size === 0) {
        if (fold) {
          correct(fold, commit, last, current)
        }
        return
      }
      const folding = pending
      pending = null
      const direction: FoldDirection | null =
        added.size > 0 && removed.size === 0
          ? 'open'
          : removed.size > 0 && added.size === 0
            ? 'close'
            : null
      if (folding && !commit.dragActive && folding.direction === direction) {
        play(folding, commit, current)
        return
      }
      // Not a fold (data, filter, regroup): only rows that lost a neighbour glide.
      const rows = mountedRows(commit.scrollElement)
      for (const motion of buildVirtualRowRemovalMotions({
        previous: last,
        current,
        rekeyedRowKeys: commit.rekeyedRowKeys
      })) {
        const row = rows.get(motion.key)
        glide(row ? contentOf(row) : null, motion.deltaY, ROW_REMOVAL_MOTION.durationMs)
      }
    }
  }
}

export type SidebarFoldMotion = ReturnType<typeof createSidebarFoldMotion>
