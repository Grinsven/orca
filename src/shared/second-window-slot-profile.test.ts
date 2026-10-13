import { describe, expect, it } from 'vitest'
import { isSecondWindowSlotUserDataPath } from './second-window-slot-profile'

describe('isSecondWindowSlotUserDataPath', () => {
  it('is true for New Window slot profiles on every path style', () => {
    expect(
      isSecondWindowSlotUserDataPath('/Users/me/Library/Application Support/orca-window-2')
    ).toBe(true)
    expect(
      isSecondWindowSlotUserDataPath('/Users/me/Library/Application Support/orca-dev-window-12/')
    ).toBe(true)
    expect(isSecondWindowSlotUserDataPath('C:\\Users\\me\\AppData\\Roaming\\orca-window-3')).toBe(
      true
    )
  })

  it('is false for the host profile, an ordinary paired client and a missing path', () => {
    expect(isSecondWindowSlotUserDataPath('/Users/me/Library/Application Support/orca')).toBe(false)
    expect(isSecondWindowSlotUserDataPath('/Users/me/Library/Application Support/orca-dev')).toBe(
      false
    )
    expect(isSecondWindowSlotUserDataPath('/tmp/orca-e2e-paired-desktop-Ab12Cd')).toBe(false)
    // Why: only the profile's own folder counts, not a slot-looking parent.
    expect(isSecondWindowSlotUserDataPath('/tmp/orca-window-2/nested')).toBe(false)
    expect(isSecondWindowSlotUserDataPath('/tmp/orca-window-two')).toBe(false)
    expect(isSecondWindowSlotUserDataPath('')).toBe(false)
    expect(isSecondWindowSlotUserDataPath(undefined)).toBe(false)
  })
})
