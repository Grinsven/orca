import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdleReleaseTimer, IDLE_MEMORY_RELEASE_DELAY_MS } from './idle-release-timer'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function fixture(initiallyFocused = true) {
  let focused = initiallyFocused
  const requests: number[] = []
  const timer = createIdleReleaseTimer({
    isFocused: () => focused,
    requestRelease: (permit) => requests.push(permit)
  })
  const focus = (next: boolean): void => {
    focused = next
    timer.update()
  }
  timer.update()
  return {
    timer,
    requests,
    focus,
    setNativeFocus: (next: boolean) => {
      focused = next
    }
  }
}

describe('idle renderer memory release', () => {
  it('waits three minutes after blur', () => {
    const f = fixture()
    f.focus(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS - 1)
    const beforeDeadline = [...f.requests]
    vi.advanceTimersByTime(1)
    expect([beforeDeadline.length, f.requests.length]).toEqual([0, 1])
  })

  it('arms an initially hidden unfocused window', () => {
    const f = fixture(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    expect(f.requests).toHaveLength(1)
  })

  it('does not postpone a blur deadline when the window is also hidden', () => {
    const f = fixture()
    f.focus(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS / 2)
    f.timer.update()
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS / 2)
    expect(f.requests).toHaveLength(1)
  })

  it('cancels the pending timer on refocus', () => {
    const f = fixture()
    f.focus(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS - 1)
    f.focus(true)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    expect(f.requests).toHaveLength(0)
  })

  it('releases once per idle period and rearms after refocus', () => {
    const f = fixture(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    f.timer.update()
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS * 4)
    const firstPeriod = f.requests.length
    f.focus(true)
    f.focus(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    expect([firstPeriod, f.requests.length]).toEqual([1, 2])
  })

  it('never schedules a focused window', () => {
    const f = fixture()
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS * 10)
    expect(f.requests).toHaveLength(0)
  })

  it('checks native focus again even before the focus event arrives', () => {
    const f = fixture(false)
    f.setNativeFocus(true)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    expect(f.requests).toHaveLength(0)
  })

  it('invalidates an in-flight permission on refocus', () => {
    const f = fixture(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    f.focus(true)
    f.focus(false)
    expect(f.timer.claim(f.requests[0])).toBe(false)
  })

  it('rechecks native focus when claiming permission after the async memory read', () => {
    const f = fixture(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    f.setNativeFocus(true)
    expect(f.timer.claim(f.requests[0])).toBe(false)
  })

  it('only accepts a permit once', () => {
    const f = fixture(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    const permit = f.requests[0]
    expect([f.timer.claim(permit + 1), f.timer.claim(permit), f.timer.claim(permit)]).toEqual([
      false,
      true,
      false
    ])
  })

  it('cancels timers and permissions on window destruction', () => {
    const f = fixture(false)
    f.timer.dispose()
    f.timer.update()
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    expect(f.requests).toHaveLength(0)
  })

  it('redelivers an unclaimed request after renderer reload without allowing two purges', () => {
    const f = fixture(false)
    vi.advanceTimersByTime(IDLE_MEMORY_RELEASE_DELAY_MS)
    f.timer.ready()
    const claims = f.requests.map((permit) => f.timer.claim(permit))
    f.timer.ready()
    expect({ requests: f.requests.length, claims }).toEqual({ requests: 2, claims: [true, false] })
  })
})
