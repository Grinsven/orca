/* Jose fork-local: in two-level grouping a nested Status or PR header and the cards under it start
   at their project's left edge, so each level does not spend another step of the narrow sidebar. */
import {
  PROJECT_GROUP_HEADER_INDENT,
  WORKTREE_SECTION_HEADER_PADDING_LEFT,
  getProjectGroupHeaderPaddingLeft
} from './indentation'

// Why the key: nested sections are `${primaryKey}/${secondaryKey}`, and project keys contain '/' too.
const NESTED_SECONDARY_SECTION_KEY = /\/(?:workspace-status|pr-status):[^/]*$/

export function isNestedSecondarySectionKey(sectionKey: string): boolean {
  return NESTED_SECONDARY_SECTION_KEY.test(sectionKey)
}

export function getSectionHeaderPaddingLeft(
  projectGroupDepth: number | undefined,
  isProjectHeader: boolean
): number {
  const depth = projectGroupDepth ?? 0
  if (isProjectHeader) {
    return getProjectGroupHeaderPaddingLeft(depth)
  }
  // Why depth - 1: a nested Status/PR header sits on its parent project's padding.
  return depth > 0
    ? getProjectGroupHeaderPaddingLeft(depth - 1)
    : WORKTREE_SECTION_HEADER_PADDING_LEFT
}

/** Content shift for a card in a nested Status/PR section: one header step, like its header. */
export function getNestedAlignContentShift(sectionKey: string): number {
  return isNestedSecondarySectionKey(sectionKey) ? PROJECT_GROUP_HEADER_INDENT : 0
}

// Why max(0px): the shift may exceed the flush card's 2px minimum inset, so the content can sit on
// the surface edge, where its leading icon lines up with the project icon.
export function withNestedAlignShift(paddingLeft: string, contentShift = 0): string {
  return contentShift > 0 ? `max(0px, calc(${paddingLeft} - ${contentShift}px))` : paddingLeft
}
