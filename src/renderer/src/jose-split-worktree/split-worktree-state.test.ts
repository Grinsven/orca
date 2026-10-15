import { afterEach, describe, expect, it } from 'vitest'
import {
  planSplitLayout,
  publishSplitLayout,
  isSplitWorktreeVisible,
  useSplitWorktreeState
} from './split-worktree-state'
import { splitEdgeAt, splitHalfRect } from './split-worktree-drop-zones'

const a = { worktreeId: 'a', executionHostId: 'local' as const }
const b = { worktreeId: 'b', executionHostId: 'local' as const }
const c = { worktreeId: 'c', executionHostId: 'ssh:box' as const }
const rect = { left: 100, top: 40, width: 800, height: 600 }
afterEach(() => useSplitWorktreeState.setState({ layout: null, revision: 0 }))

describe('workspace split layout', () => {
  it('keeps the opposite slot when a third workspace is dropped on an edge', () => {
    const opened = planSplitLayout(null, a, b, 'right')
    expect(planSplitLayout(opened, b, c, 'left')).toEqual({
      slots: [c, b],
      axis: 'horizontal',
      ratio: 0.5
    })
  })

  it('keeps both workspaces visible without treating settings as a visible workbench', () => {
    publishSplitLayout(planSplitLayout(null, a, b, 'right'))
    expect([
      isSplitWorktreeVisible('a', 'terminal'),
      isSplitWorktreeVisible('b', 'terminal'),
      isSplitWorktreeVisible('b', 'settings')
    ]).toEqual([true, true, false])
  })

  it('targets only the outer edges and previews the exact destination half', () => {
    expect({
      center: splitEdgeAt(rect, 500, 340),
      outside: splitEdgeAt(rect, 950, 300),
      right: splitEdgeAt(rect, 850, 340),
      top: splitEdgeAt(rect, 500, 50),
      half: splitHalfRect(rect, 'right')
    }).toEqual({
      center: null,
      outside: null,
      right: 'right',
      top: 'top',
      half: { left: 500, top: 40, width: 400, height: 600 }
    })
  })
})
