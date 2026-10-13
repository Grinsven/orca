import { afterEach, describe, expect, it, vi } from 'vitest'
import { isMissingOwnershipMethod, resolveOwnershipTarget } from './window-ownership-client'

afterEach(() => vi.unstubAllGlobals())

describe('resolveOwnershipTarget', () => {
  it('takes no part without the fork preload (web client)', () => {
    vi.stubGlobal('window', {})
    expect(resolveOwnershipTarget({ activeRuntimeEnvironmentId: 'env' })).toBeNull()
  })

  it('owns through the local runtime in the host window, whatever environment it shows', () => {
    vi.stubGlobal('window', { joseWindow: { isSecondWindow: false } })
    expect(resolveOwnershipTarget({ activeRuntimeEnvironmentId: 'env' })).toEqual({
      kind: 'local'
    })
  })

  it('owns through the paired host in a second window, and waits for its settings', () => {
    vi.stubGlobal('window', { joseWindow: { isSecondWindow: true } })
    expect(resolveOwnershipTarget({ activeRuntimeEnvironmentId: 'host-env' })).toEqual({
      kind: 'environment',
      environmentId: 'host-env'
    })
    expect(resolveOwnershipTarget(null)).toBeNull()
  })
})

describe('isMissingOwnershipMethod', () => {
  it('recognises an older host refusing the method', () => {
    expect(isMissingOwnershipMethod({ code: 'method_not_found', message: 'Unknown method' })).toBe(
      true
    )
    expect(isMissingOwnershipMethod({ code: 'runtime_unavailable', message: 'down' })).toBe(false)
  })
})
