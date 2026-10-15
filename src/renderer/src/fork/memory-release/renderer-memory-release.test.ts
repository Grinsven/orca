import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ sample: vi.fn(), breadcrumb: vi.fn() }))
vi.mock('../../lib/renderer-memory-sampling', () => ({ recordRendererMemorySample: mocks.sample }))
vi.mock('../../lib/crash-breadcrumb-recorder', () => ({
  recordRendererCrashBreadcrumb: mocks.breadcrumb
}))
import { installRendererMemoryRelease } from './renderer-memory-release'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function fixture(released = true) {
  let request: (permit: number) => void = () => {}
  const release = vi.fn(async () => released)
  const read = vi
    .fn()
    .mockResolvedValueOnce({ privateKB: 300_000 })
    .mockResolvedValue({ privateKB: 200_000 })
  vi.stubGlobal('window', {
    api: { crashReports: { readProcessMemory: read } },
    joseMemoryRelease: {
      readFootprint: read,
      onRequest: (callback: typeof request) => {
        request = callback
        return () => {}
      },
      release
    }
  })
  const dispose = installRendererMemoryRelease()
  return { request: () => request(1), release, read, dispose }
}

describe('idle release memory trace', () => {
  it('uses fresh private footprints on both sides of the purge', async () => {
    const f = fixture()
    f.request()
    await vi.advanceTimersByTimeAsync(1100)
    expect(mocks.sample.mock.calls).toEqual([
      ['idle-release-before', { privateKB: 300_000 }],
      ['idle-release-after', { privateKB: 200_000 }]
    ])
    f.dispose()
  })

  it('records a skipped request without claiming a purge happened', async () => {
    const f = fixture(false)
    f.request()
    await vi.advanceTimersByTimeAsync(1100)
    expect(mocks.sample.mock.calls.map(([reason]) => reason)).toEqual([
      'idle-release-before',
      'idle-release-skipped'
    ])
    f.dispose()
  })

  it('does not release after disposal during the before sample', async () => {
    const f = fixture()
    f.request()
    f.dispose()
    await vi.advanceTimersByTimeAsync(1100)
    expect(f.release).not.toHaveBeenCalled()
  })
})
