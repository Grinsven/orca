// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { useSplitWorktreeState, planSplitLayout } from './split-worktree-state'
import { useSplitWorkspaceHasFocus } from './split-worktree-surface'

const original = useAppStore.getState()
const a = { worktreeId: 'a', executionHostId: 'local' as const }
const b = { worktreeId: 'b', executionHostId: 'local' as const }
afterEach(() => {
  useAppStore.setState(original, true)
  useSplitWorktreeState.setState({ layout: null, pending: false, ownershipUnconfirmed: false })
})

describe('visible workspace keyboard ownership', () => {
  it('updates memoized consumers when only workspace focus or ownership confirmation changes', () => {
    useAppStore.setState({ activeWorktreeId: 'a' })
    useSplitWorktreeState.setState({ layout: planSplitLayout(null, a, b, 'right') })
    const { result, unmount } = renderHook(() => [
      useSplitWorkspaceHasFocus('a'),
      useSplitWorkspaceHasFocus('b')
    ])
    const first = result.current
    act(() => useAppStore.setState({ activeWorktreeId: 'b' }))
    const second = result.current
    act(() => useSplitWorktreeState.setState({ ownershipUnconfirmed: true }))
    const disconnected = result.current
    unmount()
    expect({ first, second, disconnected }).toEqual({
      first: [true, false],
      second: [false, true],
      disconnected: [false, false]
    })
  })
})
