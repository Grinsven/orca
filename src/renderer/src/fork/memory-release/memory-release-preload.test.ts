import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
  webFrame: { clearCache: vi.fn() },
  contextBridge: { exposeInMainWorld: vi.fn() }
}))
vi.mock('electron', () => electron)
vi.mock('../../../../preload/e2e-config', () => ({ preloadE2EConfig: { exposeStore: false } }))
import { exposeMemoryReleaseBridge } from './memory-release-preload'
import { MEMORY_RELEASE_ACTIVITY } from './memory-release-contract'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', { hidden: false, hasFocus: () => false })
  electron.ipcRenderer.invoke.mockResolvedValue({ allowed: true, visible: true })
  exposeMemoryReleaseBridge()
})
afterEach(() => vi.unstubAllGlobals())

describe('preload memory release', () => {
  it('purges a blurred window after native permission', async () => {
    const result = await window.joseMemoryRelease!.release(1)
    expect([result, electron.webFrame.clearCache.mock.calls.length]).toEqual([true, 1])
  })

  it('does not purge when main rejects a stale permit', async () => {
    electron.ipcRenderer.invoke.mockResolvedValue({ allowed: false, visible: true })
    const result = await window.joseMemoryRelease!.release(1)
    expect([result, electron.webFrame.clearCache.mock.calls.length]).toEqual([false, 0])
  })

  it('cancels when focus returns during the permission round trip', async () => {
    electron.ipcRenderer.invoke.mockImplementation(async () => {
      vi.stubGlobal('document', { hidden: false, hasFocus: () => true })
      return { allowed: true, visible: true }
    })
    const result = await window.joseMemoryRelease!.release(1)
    expect([result, electron.webFrame.clearCache.mock.calls.length]).toEqual([false, 0])
  })

  it('releases a hidden document even if it retains element focus', async () => {
    vi.stubGlobal('document', { hidden: false, hasFocus: () => true })
    electron.ipcRenderer.invoke.mockResolvedValue({ allowed: true, visible: false })
    const result = await window.joseMemoryRelease!.release(1)
    expect([result, electron.webFrame.clearCache.mock.calls.length]).toEqual([true, 1])
  })

  it('keeps shortened timing unavailable outside isolated E2E builds', () => {
    expect(window.joseMemoryRelease?.configureTest).toBeUndefined()
  })

  it('rejects a hidden-window permit when native focus returns during the reply', async () => {
    const onActivity = electron.ipcRenderer.on.mock.calls.find(
      ([channel]) => channel === MEMORY_RELEASE_ACTIVITY
    )?.[1]
    electron.ipcRenderer.invoke.mockImplementation(async () => {
      onActivity()
      return { allowed: true, visible: false }
    })
    const result = await window.joseMemoryRelease!.release(1)
    expect([result, electron.webFrame.clearCache.mock.calls.length]).toEqual([false, 0])
  })
})
