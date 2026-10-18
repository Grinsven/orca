import { getProjectGroupHeaderPaddingLeft, SIDEBAR_TREE_INDENT } from './indentation'
import type { WorktreeGroupBy } from '../grouping/row-types'

/** Aligns the card content with a nested section's icon without clipping the status lane. */
export function getNestedSectionCardAlignment(args: {
  groupBy: WorktreeGroupBy
  sectionKey: string
  groupDepth: number
  lineageDepth: number
  nested: boolean
  newCardStyle: boolean
  surfaceInset: number
}): { surfaceInset: string; contentPaddingLeft: string } | null {
  if (
    args.groupBy !== 'repo' ||
    args.nested ||
    !/\/(?:workspace-status|pr):[^/]*$/.test(args.sectionKey)
  ) {
    return null
  }

  const headerPadding =
    getProjectGroupHeaderPaddingLeft(args.groupDepth) + args.lineageDepth * SIDEBAR_TREE_INDENT
  // The header uses size-4; card lanes use w-5 in new cards and size-4 in legacy cards.
  const statusHalfWidth = args.newCardStyle ? 2.5 : 2
  const contentLeft = `calc(${headerPadding}px + var(--spacing) * ${2 - statusHalfWidth})`
  // The surface owns ml-1 and a 1px border; cap its inset before assigning content padding.
  const surfaceInset = `min(${args.surfaceInset}px, max(0px, calc(${contentLeft} - var(--spacing) - 1px)))`
  return {
    surfaceInset,
    contentPaddingLeft: `max(0px, calc(${contentLeft} - ${surfaceInset} - var(--spacing) - 1px))`
  }
}
