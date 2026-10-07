import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODERN_UI_SETTINGS } from '../../../shared/modern-ui-settings'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { updateSettings, type SettingsMutationOperations } from './settings-update'

function makeOperations(): SettingsMutationOperations {
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the fields updateSettings reads for these settings.
    state: { settings: { ...DEFAULT_MODERN_UI_SETTINGS }, repos: [] } as unknown as PersistedState,
    bumpLocalWorktreeScanGeneration: vi.fn(),
    removeRetainedBlob: vi.fn(),
    scheduleSave: vi.fn(),
    notifySettingsChanged: vi.fn()
  }
}

// Desktop IPC, the web RPC and the CLI all write through updateSettings, so coercion lives here.
describe('updateSettings Modern UI', () => {
  it('stores valid writes unchanged', () => {
    const operations = makeOperations()

    expect(
      updateSettings(operations, {
        modernUi: false,
        modernUiTabStyle: 'pill',
        modernUiDensity: 'compact',
        modernUiFrostedGlassOpacity: 90
      })
    ).toMatchObject({
      modernUi: false,
      modernUiTabStyle: 'pill',
      modernUiDensity: 'compact',
      modernUiFrostedGlassOpacity: 90
    })
  })

  it('clamps opacity and replaces unknown values from a hand-built client', () => {
    const operations = makeOperations()
    const write = {
      modernUiTabStyle: 'square',
      modernUiDensity: 'cozy',
      modernUiFrostedGlassOpacity: 10,
      modernUiUppercaseHeaders: 'yes'
    }

    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a hand-built client can send any JSON; the boundary must coerce it.
    const next = updateSettings(operations, write as unknown as Partial<GlobalSettings>)

    expect(next).toMatchObject({
      modernUiTabStyle: 'connected',
      modernUiDensity: 'default',
      modernUiFrostedGlassOpacity: 50,
      modernUiUppercaseHeaders: false
    })
  })

  it('leaves Modern UI keys alone when a write does not mention them', () => {
    const operations = makeOperations()
    updateSettings(operations, { modernUiTabStyle: 'pill' })

    expect(updateSettings(operations, { modernUiDensity: 'compact' })).toMatchObject({
      modernUiTabStyle: 'pill',
      modernUiDensity: 'compact',
      modernUi: true
    })
  })
})
