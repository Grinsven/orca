import { afterEach, describe, expect, it, vi } from 'vitest'
import { isSecondaryWindow } from './is-secondary-window'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isSecondaryWindow', () => {
  it('is true when the preload bridge reports a New Window slot', () => {
    vi.stubGlobal('window', { joseWindow: { isSecondWindow: true } })
    expect(isSecondaryWindow()).toBe(true)
  })

  it('is false for the host and for an ordinary paired desktop client', () => {
    vi.stubGlobal('window', { joseWindow: { isSecondWindow: false } })
    expect(isSecondaryWindow()).toBe(false)
  })

  it('is false without the bridge (web client, older preload)', () => {
    vi.stubGlobal('window', {})
    expect(isSecondaryWindow()).toBe(false)
  })
})
