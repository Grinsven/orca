// @vitest-environment happy-dom
import { useCallback } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { useAppStore } from '../store'
import { useAppChromeLayout } from './use-app-chrome-layout'

const initialState = useAppStore.getState()

afterEach(() => {
  cleanup()
  useAppStore.setState(initialState, true)
  vi.unstubAllGlobals()
})

it('measures header width only while floating and refreshes it on return', () => {
  const observers: ProbeResizeObserver[] = []
  class ProbeResizeObserver implements ResizeObserver {
    active = false
    constructor(private readonly callback: ResizeObserverCallback) {
      observers.push(this)
    }
    observe(): void {
      this.active = true
    }
    unobserve(): void {
      this.active = false
    }
    disconnect(): void {
      this.active = false
    }
    deliver(): void {
      this.callback([], this)
    }
  }
  vi.stubGlobal('ResizeObserver', ProbeResizeObserver)
  let width = 180
  const measure = vi.fn(() => new DOMRect(0, 0, width, 36))
  useAppStore.setState({
    settings: getDefaultSettings('/tmp'),
    activeView: 'terminal',
    activeWorktreeId: 'measurement-worktree',
    sidebarOpen: true
  })
  function Chrome() {
    const layout = useAppChromeLayout()
    const controlsRef = layout.titlebarLeftControlsRef
    const attach = useCallback(
      (node: HTMLDivElement | null) => {
        if (node) {
          node.getBoundingClientRect = measure
        }
        controlsRef.current = node
      },
      [controlsRef]
    )
    return <div ref={attach} data-reserved-width={layout.collapsedSidebarHeaderWidth} />
  }
  const { container } = render(<Chrome />)
  const read = () => ({
    width: container.firstElementChild?.getAttribute('data-reserved-width'),
    reads: measure.mock.calls.length,
    observers: observers.length,
    observing: observers.filter((observer) => observer.active).length
  })
  const timeline = [read()]
  act(() => useAppStore.setState({ activeView: 'settings' }))
  timeline.push(read())
  act(() => useAppStore.setState({ activeView: 'terminal' }))
  timeline.push(read())
  act(() => useAppStore.setState({ sidebarOpen: false }))
  timeline.push(read())
  width = 200
  act(() => observers.at(-1)?.deliver())
  timeline.push(read())
  act(() => useAppStore.setState({ activeView: 'settings' }))
  timeline.push(read())
  width = 220
  act(() => useAppStore.setState({ activeView: 'terminal' }))
  timeline.push(read())
  act(() => useAppStore.setState({ sidebarOpen: true }))
  timeline.push(read())

  expect(timeline).toEqual([
    { width: '0', reads: 0, observers: 0, observing: 0 },
    { width: '0', reads: 0, observers: 0, observing: 0 },
    { width: '0', reads: 0, observers: 0, observing: 0 },
    { width: '180', reads: 1, observers: 1, observing: 1 },
    { width: '200', reads: 2, observers: 1, observing: 1 },
    { width: '200', reads: 2, observers: 1, observing: 0 },
    { width: '220', reads: 3, observers: 2, observing: 1 },
    { width: '220', reads: 3, observers: 2, observing: 0 }
  ])
})
