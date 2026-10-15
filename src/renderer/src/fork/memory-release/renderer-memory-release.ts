import { recordRendererMemorySample } from '../../lib/renderer-memory-sampling'
import { recordRendererCrashBreadcrumb } from '../../lib/crash-breadcrumb-recorder'
import './memory-release-contract'

// Chromium pressure listeners reclaim asynchronously after clearCache returns.
const AFTER_RELEASE_SAMPLE_DELAY_MS = 1000

export function installRendererMemoryRelease(): () => void {
  const bridge = window.joseMemoryRelease
  if (!bridge) {
    return () => {}
  }
  let disposed = false
  let afterTimer: ReturnType<typeof setTimeout> | undefined

  async function sample(reason: string): Promise<void> {
    const footprint = await bridge!.readFootprint()
    if (!disposed) {
      recordRendererMemorySample(reason, footprint)
    }
  }

  function recordFailure(error: unknown): void {
    recordRendererCrashBreadcrumb('idle_memory_release_failed', { message: String(error) })
  }
  const unsubscribe = bridge.onRequest((permit) => {
    void (async () => {
      await sample('idle-release-before')
      if (disposed) {
        return
      }
      const released = await bridge.release(permit)
      if (disposed) {
        return
      }
      if (!released) {
        await sample('idle-release-skipped')
        return
      }
      afterTimer = setTimeout(() => {
        void sample('idle-release-after').catch(recordFailure)
      }, AFTER_RELEASE_SAMPLE_DELAY_MS)
    })().catch(recordFailure)
  })
  return () => {
    disposed = true
    clearTimeout(afterTimer)
    unsubscribe()
  }
}
