// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { useAppStore } from '../store'

type ColorsListener = (colors: { foreground?: string; background?: string }) => void

const mocks = vi.hoisted(() => {
  const state: { publish: ColorsListener | null } = { publish: null }
  return state
})

vi.mock('../components/terminal-pane/terminal-view-attributes-publisher', () => ({
  subscribeToPublishedTerminalViewColors: (listener: ColorsListener) => {
    mocks.publish = listener
    return () => {
      mocks.publish = null
    }
  }
}))

import { useModernUiAppearance } from './use-modern-ui-appearance'

const initialState = useAppStore.getState()
const root = document.documentElement

function updateSettings(updates: Partial<GlobalSettings>): void {
  act(() => {
    const settings = useAppStore.getState().settings!
    useAppStore.setState({ settings: { ...settings, ...updates } })
  })
}

describe('useModernUiAppearance', () => {
  beforeEach(() => {
    for (const name of Object.keys(root.dataset)) {
      delete root.dataset[name]
    }
    root.removeAttribute('style')
    window.localStorage.clear()
    useAppStore.setState({ settings: getDefaultSettings('/tmp') })
  })

  afterEach(() => {
    useAppStore.setState(initialState, true)
  })

  it('applies the default Modern UI attributes once settings are loaded', () => {
    const { unmount } = renderHook(() => useModernUiAppearance())

    expect(root.dataset.modernUi).toBe('on')
    expect(root.dataset.modernUiTabs).toBe('connected')
    expect(root.dataset.modernUiDensity).toBe('default')
    expect(root.dataset.modernUiGlass).toBe('on')
    expect(root.dataset.modernUiUppercase).toBeUndefined()
    expect(root.style.getPropertyValue('--modern-ui-glass-opacity')).toBe('80%')
    unmount()
  })

  it('follows each setting change and clears everything when switched off', () => {
    const { unmount } = renderHook(() => useModernUiAppearance())

    updateSettings({
      modernUiTabStyle: 'pill',
      modernUiDensity: 'compact',
      modernUiUppercaseHeaders: true,
      modernUiFrostedGlassOpacity: 60
    })
    expect(root.dataset.modernUiTabs).toBe('pill')
    expect(root.dataset.modernUiDensity).toBe('compact')
    expect(root.dataset.modernUiUppercase).toBe('on')
    expect(root.style.getPropertyValue('--modern-ui-glass-opacity')).toBe('60%')

    updateSettings({ modernUiFrostedGlass: false })
    expect(root.dataset.modernUiGlass).toBeUndefined()

    updateSettings({ modernUi: false })
    expect(root.dataset.modernUi).toBeUndefined()
    expect(root.dataset.modernUiTabs).toBeUndefined()
    expect(root.dataset.modernUiDensity).toBeUndefined()
    expect(root.dataset.modernUiUppercase).toBeUndefined()
    expect(root.style.getPropertyValue('--modern-ui-glass-opacity')).toBe('')
    unmount()
  })

  it('leaves the boot attributes alone until settings hydrate', () => {
    useAppStore.setState({ settings: null })
    root.dataset.modernUi = 'on'
    const { unmount } = renderHook(() => useModernUiAppearance())

    expect(root.dataset.modernUi).toBe('on')
    expect(root.dataset.modernUiTabs).toBeUndefined()
    unmount()
  })

  it('caches the applied settings for the next boot', () => {
    const { unmount } = renderHook(() => useModernUiAppearance())
    updateSettings({ modernUiTabStyle: 'pill' })

    expect(JSON.parse(window.localStorage.getItem('orca-modern-ui-settings')!)).toMatchObject({
      modernUi: true,
      modernUiTabStyle: 'pill'
    })
    unmount()
  })

  it('publishes the terminal background for connected terminal tabs', () => {
    const { unmount } = renderHook(() => useModernUiAppearance())

    act(() => mocks.publish?.({ foreground: '#eeeeee', background: '#123456' }))

    expect(root.style.getPropertyValue('--modern-ui-terminal-background')).toBe('#123456')
    unmount()
    expect(mocks.publish).toBeNull()
  })
})
