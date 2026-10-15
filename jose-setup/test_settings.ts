import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { acquireProfileStateRuntimeAdmission } from '../src/main/persistence/profile-state/profile-state-access'
import { migrateProfileStateToSqlite } from '../src/main/persistence/profile-state/profile-state-migration'
import { readProfileStateDomains } from '../src/main/persistence/profile-state/profile-state-domain-reader'
import { openWritableProfileStateDatabase } from '../src/main/persistence/profile-state/profile-state-database'
import { writeProfileStateDomain } from '../src/main/persistence/profile-state/profile-state-domain-writes'
import { applyModernUiAppearance } from '../src/renderer/src/lib/modern-ui-appearance'
import { normalizeModernUiSettings } from '../src/shared/modern-ui-settings'
import {
  applySettings,
  exportSettings,
  validateSnapshot,
  type TransferOptions
} from './settings-transfer'
import { profileLocation, readProfile, scratchRoot, writeJson } from './settings-profile'
import { record } from './settings-policy'
import { readLegacyVariant } from './settings-variant'

mkdirSync(scratchRoot, { recursive: true })
const root = mkdtempSync(join(scratchRoot, 'settings-tests-'))
after(() => rmSync(root, { recursive: true, force: true }))

function fixture(name: string): TransferOptions {
  return {
    home: join(root, name),
    snapshot: join(root, `${name}.json`),
    profileId: 'local-default',
    dryRun: false
  }
}

function snapshot(options: TransferOptions): void {
  writeJson(options.snapshot, {
    version: 1,
    settings: {
      theme: 'dark',
      appFontFamily: 'Geist',
      joseUiVariant: 'oled',
      modernUiTabStyle: 'connected',
      nativeChatAppearance: { fontSize: 16 }
    },
    ui: { uiZoomLevel: 0.5, sidebarWidth: 280, statusBarVisible: true },
    keybindings: {
      version: 1,
      keybindings: {},
      platforms: { darwin: { 'tab.nextAllTypes': ['Cmd+Shift+BracketRight'] } }
    }
  })
}

function files(directory: string): Record<string, string> {
  if (!existsSync(directory)) {
    return {}
  }
  return Object.fromEntries(
    readdirSync(directory, { recursive: true }).flatMap((name) => {
      const path = join(directory, name.toString())
      const stat = statSync(path)
      return stat.isFile()
        ? [
            [
              name.toString(),
              `${stat.mtimeMs}:${createHash('sha256').update(readFileSync(path)).digest('hex')}`
            ]
          ]
        : []
    })
  )
}

test('export contains preferences and canonical bindings without private state', () => {
  const options = fixture('export')
  const location = profileLocation(options.home, options.profileId)
  writeJson(location.dataFile, {
    settings: {
      theme: 'dark',
      terminalFontFamily: 'Menlo',
      modernUiTabStyle: 'connected',
      agentDefaultEnv: { API_KEY: 'PRIVATE_CANARY' },
      httpProxyUrl: 'PRIVATE_CANARY',
      machineName: 'PRIVATE_CANARY',
      terminalColorOverrides: { background: '#010203', extra: 'PRIVATE_CANARY' }
    },
    ui: {
      uiZoomLevel: 0.75,
      sidebarWidth: 300,
      browserKagiSessionLink: 'PRIVATE_CANARY',
      lastActiveRepoId: 'PRIVATE_CANARY'
    },
    repos: ['PRIVATE_CANARY'],
    sshTargets: ['PRIVATE_CANARY']
  })
  writeJson(join(options.home, '.orca', 'keybindings.json'), {
    version: 1,
    keybindings: {},
    platforms: {},
    private: 'PRIVATE_CANARY'
  })
  exportSettings(options)
  const exported = validateSnapshot(JSON.parse(readFileSync(options.snapshot, 'utf8')))
  assert.deepEqual(
    {
      canary: readFileSync(options.snapshot, 'utf8').includes('PRIVATE_CANARY'),
      settings: exported.settings,
      ui: exported.ui
    },
    {
      canary: false,
      settings: {
        theme: 'dark',
        terminalFontFamily: 'Menlo',
        modernUiTabStyle: 'connected',
        terminalColorOverrides: { background: '#010203' },
        joseUiVariant: 'vscode'
      },
      ui: { uiZoomLevel: 0.75, sidebarWidth: 300 }
    }
  )
})

test('snapshot rejects private values and unknown fields before apply', () => {
  assert.throws(
    () =>
      validateSnapshot({
        version: 1,
        settings: { agentDefaultEnv: { TOKEN: 'private' } },
        ui: {},
        keybindings: { version: 1, keybindings: {}, platforms: {} }
      }),
    /unsupported or private/
  )
})

