import { isDeepStrictEqual } from 'node:util'
import {
  parseBindingSection,
  parsePlatformOverrides
} from '../src/main/keybindings/keybinding-file-parser'
import type { KeybindingFileDiagnostic } from '../src/shared/keybindings'
import { record, type PreferenceRecord } from './settings-policy'

export function projectKeybindings(value: unknown): PreferenceRecord {
  const input = record(value)
  const diagnostics: KeybindingFileDiagnostic[] = []
  const keybindings =
    input.keybindings === undefined
      ? parseBindingSection(input, 'root', diagnostics, { skipRootKeys: true })
      : parseBindingSection(input.keybindings, 'keybindings', diagnostics)
  const platforms = parsePlatformOverrides(input, diagnostics)
  if (diagnostics.some((entry) => entry.severity === 'error')) {
    throw new Error('Keybindings contain invalid shortcut definitions')
  }
  return { version: 1, keybindings, platforms }
}

export function assertPortableKeybindings(value: unknown): void {
  if (!isDeepStrictEqual(projectKeybindings(value), value)) {
    throw new Error('Snapshot contains unsupported keybinding fields')
  }
}
