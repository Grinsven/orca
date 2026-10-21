import type { GlobalSettings } from '../../../../shared/global-settings-types'

type CursorSettings = Pick<GlobalSettings, 'terminalCursorGlide' | 'terminalCursorBlink'>

export function isCursorGlideEnabled(
  settings: Partial<CursorSettings> | null | undefined
): boolean {
  return settings?.terminalCursorGlide !== false
}

/** The calm blink replaces xterm's hard 600 ms blink when the setting asks for a blink. */
export function isCalmBlinkEnabled(settings: Partial<CursorSettings> | null | undefined): boolean {
  return isCursorGlideEnabled(settings) && (settings?.terminalCursorBlink ?? true)
}

/** xterm's own blink option: off while the calm blink owns the blink. */
export function resolveXtermCursorBlink(
  settings: Partial<CursorSettings> | null | undefined
): boolean {
  return (settings?.terminalCursorBlink ?? true) && !isCursorGlideEnabled(settings)
}
