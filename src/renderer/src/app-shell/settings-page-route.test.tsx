// @vitest-environment happy-dom

import { Component, StrictMode, Suspense, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecoverableRenderErrorBoundary } from '../components/error-boundaries/RecoverableRenderErrorBoundary'
import { createSettingsPageRoute } from './settings-page-route'

function ReadySettings(): React.JSX.Element {
  return <div>Settings ready</div>
}

class Boundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error)
  }

  render(): ReactNode {
    return this.state.failed ? <div role="alert">Failed</div> : this.props.children
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Settings page loading', () => {
  it('renders resolved content without entering the surrounding Suspense fallback', async () => {
    const request = Promise.withResolvers<{ default: typeof ReadySettings }>()
    const load = vi.fn(() => request.promise)
    const Route = createSettingsPageRoute(load)
    const beforeMount = load.mock.calls.length
    render(
      <Suspense fallback={<div>Suspended</div>}>
        <Route />
      </Suspense>
    )
    const pending = screen.queryByText('Suspended') !== null
    await act(async () => request.resolve({ default: ReadySettings }))

    expect({
      beforeMount,
      pending,
      calls: load.mock.calls.length,
      ready: screen.queryByText('Settings ready') !== null,
      suspended: screen.queryByText('Suspended') !== null
    }).toEqual({ beforeMount: 0, pending: false, calls: 1, ready: true, suspended: false })
  })

  it('shares an outstanding load through Strict Mode effect restarts', async () => {
    const request = Promise.withResolvers<{ default: typeof ReadySettings }>()
    const load = vi.fn(() => request.promise)
    const Route = createSettingsPageRoute(load)
    render(
      <StrictMode>
        <Route />
        <Route />
      </StrictMode>
    )
    await act(async () => request.resolve({ default: ReadySettings }))

    expect({
      calls: load.mock.calls.length,
      pages: screen.queryAllByText('Settings ready').length
    }).toEqual({ calls: 1, pages: 2 })
  })

  it('does not reopen an abandoned page when its load resolves', async () => {
    const request = Promise.withResolvers<{ default: typeof ReadySettings }>()
    const load = vi.fn(() => request.promise)
    const Route = createSettingsPageRoute(load)
    const first = render(<Route />)
    first.unmount()
    await act(async () => request.resolve({ default: ReadySettings }))
    const abandonedPageVisible = screen.queryByText('Settings ready') !== null
    render(<Route />)

    expect({
      abandonedPageVisible,
      calls: load.mock.calls.length,
      readyOnReturn: screen.queryByText('Settings ready') !== null
    }).toEqual({ abandonedPageVisible: false, calls: 1, readyOnReturn: true })
  })

  it('forwards the original load failure to the existing error boundary', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const request = Promise.withResolvers<{ default: typeof ReadySettings }>()
    const error = new Error('Settings chunk unavailable')
    const onError = vi.fn()
    const Route = createSettingsPageRoute(() => request.promise)
    render(
      <Boundary onError={onError}>
        <Route />
      </Boundary>
    )
    await act(async () => request.reject(error))

    expect({ failed: screen.queryByRole('alert') !== null, errors: onError.mock.calls }).toEqual({
      failed: true,
      errors: [[error]]
    })
  })

  it('allows a new load after a failed navigation', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const request = Promise.withResolvers<{ default: typeof ReadySettings }>()
    const load = vi.fn(() => request.promise)
    const Route = createSettingsPageRoute(load)
    const first = render(
      <Boundary onError={() => {}}>
        <Route />
      </Boundary>
    )
    await act(async () => request.reject(new Error('First load failed')))
    first.unmount()
    load.mockResolvedValue({ default: ReadySettings })
    await act(async () => {
      render(<Route />)
    })

    expect({
      calls: load.mock.calls.length,
      ready: screen.queryByText('Settings ready') !== null
    }).toEqual({ calls: 2, ready: true })
  })

  it('retries through the application boundary without navigating away', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const load = vi
      .fn<() => Promise<{ default: typeof ReadySettings }>>()
      .mockRejectedValueOnce(new Error('First load failed'))
      .mockResolvedValue({ default: ReadySettings })
    const Route = createSettingsPageRoute(load)
    await act(async () => {
      render(
        <RecoverableRenderErrorBoundary
          boundaryId="page.settings"
          surface="page"
          reportAsCrash={false}
        >
          <Route />
        </RecoverableRenderErrorBoundary>
      )
    })
    const failedBeforeRetry = screen.queryByRole('alert') !== null
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })))

    expect({
      failedBeforeRetry,
      calls: load.mock.calls.length,
      failedAfterRetry: screen.queryByRole('alert') !== null,
      ready: screen.queryByText('Settings ready') !== null
    }).toEqual({ failedBeforeRetry: true, calls: 2, failedAfterRetry: false, ready: true })
  })

  it('reuses an unfinished load when navigation returns before it resolves', async () => {
    const request = Promise.withResolvers<{ default: typeof ReadySettings }>()
    const load = vi.fn(() => request.promise)
    const Route = createSettingsPageRoute(load)
    render(<Route />).unmount()
    render(<Route />)
    await act(async () => request.resolve({ default: ReadySettings }))

    expect({
      calls: load.mock.calls.length,
      pages: screen.queryAllByText('Settings ready').length
    }).toEqual({ calls: 1, pages: 1 })
  })
})
