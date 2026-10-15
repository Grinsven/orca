import type { RendererProcessMemory } from '../../../../shared/renderer-process-memory'

export const MEMORY_RELEASE_REQUEST = 'jose:memory-release:request'
export const MEMORY_RELEASE_FOOTPRINT = 'jose:memory-release:footprint'
export const MEMORY_RELEASE_ACTIVITY = 'jose:memory-release:activity'
export const MEMORY_RELEASE_READY = 'jose:memory-release:ready'
export const MEMORY_RELEASE_CLAIM = 'jose:memory-release:claim'
export const MEMORY_RELEASE_TEST_CONFIGURE = 'jose:memory-release:test-configure'

export type MemoryReleaseTestConfig = { delayMs: number; disabled: boolean }

export type MemoryReleaseBridge = {
  readFootprint: () => Promise<(RendererProcessMemory & { source: 'electron' | 'os' }) | null>
  onRequest: (callback: (permit: number) => void) => () => void
  release: (permit: number) => Promise<boolean>
  configureTest?: (config: MemoryReleaseTestConfig) => Promise<void>
}

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- Declaration merging requires an interface.
  interface Window {
    joseMemoryRelease?: MemoryReleaseBridge
  }
}
