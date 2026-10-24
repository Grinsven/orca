import { useLayoutEffect, useMemo } from 'react'
import type React from 'react'
import type { VirtualItem } from '@tanstack/react-virtual'
import type { RenderRow } from '../listing/render-row'
import { getRenderRowKey } from '../listing/render-row'
import type { SidebarFoldMotion } from './fold-motion'

export type VirtualRowLayoutSnapshot = {
  rowIdentityKeys: ReadonlySet<string>
  scrollTop: number
  startsByKey: ReadonlyMap<string, number>
}

export type VirtualRowRemovalMotion = {
  deltaY: number
  key: string
}

/** Sidebar identities one render row draws; a lineage group draws each of its members. */
export function getRenderRowIdentities(row: RenderRow): string[] {
  return row.type === 'lineage-group'
    ? row.rows.map((member) => `wt:${member.rowKey}`)
    : [getRenderRowKey(row)]
}

export function getSidebarRowIdentityKeys(rows: readonly RenderRow[]): ReadonlySet<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    for (const identity of getRenderRowIdentities(row)) {
      keys.add(identity)
    }
  }
  return keys
}

function getPreviousRowKey(
  key: string,
  rekeyedRowKeys: ReadonlyMap<string, string>
): string | null {
  for (const [previousKey, currentKey] of rekeyedRowKeys) {
    if (currentKey === key) {
      return previousKey
    }
  }
  return null
}

/** How far the row under `key` moved on screen between two layouts, or null if unknown. */
export function getViewportDelta(
  previous: VirtualRowLayoutSnapshot,
  current: VirtualRowLayoutSnapshot,
  key: string,
  rekeyedRowKeys: ReadonlyMap<string, string>
): number | null {
  const previousKey = previous.startsByKey.has(key) ? key : getPreviousRowKey(key, rekeyedRowKeys)
  const previousStart = previousKey === null ? undefined : previous.startsByKey.get(previousKey)
  const currentStart = current.startsByKey.get(key)
  if (previousStart === undefined || currentStart === undefined) {
    return null
  }
  return previousStart - previous.scrollTop - (currentStart - current.scrollTop)
}

export function buildVirtualRowRemovalMotions(args: {
  previous: VirtualRowLayoutSnapshot | null
  current: VirtualRowLayoutSnapshot
  rekeyedRowKeys: ReadonlyMap<string, string>
}): VirtualRowRemovalMotion[] {
  const { previous, current, rekeyedRowKeys } = args
  if (previous === null || previous.rowIdentityKeys === current.rowIdentityKeys) {
    return []
  }
  let removedRow = false
  for (const key of previous.rowIdentityKeys) {
    if (!current.rowIdentityKeys.has(key)) {
      removedRow = true
      break
    }
  }
  if (!removedRow) {
    return []
  }

  const motions: VirtualRowRemovalMotion[] = []
  current.startsByKey.forEach((_start, key) => {
    const deltaY = getViewportDelta(previous, current, key, rekeyedRowKeys)
    if (deltaY !== null && Math.abs(deltaY) > 0.5) {
      motions.push({ deltaY, key })
    }
  })
  return motions
}

// Rows that stay glide from where they were drawn (FLIP); a group open or close also fades its
// own rows in or out. The fold controller decides which, per commit.
export function useVirtualRowRemovalAnimation(args: {
  renderRows: readonly RenderRow[]
  rekeyedRowKeys: ReadonlyMap<string, string>
  scrollRef: React.RefObject<HTMLDivElement | null>
  virtualItems: readonly VirtualItem[]
  measurements: readonly VirtualItem[]
  foldMotion: SidebarFoldMotion
  foldOverlayRef: React.RefObject<HTMLDivElement | null>
  dragActive: boolean
}): void {
  const {
    renderRows,
    rekeyedRowKeys,
    scrollRef,
    virtualItems,
    measurements,
    foldMotion,
    foldOverlayRef,
    dragActive
  } = args
  const rowIdentityKeys = useMemo(() => getSidebarRowIdentityKeys(renderRows), [renderRows])

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current
    if (!scrollElement) {
      return
    }
    foldMotion.commit({
      scrollElement,
      overlayHost: foldOverlayRef.current,
      renderRows,
      rowIdentityKeys,
      virtualItems,
      measurements,
      rekeyedRowKeys,
      dragActive
    })
  }, [
    dragActive,
    foldMotion,
    foldOverlayRef,
    measurements,
    rekeyedRowKeys,
    renderRows,
    rowIdentityKeys,
    scrollRef,
    virtualItems
  ])
}
