import { describe, expect, it, vi } from 'vitest'
import { getDefaultUIState } from '../../../shared/constants'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { turnOffStarNag } from './star-nag-off'

function fakeStore(ui: Partial<PersistedState['ui']>) {
  const state: { ui: PersistedState['ui'] } = { ui: { ...getDefaultUIState(), ...ui } }
  return {
    getUI: () => state.ui,
    updateUI: vi.fn((patch: Partial<PersistedState['ui']>) => {
      state.ui = { ...state.ui, ...patch }
    })
  }
}

describe('turnOffStarNag', () => {
  it('marks the star prompt done and clears a pending deferral', () => {
    const store = fakeStore({ starNagCompleted: false, starNagDeferredUntil: 123 })
    turnOffStarNag(store)
    expect(store.updateUI).toHaveBeenCalledWith({
      starNagCompleted: true,
      starNagDeferredUntil: null
    })
    expect(store.getUI().starNagCompleted).toBe(true)
  })

  it('writes nothing once the prompt is already done', () => {
    const store = fakeStore({ starNagCompleted: true })
    turnOffStarNag(store)
    expect(store.updateUI).not.toHaveBeenCalled()
  })
})
