import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { preloadE2EConfig } from '../../../../preload/e2e-config'
import { readRendererProcessMemory } from '../../../../preload/renderer-process-memory-reader'
import {
  MEMORY_RELEASE_CLAIM,
  MEMORY_RELEASE_ACTIVITY,
  MEMORY_RELEASE_FOOTPRINT,
  MEMORY_RELEASE_READY,
  MEMORY_RELEASE_REQUEST,
  MEMORY_RELEASE_TEST_CONFIGURE,
  type MemoryReleaseBridge,
  type MemoryReleaseTestConfig
} from './memory-release-contract'

/** Kept in the sandboxed preload so only Electron can perform the purge. */
export function exposeMemoryReleaseBridge(): void {
  let electronMemoryAvailable = true
  let activityGeneration = 0
  ipcRenderer.on(MEMORY_RELEASE_ACTIVITY, () => {
    activityGeneration += 1
  })
  const bridge: MemoryReleaseBridge = {
    async readFootprint() {
      if (electronMemoryAvailable) {
        const memory = await readRendererProcessMemory()
        if (memory) {
          return { ...memory, source: 'electron' }
        }
        electronMemoryAvailable = false
      }
      const memory = await ipcRenderer.invoke(MEMORY_RELEASE_FOOTPRINT)
      return memory ? { ...memory, source: 'os' } : null
    },
    onRequest(callback) {
      const listener = (_event: Electron.IpcRendererEvent, permit: number): void => callback(permit)
      ipcRenderer.on(MEMORY_RELEASE_REQUEST, listener)
      ipcRenderer.send(MEMORY_RELEASE_READY)
      return () => ipcRenderer.removeListener(MEMORY_RELEASE_REQUEST, listener)
    },
    async release(permit) {
      const generation = activityGeneration
      const permission = await ipcRenderer.invoke(MEMORY_RELEASE_CLAIM, permit)
      // Catch a refocus delivered while the native permission reply was in flight.
      // Initially hidden windows can retain document focus before their first presentation.
      if (
        permission?.allowed !== true ||
        generation !== activityGeneration ||
        (permission.visible && !document.hidden && document.hasFocus())
      ) {
        return false
      }
      webFrame.clearCache()
      return true
    },
    ...(preloadE2EConfig.exposeStore && preloadE2EConfig.headless && preloadE2EConfig.userDataDir
      ? {
          configureTest: (config: MemoryReleaseTestConfig) =>
            ipcRenderer.invoke(MEMORY_RELEASE_TEST_CONFIGURE, config)
        }
      : {})
  }
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('joseMemoryRelease', bridge)
  } else {
    window.joseMemoryRelease = bridge
  }
}
