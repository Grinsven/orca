import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { acquireProfileStateMaintenance } from '../src/main/persistence/profile-state/profile-state-access'
import { getUserKeybindingsPath } from '../src/main/keybindings/keybinding-file'
import { isJoseUiVariant } from '../src/shared/fork/jose-ui-variant'
import {
  assertPortablePreferences,
  mergePreferences,
  projectPreferences,
  record,
  type PreferenceRecord
} from './settings-policy'
import { assertPortableKeybindings, projectKeybindings } from './settings-keybindings'
import {
  applyProfile,
  backupFiles,
  mergedProfile,
  profileFiles,
  profileLocation,
  readProfile,
  writeJson
} from './settings-profile'
import { readLegacyVariant } from './settings-variant'

export type SettingsSnapshot = {
  version: 1
  settings: PreferenceRecord
  ui: PreferenceRecord
  keybindings: PreferenceRecord
}
export type TransferOptions = {
  home: string
  snapshot: string
  profileId: string
  dryRun: boolean
  variant?: string
}
export const defaultSnapshot = fileURLToPath(new URL('./files/orca-settings.json', import.meta.url))

function readJson(path: string): unknown {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
}

export function validateSnapshot(value: unknown): SettingsSnapshot {
  const input = record(value)
  if (
    input.version !== 1 ||
    Object.keys(input).some((key) => !['version', 'settings', 'ui', 'keybindings'].includes(key))
  ) {
    throw new Error('Unsupported settings snapshot')
  }
  assertPortablePreferences(input)
  assertPortableKeybindings(input.keybindings)
  return {
    version: 1,
    settings: record(input.settings),
    ui: record(input.ui),
    keybindings: record(input.keybindings)
  }
}

export function exportSettings(options: TransferOptions): void {
  const location = profileLocation(options.home, options.profileId)
  if (options.dryRun) {
    console.log(
      `Would read a private copy of ${dirname(location.dataFile)}, filter preferences, and write ${options.snapshot}`
    )
    return
  }
  const source = readProfile(location)
  const preferences = projectPreferences(source.root)
  const persistedVariant = record(source.root.settings).joseUiVariant
  preferences.settings.joseUiVariant =
    options.variant ??
    (isJoseUiVariant(persistedVariant) ? persistedVariant : readLegacyVariant(location.userData))
  const snapshot = validateSnapshot({
    version: 1,
    ...preferences,
    keybindings: projectKeybindings(readJson(getUserKeybindingsPath(options.home)))
  })
  if (existsSync(options.snapshot) && isDeepStrictEqual(readJson(options.snapshot), snapshot)) {
    console.log('Settings snapshot is unchanged.')
    return
  }
  if (existsSync(options.snapshot)) {
    backupFiles([options.snapshot], dirname(options.snapshot))
  }
  writeJson(options.snapshot, snapshot)
  console.log(
    `Exported ${Object.keys(snapshot.settings).length} settings, ${Object.keys(snapshot.ui).length} UI preferences, and validated keybindings to ${options.snapshot}`
  )
}

export function applySettings(options: TransferOptions): void {
  const snapshot = validateSnapshot(readJson(options.snapshot))
  const location = profileLocation(options.home, options.profileId)
  if (options.dryRun) {
    console.log(
      `Would acquire offline profile ownership, back up differing files, and merge preferences into ${dirname(location.dataFile)} and ${getUserKeybindingsPath(options.home)}`
    )
    return
  }
  const maintenance = acquireProfileStateMaintenance(location.userData)
  try {
    mkdirSync(dirname(location.dataFile), { recursive: true, mode: 0o700 })
    maintenance.assertProfile(location.profileId, location.dataFile, location.databaseFile)
    const source = readProfile(location)
    const merged = mergedProfile(source, snapshot)
    const keybindingsPath = getUserKeybindingsPath(options.home)
    const currentBindings = readJson(keybindingsPath)
    projectKeybindings(currentBindings)
    const bindings = mergePreferences(currentBindings, snapshot.keybindings)
    const profileChanged = !isDeepStrictEqual(source.root, merged)
    const bindingsChanged = !isDeepStrictEqual(currentBindings, bindings)
    if (!profileChanged && !bindingsChanged) {
      console.log('Settings are unchanged.')
      return
    }
    const backup = backupFiles(
      [...profileFiles(location), keybindingsPath],
      dirname(location.dataFile)
    )
    maintenance.assertActive()
    if (profileChanged) {
      applyProfile(location, source, merged)
    }
    if (bindingsChanged) {
      writeJson(keybindingsPath, bindings)
    }
    console.log(`Applied portable settings. Previous files: ${backup}`)
  } finally {
    maintenance.release()
  }
}

function main(args: string[]): void {
  const command = args.shift()
  if (command !== 'export' && command !== 'apply') {
    throw new Error(
      'Usage: settings-transfer.ts export|apply [--dry-run] [--home PATH] [--profile-id NAME] [--snapshot PATH] [--variant vscode|gray|oled]'
    )
  }
  const options: TransferOptions = {
    home: homedir(),
    snapshot: defaultSnapshot,
    profileId: 'local-default',
    dryRun: false
  }
  while (args.length) {
    const flag = args.shift()
    if (flag === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (!['--home', '--profile-id', '--snapshot', '--variant'].includes(flag ?? '')) {
      throw new Error('Unknown settings-transfer argument')
    }
    const value = args.shift()
    if (!value) {
      throw new Error('Missing settings-transfer argument value')
    }
    if (flag === '--home') {
      options.home = resolve(value)
    } else if (flag === '--snapshot') {
      options.snapshot = resolve(value)
    } else if (flag === '--profile-id') {
      options.profileId = value
    } else if (isJoseUiVariant(value)) {
      options.variant = value
    } else {
      throw new Error('Variant must be vscode, gray, or oled')
    }
  }
  if (command === 'export') {
    exportSettings(options)
  } else {
    applySettings(options)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Settings transfer failed')
    process.exitCode = 1
  }
}
