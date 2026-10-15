// Fork policy: give an inactive window three minutes before discarding warm caches.
export const IDLE_MEMORY_RELEASE_DELAY_MS = 3 * 60_000

/** One release permit per continuous native-window idle period. */
export function createIdleReleaseTimer(options: {
  isFocused: () => boolean
  requestRelease: (permit: number) => void
  delayMs?: number
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let pendingPermit: number | undefined
  let released = false
  let disposed = false

  function cancel(): void {
    clearTimeout(timer)
    timer = undefined
    pendingPermit = undefined
    generation += 1
  }

  function update(): void {
    if (disposed) {
      return
    }
    if (options.isFocused()) {
      cancel()
      released = false
      return
    }
    if (timer !== undefined || released) {
      return
    }
    const scheduledGeneration = generation
    timer = setTimeout(() => {
      timer = undefined
      if (disposed || scheduledGeneration !== generation || options.isFocused()) {
        return
      }
      released = true
      pendingPermit = ++generation
      options.requestRelease(pendingPermit)
    }, options.delayMs ?? IDLE_MEMORY_RELEASE_DELAY_MS)
  }

  function claim(permit: number): boolean {
    if (disposed || permit !== pendingPermit || options.isFocused()) {
      return false
    }
    pendingPermit = undefined
    return true
  }

  function dispose(): void {
    disposed = true
    cancel()
  }

  function ready(): void {
    update()
    if (pendingPermit !== undefined) {
      options.requestRelease(pendingPermit)
    }
  }

  return { update, claim, dispose, ready }
}
