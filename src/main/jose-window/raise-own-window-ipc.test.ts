import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { focus: vi.fn() }, BrowserWindow: {}, ipcMain: {} }))

import type { BrowserWindow } from 'electron'
import { raiseOwnWindow } from './raise-own-window-ipc'

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
    app: { focus: vi.fn() },
    isBackgroundLaunch: () => backgroundLaunch,
    reveal: vi.fn()
  }
}

describe('raiseOwnWindow', () => {
  it('takes the foreground from the other Orca process and reveals this window', () => {
    const { window, browserWindow } = fakeWindow(true)
    const d = deps(false)
    expect(raiseOwnWindow(browserWindow, d)).toBe('raised')
    expect(d.app.focus).toHaveBeenCalledWith({ steal: true })
    expect(d.reveal).toHaveBeenCalledWith(browserWindow)
    expect(window.moveTop).not.toHaveBeenCalled()
  })

  it('falls back to moveTop when macOS leaves the window unfocused', () => {
    const { window, browserWindow } = fakeWindow(false)
    const d = deps(false)
    d.app.focus.mockImplementationOnce(() => {
      throw new Error('steal unsupported')
    })
    expect(raiseOwnWindow(browserWindow, d)).toBe('raised')
    expect(d.app.focus).toHaveBeenLastCalledWith()
    expect(window.moveTop).toHaveBeenCalled()
  })

  it('does nothing on a background launch', () => {
    const { window, browserWindow } = fakeWindow(false)
    const d = deps(true)
    expect(raiseOwnWindow(browserWindow, d)).toBe('background-launch')
    expect(d.app.focus).not.toHaveBeenCalled()
    expect(d.reveal).not.toHaveBeenCalled()
    expect(window.moveTop).not.toHaveBeenCalled()
  })

  it('reports a missing or destroyed window', () => {
    expect(raiseOwnWindow(null, deps(false))).toBe('no-window')
    const { window, browserWindow } = fakeWindow(true)
    window.isDestroyed.mockReturnValue(true)
    expect(raiseOwnWindow(browserWindow, deps(false))).toBe('no-window')
  })
})
