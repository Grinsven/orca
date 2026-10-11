import { describe, expect, it } from 'vitest'
import {
  getNestedAlignContentShift,
  getSectionHeaderPaddingLeft,
  isNestedSecondarySectionKey,
  withNestedAlignShift
} from './two-level-nested-alignment'
import {
  PROJECT_GROUP_HEADER_INDENT,
  WORKTREE_SECTION_HEADER_PADDING_LEFT,
  getProjectGroupHeaderPaddingLeft
} from './indentation'

describe('two-level nested alignment', () => {
  it('recognises a Status or PR section nested under a project, not a top-level one', () => {
    expect(
      isNestedSecondarySectionKey(
        'project:github:algemi-intellect/algemi/workspace-status:in-progress'
      )
    ).toBe(true)
    expect(isNestedSecondarySectionKey('repo:abc/pr-status:open')).toBe(true)
    expect(isNestedSecondarySectionKey('workspace-status:in-progress')).toBe(false)
    expect(isNestedSecondarySectionKey('project:github:algemi-intellect/algemi')).toBe(false)
    expect(isNestedSecondarySectionKey('workspace-status:done/project:github:org/repo')).toBe(false)
  })

  it('puts a nested Status header on its project padding and leaves project headers alone', () => {
    expect(getSectionHeaderPaddingLeft(1, false)).toBe(getProjectGroupHeaderPaddingLeft(0))
    expect(getSectionHeaderPaddingLeft(2, false)).toBe(getProjectGroupHeaderPaddingLeft(1))
    expect(getSectionHeaderPaddingLeft(0, false)).toBe(WORKTREE_SECTION_HEADER_PADDING_LEFT)
    expect(getSectionHeaderPaddingLeft(undefined, false)).toBe(WORKTREE_SECTION_HEADER_PADDING_LEFT)
    expect(getSectionHeaderPaddingLeft(1, true)).toBe(getProjectGroupHeaderPaddingLeft(1))
    expect(getSectionHeaderPaddingLeft(0, true)).toBe(getProjectGroupHeaderPaddingLeft(0))
  })

  it('shifts only cards in a nested Status or PR section, by one header step', () => {
    expect(getNestedAlignContentShift('repo:abc/workspace-status:done')).toBe(
      PROJECT_GROUP_HEADER_INDENT
    )
    expect(getNestedAlignContentShift('workspace-status:done')).toBe(0)
    expect(getNestedAlignContentShift('pinned')).toBe(0)
  })

  it('subtracts the shift from the card padding and leaves unshifted cards byte for byte', () => {
    const padding = 'max(2px, calc(20px - 10px))'
    expect(withNestedAlignShift(padding, 10)).toBe(
      'max(0px, calc(max(2px, calc(20px - 10px)) - 10px))'
    )
    expect(withNestedAlignShift(padding, 0)).toBe(padding)
    expect(withNestedAlignShift(padding)).toBe(padding)
  })
})
