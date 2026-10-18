import { describe, expect, it } from 'vitest'
import { getNestedSectionCardAlignment } from './nested-section-card-alignment'

describe('nested section card alignment', () => {
  it.each([
    ['repo', 'project:repo:a/workspace-status:in-progress', false, true],
    ['repo', 'project:repo:a/pr:in-progress', false, true],
    ['repo', 'project-group:a/workspace-status:in-progress', false, true],
    ['repo', 'project:repo:a', false, false],
    ['workspace-status', 'workspace-status:in-progress', false, false],
    ['pr-status', 'pr:in-progress/project:repo:a', false, false],
    ['repo', 'project:repo:a/workspace-status:in-progress', true, false]
  ] as const)('scopes %s / %s with nested=%s', (groupBy, sectionKey, nested, aligned) => {
    expect(
      getNestedSectionCardAlignment({
        groupBy,
        sectionKey,
        nested,
        groupDepth: 1,
        lineageDepth: 0,
        newCardStyle: true,
        surfaceInset: 14
      }) !== null
    ).toBe(aligned)
  })
})
