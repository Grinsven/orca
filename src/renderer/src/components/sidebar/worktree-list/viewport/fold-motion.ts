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
  addFoldCopiesOfRemoved,
  captureCopySources,
  capturePaintedTops,
  clearFoldCopies,
  contentOf,
  memberElement,
  mountedRows,
  type FoldCopies,
  type FoldCopySource,
  type FoldHandoff
} from './fold-overlay'
import { closeFoldEdge, openFoldEdge, retargetFoldEdge, type FoldEdgeRun } from './fold-clip'
import {
  buildVirtualRowRemovalMotions,
  difference,
  getPreviousRowKey,
  getRenderRowIdentities,
  startsOf,
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
  paintedTops: ReadonlyMap<string, number>
}

type ActiveFold = {
  startedAt: number
  endsAt: number
  rankByIdentity: ReadonlyMap<string, number>
  revealed: WeakSet<Element>
  edge: FoldEdgeRun | null
}

// Why a window: the collapse commits in the same task as the click; a fold that never commits
// (an empty group) must not claim a later data change.
const PENDING_FOLD_TTL_MS = 250
const EMPTY_KEYS: ReadonlySet<string> = new Set()

export function createSidebarFoldMotion() {
  const copies: FoldCopies = new Map()
  let previous: VirtualRowLayoutSnapshot | null = null
  let pending: PendingFold | null = null
  let active: ActiveFold | null = null

  /** Glides `element` to its layout from `fromY` (an offset from that layout), if it moved. */
  const glide = (element: HTMLElement | null, fromY: number, durationMs: number): void => {
    const state = element ? (readMotionState(element) ?? REST_STATE) : null
    if (element && state && Math.abs(fromY - state.y) > 0.5) {
      playMotion(element, { from: { y: fromY, opacity: state.opacity }, durationMs })
    }
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
      revealed: new WeakSet(),
      edge: null
    }
    active = next
    if (fold.direction === 'close' && commit.overlayHost) {
      const copyRows = addFoldCopiesOfRemoved(commit.overlayHost, copies, fold.copies, removed)
      const staying = fold.copies.filter((source) =>
        source.identities.every((identity) => !removed.has(identity))
      )
      next.edge = closeFoldEdge(copyRows, staying, FOLD_MOTION.closeMs, now)
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
    const glides: { element: HTMLElement; fromY: number }[] = []
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
      // Why where it was drawn, not its slot: a header's spacing can change with the fold.
      const key = String(item.key)
      const drawnBefore =
        fold.paintedTops.get(key) ??
        fold.paintedTops.get(getPreviousRowKey(key, commit.rekeyedRowKeys) ?? '')
      const drawnY = readMotionState(content)?.y ?? 0
      const fromY =
        drawnBefore === undefined
          ? drawnY + (deltaY ?? 0)
          : drawnBefore - (content.getBoundingClientRect().top - drawnY)
      glides.push({ element: content, fromY })
    }
    if (fold.direction === 'open') {
      const opening = reveals.map((entry) => entry.element)
      next.edge = openFoldEdge(opening, glides, FOLD_MOTION.openMs, now)
    }
    for (const entry of reveals) {
      reveal(next, entry.element, entry.from, entry.identity)
    }
    for (const entry of glides) {
      glide(entry.element, entry.fromY, next.endsAt - now)
    }
  }

  // Measurement settles inserted rows after the fold started; keep everything continuous.
  const correct = (
    fold: ActiveFold,
    commit: FoldCommit,
    last: VirtualRowLayoutSnapshot,
    current: VirtualRowLayoutSnapshot
  ): void => {
    const now = performance.now()
    const rows = mountedRows(commit.scrollElement)
    const reveals: { content: HTMLElement; identity: string }[] = []
    const persisting: { content: HTMLElement; deltaY: number | null }[] = []
    for (const item of commit.virtualItems) {
      const row = rows.get(String(item.key))
      const renderRow = commit.renderRows[item.index]
      const content = row ? contentOf(row) : null
      if (!renderRow || !content) {
        continue
      }
      const identity = getRenderRowIdentities(renderRow)[0] ?? ''
      if (fold.rankByIdentity.has(identity) && !fold.revealed.has(content)) {
        reveals.push({ content, identity })
      } else {
        const deltaY = getViewportDelta(last, current, String(item.key), commit.rekeyedRowKeys)
        persisting.push({ content, deltaY })
      }
    }
    // Plan first: the edge measures settled rows before any new animation dirties layout.
    if (fold.edge && fold.edge.toPx > fold.edge.fromPx) {
      const opening = [
        ...fold.edge.rows.map((row) => row.element),
        ...reveals.map((r) => r.content)
      ]
      const others = persisting.map((entry) => entry.content)
      fold.edge = retargetFoldEdge(fold.edge, opening, others, now, fold.endsAt)
    }
    for (const { content, identity } of reveals) {
      reveal(fold, content, { y: -FOLD_MOTION.offsetPx, opacity: 0 }, identity)
    }
    for (const { content, deltaY } of persisting) {
      if (deltaY !== null && Math.abs(deltaY) > 0.5) {
        shiftMotion(content, deltaY, fold.endsAt - now)
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
        handoff,
        paintedTops: capturePaintedTops(args.scrollElement)
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
        const content = rows.get(motion.key)
        const element = content ? contentOf(content) : null
        const drawnY = element ? (readMotionState(element)?.y ?? 0) : 0
        glide(element, drawnY + motion.deltaY, ROW_REMOVAL_MOTION.durationMs)
      }
    }
  }
}

export type SidebarFoldMotion = ReturnType<typeof createSidebarFoldMotion>
