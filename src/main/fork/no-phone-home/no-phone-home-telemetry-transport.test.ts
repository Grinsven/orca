import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Why hoisted: client.ts reads the build identity and write key once, at import.
const { postHogConstructor } = vi.hoisted(() => {
  vi.stubGlobal('ORCA_BUILD_IDENTITY', 'stable')
  vi.stubGlobal('ORCA_POSTHOG_WRITE_KEY', 'phc_fork_test_key')
  return { postHogConstructor: vi.fn() }
})

vi.mock('posthog-node', () => ({ PostHog: postHogConstructor }))
vi.mock('../../../shared/app-environment', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAppEnvironment: () => ({ getVersion: () => '1.4.0-fork-test' })
}))

import { initTelemetry, isTelemetryEnabled, track } from '../../telemetry/client'
import { BASE_COMMON, makeFakeSettings, makeFakeStore } from '../../telemetry/client-test-harness'

describe('usage telemetry in a build that carries a PostHog key', () => {
  beforeEach(() => {
    postHogConstructor.mockClear()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('never builds a PostHog client, even for an opted-in profile', () => {
    const store = makeFakeStore(
      makeFakeSettings({
        optedIn: true,
        installId: BASE_COMMON.install_id,
        existedBeforeTelemetryRelease: false
      })
    )

    initTelemetry(store)

    expect(postHogConstructor).not.toHaveBeenCalled()
    expect(isTelemetryEnabled()).toBe(false)
    expect(track('telemetry_opted_in', { via: 'settings' })).toBe(false)
  })
})