test('JSON apply preserves state, nested unrelated preferences and existing shortcuts', () => {
  const options = fixture('json')
  snapshot(options)
  const location = profileLocation(options.home, options.profileId)
  writeJson(location.dataFile, {
    settings: {
      activeCodexManagedAccountId: 'keep-local',
      nativeChatAppearance: { width: 'wide' }
    },
    ui: { lastActiveRepoId: 'keep-local' },
    repos: ['keep-local']
  })
  writeJson(join(options.home, '.orca', 'keybindings.json'), {
    version: 1,
    keybindings: {},
    platforms: { darwin: { 'tab.close': ['Meta+w'] } }
  })
  applySettings(options)
  const applied = readProfile(location).root
  const bindings = JSON.parse(readFileSync(join(options.home, '.orca', 'keybindings.json'), 'utf8'))
  assert.deepEqual(
    {
      repos: applied.repos,
      account: record(applied.settings).activeCodexManagedAccountId,
      appearance: record(applied.settings).nativeChatAppearance,
      ui: record(applied.ui),
      shortcuts: bindings.platforms.darwin
    },
    {
      repos: ['keep-local'],
      account: 'keep-local',
      appearance: { width: 'wide', fontSize: 16 },
      ui: {
        lastActiveRepoId: 'keep-local',
        uiZoomLevel: 0.5,
        sidebarWidth: 280,
        statusBarVisible: true
      },
      shortcuts: { 'tab.close': ['Meta+w'], 'tab.nextAllTypes': ['Cmd+Shift+BracketRight'] }
    }
  )
})

test('rerun leaves all installed file bytes and mtimes unchanged', () => {
  const options = fixture('rerun')
  snapshot(options)
  applySettings(options)
  const before = files(options.home)
  applySettings(options)
  assert.deepEqual(files(options.home), before)
})

test('dry run does not create its target home', () => {
  const options = fixture('dry')
  snapshot(options)
  applySettings({ ...options, dryRun: true })
  assert.equal(existsSync(options.home), false)
})

test('live profile admission refuses offline apply', () => {
  const options = fixture('live')
  snapshot(options)
  const location = profileLocation(options.home, options.profileId)
  const runtime = acquireProfileStateRuntimeAdmission(location.userData)
  try {
    assert.throws(() => applySettings(options), /profile|owner|active|live/i)
  } finally {
    runtime.release()
  }
})

test('SQLite authority overrides legacy JSON and apply preserves other domains', () => {
  const options = fixture('sqlite')
  snapshot(options)
  const location = profileLocation(options.home, options.profileId)
  const legacy = JSON.stringify({
    settings: { theme: 'light', activeCodexManagedAccountId: 'keep-local' },
    ui: { lastActiveRepoId: 'keep-local' },
    repos: ['keep-local']
  })
  mkdirSync(join(location.userData, 'profiles', location.profileId), { recursive: true })
  writeFileSync(location.dataFile, legacy)
  const migrated = migrateProfileStateToSqlite({
    ...location,
    expectedLegacyJson: legacy,
    serializedState: legacy
  })
  migrated.authority.close()
  const initial = readProfile(location)
  const opened = openWritableProfileStateDatabase(location.databaseFile, location.profileId)
  try {
    writeProfileStateDomain(opened.db, {
      domain: 'settings',
      payload: JSON.stringify({ theme: 'dark', activeCodexManagedAccountId: 'keep-local' }),
      expectedRevision: initial.revision ?? -1
    })
  } finally {
    opened.db.close()
  }
  const authoritative = readProfile(location)
  applySettings(options)
  const afterApply = readProfile(location)
  const beforeRerun = files(options.home)
  applySettings(options)
  const rerunUnchanged = JSON.stringify(files(options.home)) === JSON.stringify(beforeRerun)
  const domains = readProfileStateDomains(location.databaseFile, location.profileId, ['repos'])
  assert.deepEqual(
    {
      authoritative: record(authoritative.root.settings).theme,
      account: record(afterApply.root.settings).activeCodexManagedAccountId,
      font: record(afterApply.root.settings).appFontFamily,
      repos: domains.kind === 'values' ? domains.values.get('repos') : null,
      legacyUnchanged: readFileSync(location.dataFile, 'utf8') === legacy,
      rerunUnchanged
    },
    {
      authoritative: 'dark',
      account: 'keep-local',
      font: 'Geist',
      repos: ['keep-local'],
      legacyUnchanged: true,
      rerunUnchanged: true
    }
  )
})

test('imported appearance updates the actual renderer dataset and preserves legacy fallback', () => {
  const dataset = { joseUi: 'gray' }
  const style = { setProperty: () => {}, removeProperty: () => {} }
  applyModernUiAppearance(normalizeModernUiSettings({}), { dataset, style })
  const legacy = dataset.joseUi
  applyModernUiAppearance(normalizeModernUiSettings({ joseUiVariant: 'oled' }), { dataset, style })
  assert.deepEqual([legacy, dataset.joseUi], ['gray', 'oled'])
})

test('compacted legacy appearance refuses guessing', () => {
  const location = profileLocation(fixture('sst').home, 'local-default')
  const directory = join(location.userData, 'Local Storage', 'leveldb')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '000001.ldb'), '')
  assert.throws(() => readLegacyVariant(location.userData), /--variant/)
})
