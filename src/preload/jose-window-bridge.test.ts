import { afterEach, describe, expect, it, vi } from 'vitest'

const { exposeInMainWorld } = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }))
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke: vi.fn() }
}))

import { createJoseWindowApi, exposeJoseWindowApi } from './jose-window-bridge'

afterEach(() => {
  exposeInMainWorld.mockReset()
  vi.unstubAllGlobals()
})

describe('jose window preload bridge', () => {
  it('flags only a process whose pinned userData is a New Window slot', () => {
    const flag = (env: NodeJS.ProcessEnv): boolean => createJoseWindowApi(env).isSecondWindow
    expect(flag({ ORCA_USER_DATA_PATH: '/Users/me/AS/orca-window-2' })).toBe(true)
    expect(flag({ ORCA_USER_DATA_PATH: '/Users/me/AS/orca' })).toBe(false)
    expect(flag({ ORCA_USER_DATA_PATH: '/tmp/orca-e2e-paired-desktop-x1' })).toBe(false)
    expect(flag({})).toBe(false)
  })

  it('raise asks this process to raise its own window', async () => {
    const invoke = vi.fn(async () => 'raised' as const)
    await expect(createJoseWindowApi({}, invoke).raise()).resolves.toBe('raised')
    expect(invoke).toHaveBeenCalledWith('joseWindow:raise')
  })

  it('exposes the api as window.joseWindow through the context bridge', () => {
    const api = { isSecondWindow: true, raise: vi.fn() }
    Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
    try {
      exposeJoseWindowApi(api)
    } finally {
      Reflect.deleteProperty(process, 'contextIsolated')
    }
    expect(exposeInMainWorld).toHaveBeenCalledWith('joseWindow', api)
  })

  it('assigns window.joseWindow directly when context isolation is off', () => {
    const fakeWindow: { joseWindow?: unknown } = {}
    vi.stubGlobal('window', fakeWindow)
    const api = { isSecondWindow: false, raise: vi.fn() }
    exposeJoseWindowApi(api)
    expect(fakeWindow.joseWindow).toBe(api)
    expect(exposeInMainWorld).not.toHaveBeenCalled()
  })
})
