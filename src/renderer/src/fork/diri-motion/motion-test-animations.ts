import { vi } from 'vitest'

/** One `element.animate` call as a test sees it; step `currentTime` and call `finish()`. */
export type RecordedAnimation = {
  element: Element
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  currentTime: number
  cancelled: boolean
  finish: () => void
}

/** Replaces `element.animate` (absent in happy-dom) with a recorder. */
export function recordElementAnimations(): RecordedAnimation[] {
  const recorded: RecordedAnimation[] = []
  vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(function animate(
    this: HTMLElement,
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions
  ) {
    const listeners = new Map<string, (() => void)[]>()
    const entry: RecordedAnimation = {
      element: this,
      keyframes: Array.isArray(keyframes) ? keyframes : [],
      options: typeof options === 'object' ? options : { duration: options },
      currentTime: 0,
      cancelled: false,
      finish: () => {
        listeners.get('finish')?.forEach((listener) => listener())
        animation.onfinish?.()
      }
    }
    recorded.push(entry)
    const animation: { onfinish: (() => void) | null } & Record<string, unknown> = {
      onfinish: null,
      get currentTime() {
        return entry.currentTime
      },
      cancel: () => {
        entry.cancelled = true
        listeners.get('cancel')?.forEach((listener) => listener())
      },
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener])
      }
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the code under test uses only currentTime, cancel, onfinish and addEventListener, which this stand-in implements.
    return animation as unknown as Animation
  })
  return recorded
}

/** Answers `prefers-reduced-motion` the way the test needs. */
export function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  )
}
