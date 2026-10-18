// @vitest-environment happy-dom

import { useRef } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '@/store/types'
import { makePRRefreshWorktree } from '@/store/slices/github-slice-test-harness'
import type { WorktreeItemRow } from '../listing/renderable-rows'
import { useVisiblePrRefreshReporting } from './use-visible-review-refresh'

const state = vi.hoisted(() => {
  const properties: AppState['worktreeCardProperties'] = ['pr']
  return { publish: vi.fn<(ids: readonly string[]) => void>(), properties }
})

vi.mock('@/store', () => ({
  useAppStore: <T,>(
    selector: (
      state: Pick<AppState, 'setVisibleReviewCardWorktreeIds' | 'worktreeCardProperties'>
    ) => T
  ): T =>
    selector({
      setVisibleReviewCardWorktreeIds: state.publish,
      worktreeCardProperties: state.properties
    })
}))

function measurable(element: HTMLDivElement | null): void {
  if (!element) {
    return
  }
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 100 })
  element.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100)
}

function Harness({ id = 'local-worktree' }: { id?: string }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const worktree = makePRRefreshWorktree({ id })
  const row: WorktreeItemRow = {
    type: 'item',
    rowKey: id,
    sectionKey: 'all',
    worktree,
    repo: {
      id: 'repo-1',
      path: '/repo',
      displayName: 'repo',
      badgeColor: '',
      addedAt: 1,
      kind: 'git'
    },
    depth: 0,
    groupDepth: 0,
    lineageTrail: [],
    isLastLineageChild: true,
    lineageChildCount: 0
  }
  useVisiblePrRefreshReporting({
    currentWorktreeId: id,
    worktreeMap: new Map([[id, worktree]]),
    groupBy: 'none',
    newCardStyle: false,
    renderRows: [row],
    virtualItems: [{ key: id, index: 0, start: 0, end: 100, size: 100, lane: 0 }],
    scrollRef
  })
  return (
    <div
      ref={(element) => {
        scrollRef.current = element
        measurable(element)
      }}
    >
      <div data-worktree-id={id} ref={measurable} />
    </div>
  )
}

function advance(ms: number): void {
  act(() => vi.advanceTimersByTime(ms))
}

beforeEach(() => {
  vi.useFakeTimers()
  state.publish.mockClear()
  state.properties = ['pr']
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('visible review publication', () => {
  it('publishes the latest membership without extending its first deadline', () => {
    const { rerender } = render(<Harness id="local-worktree" />)
    advance(80)
    rerender(<Harness id="ssh-worktree" />)
    advance(19)
    const beforeDeadline = state.publish.mock.calls.slice()
    advance(1)

    expect({ beforeDeadline, published: state.publish.mock.calls }).toEqual({
      beforeDeadline: [],
      published: [[['ssh-worktree']]]
    })
  })

  it('does not starve publication during repeated virtualizer renders', () => {
    const { rerender } = render(<Harness />)
    for (let index = 1; index <= 4; index += 1) {
      advance(20)
      rerender(<Harness id={`workspace-${index}`} />)
    }
    advance(20)

    expect(state.publish.mock.calls).toEqual([[['workspace-4']]])
  })

  it('clears hidden membership immediately and never publishes the pending ids', () => {
    render(<Harness />)
    advance(50)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    const immediate = state.publish.mock.calls.slice()
    advance(200)

    expect({ immediate, settled: state.publish.mock.calls }).toEqual({
      immediate: [[[]]],
      settled: [[[]]]
    })
  })

  it('clears immediately when review decorations are disabled', () => {
    const { rerender } = render(<Harness />)
    state.properties = []
    rerender(<Harness />)
    const immediate = state.publish.mock.calls.slice()
    advance(200)

    expect({ immediate, settled: state.publish.mock.calls }).toEqual({
      immediate: [[[]]],
      settled: [[[]]]
    })
  })

  it('cancels pending publication when its owner unmounts', () => {
    const { unmount } = render(<Harness />)
    advance(50)
    unmount()
    const immediate = state.publish.mock.calls.slice()
    advance(200)

    expect({ immediate, settled: state.publish.mock.calls }).toEqual({
      immediate: [[[]]],
      settled: [[[]]]
    })
  })

  it('starts a new publication window after returning from hidden', () => {
    render(<Harness />)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(50)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange')))
    advance(99)
    const beforeDeadline = state.publish.mock.calls.slice()
    advance(1)

    expect({ beforeDeadline, published: state.publish.mock.calls }).toEqual({
      beforeDeadline: [[[]]],
      published: [[[]], [['local-worktree']]]
    })
  })
})
