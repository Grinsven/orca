import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { focus: vi.fn(), isReady: vi.fn() } }))

import type { BrowserWindow } from 'electron'
import type { FocusExistingMainWindowOptions } from '../window/focus-existing-window'
import { raiseOwnWindow } from './raise-own-window'

function fakeWindow(focused: boolean) {
  const window = {
    isDestroyed: vi.fn(() => false),
    isFocused: vi.fn(() => focused),
    moveTop: vi.fn()
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: raiseOwnWindow reads only these three members.
  return { window, browserWindow: window as unknown as BrowserWindow }
}

function deps(backgroundLaunch: boolean) {
  return {
    app: { focus: vi.fn(), isReady: () => true },
    isBackgroundLaunch: () => backgroundLaunch,
    focusExisting: vi.fn((_options: FocusExistingMainWindowOptions) => 'focused' as const)
  }
}

describe('raiseOwnWindow', () => {
  it('raises through the shared second-instance focus path, never opening a window', () => {
    const { browserWindow } = fakeWindow(true)
    const d = deps(false)
    expect(raiseOwnWindow(browserWindow, d)).toBe('raised')
    const options = d.focusExisting.mock.calls[0]?.[0]
    expect({
      window: options?.getWindow(),
      canOpen: options?.canOpenWindow?.(),
      app: options?.app
    }).toEqual({ window: browserWindow, canOpen: false, app: d.app })
  })

  it('falls back to moveTop when macOS leaves the window unfocused', () => {
    const { window, browserWindow } = fakeWindow(false)
    raiseOwnWindow(browserWindow, deps(false))
    expect(window.moveTop).toHaveBeenCalled()
  })

  it('does nothing on a background launch', () => {
    const { window, browserWindow } = fakeWindow(false)
    const d = deps(true)
    expect(raiseOwnWindow(browserWindow, d)).toBe('background-launch')
    expect(d.focusExisting).not.toHaveBeenCalled()
    expect(window.moveTop).not.toHaveBeenCalled()
  })

  it('reports a missing or destroyed window', () => {
    expect(raiseOwnWindow(null, deps(false))).toBe('no-window')
    const { window, browserWindow } = fakeWindow(true)
    window.isDestroyed.mockReturnValue(true)
    expect(raiseOwnWindow(browserWindow, deps(false))).toBe('no-window')
  })
})
