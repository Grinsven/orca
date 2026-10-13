import { afterEach, describe, expect, it, vi } from 'vitest'

const { exposeInMainWorld } = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld } }))

import { createJoseWindowApi, exposeJoseWindowApi } from './jose-window-bridge'

afterEach(() => {
  exposeInMainWorld.mockReset()
  vi.unstubAllGlobals()
})

describe('jose window preload bridge', () => {
  it('flags only a process whose pinned userData is a New Window slot', () => {
    expect(createJoseWindowApi({ ORCA_USER_DATA_PATH: '/Users/me/AS/orca-window-2' })).toEqual({
      isSecondWindow: true
    })
    expect(createJoseWindowApi({ ORCA_USER_DATA_PATH: '/Users/me/AS/orca' })).toEqual({
      isSecondWindow: false
    })
    expect(createJoseWindowApi({ ORCA_USER_DATA_PATH: '/tmp/orca-e2e-paired-desktop-x1' })).toEqual(
      { isSecondWindow: false }
    )
    expect(createJoseWindowApi({})).toEqual({ isSecondWindow: false })
  })

  it('exposes the flag as window.joseWindow through the context bridge', () => {
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
    try {
      exposeJoseWindowApi({ isSecondWindow: true })
    } finally {
      Reflect.deleteProperty(process, 'contextIsolated')
    }
    expect(exposeInMainWorld).toHaveBeenCalledWith('joseWindow', { isSecondWindow: true })
  })

  it('assigns window.joseWindow directly when context isolation is off', () => {
    const fakeWindow: { joseWindow?: unknown } = {}
    vi.stubGlobal('window', fakeWindow)
    exposeJoseWindowApi({ isSecondWindow: false })
    expect(fakeWindow.joseWindow).toEqual({ isSecondWindow: false })
    expect(exposeInMainWorld).not.toHaveBeenCalled()
  })
})
