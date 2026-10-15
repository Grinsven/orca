import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  applySettings,
  defaultSnapshot,
  exportSettings,
  validateSnapshot
} from './settings-transfer'
import { profileLocation, readProfile, scratchRoot, writeJson } from './settings-profile'
import { record } from './settings-policy'

test('every required preference and all three complete palettes survive export and apply', () => {
  mkdirSync(scratchRoot, { recursive: true })
  const root = mkdtempSync(join(scratchRoot, 'settings-palette-'))
  try {
    const source = validateSnapshot(JSON.parse(readFileSync(defaultSnapshot, 'utf8')))
    const keys = [
      'terminalCustomThemes',
      'terminalThemeDark',
      'terminalThemeLight',
      'terminalUseSeparateLightTheme',
      'terminalDividerColorDark',
      'terminalDividerColorLight',
      'leftSidebarTintColor',
      'theme',
      'appFontFamily',
      'editorFontFamily',
      'terminalFontFamily',
      'terminalFontSize',
      'terminalFontWeight',
      'terminalFontWeightBold',
      'terminalLineHeight',
      'terminalScrollbackRows',
      'terminalQuickCommands',
      ...Object.keys(source.settings).filter(
        (key) => key.startsWith('modernUi') || key.startsWith('terminalCursor')
      )
    ]
    const select = (value: unknown) =>
      Object.fromEntries(keys.map((key) => [key, record(value)[key]]))
    const options = {
      home: join(root, 'source'),
      snapshot: join(root, 'export.json'),
      profileId: 'local-default',
      dryRun: false
    }
    writeJson(profileLocation(options.home, options.profileId).dataFile, {
      settings: source.settings,
      ui: source.ui
    })
    writeJson(join(options.home, '.orca/keybindings.json'), source.keybindings)
    exportSettings(options)
    const exported = validateSnapshot(JSON.parse(readFileSync(options.snapshot, 'utf8')))
    const target = { ...options, home: join(root, 'target') }
    applySettings(target)
    const applied = record(
      readProfile(profileLocation(target.home, target.profileId)).root.settings
    )
    const themes = Array.isArray(applied.terminalCustomThemes) ? applied.terminalCustomThemes : []
    assert.deepEqual(
      {
        missing: keys.filter((key) => !(key in source.settings)),
        exported: select(exported.settings),
        applied: select(applied),
        themeIds: themes.map((theme) => record(theme).id),
        selected: applied.terminalThemeDark
      },
      {
        missing: [],
        exported: select(source.settings),
        applied: select(source.settings),
        themeIds: ['manual:jose-oled', 'manual:jose-gray', 'manual:jose-vscode'],
        selected: 'custom:manual:jose-vscode'
      }
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
