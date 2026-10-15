import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fileURLToPath } from 'node:url'
import { readProfileStateDomainsWithRevisionFromDatabase } from '../src/main/persistence/profile-state/profile-state-domain-reader'
import {
  openProfileStateDatabaseReadOnly,
  openWritableProfileStateDatabase
} from '../src/main/persistence/profile-state/profile-state-database'
import { profileStateJsonMatchesAcceptance } from '../src/main/persistence/profile-state/profile-state-documents'
import { writeProfileStateDomains } from '../src/main/persistence/profile-state/profile-state-domain-writes'
import { classifyProfileStateStorage } from '../src/main/persistence/profile-state/profile-state-storage-classification'
import { parseProfileStateRoot } from '../src/main/persistence/profile-state/profile-state-document-validation'
import { mergePreferences, record, type PreferenceRecord } from './settings-policy'

export const scratchRoot = fileURLToPath(new URL('../.tmp', import.meta.url))
export type ProfileLocation = {
  userData: string
  profileId: string
  dataFile: string
  databaseFile: string
}
export type ProfileContents = { kind: 'json' | 'sqlite'; root: PreferenceRecord; revision?: number }

export function profileLocation(home: string, profileId: string): ProfileLocation {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(profileId)) {
    throw new Error('Invalid profile name')
  }
  const userData = join(home, 'Library', 'Application Support', 'orca')
  const directory = join(userData, 'profiles', profileId)
  return {
    userData,
    profileId,
    dataFile: join(directory, 'orca-data.json'),
    databaseFile: join(directory, 'profile-state.db')
  }
}

function stamp(path: string): string {
  if (!existsSync(path)) {
    return 'absent'
  }
  const metadata = statSync(path, { bigint: true })
  return `${metadata.ino}:${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`
}

export function profileFiles(location: ProfileLocation): string[] {
  return [
    location.dataFile,
    ...['', '-wal', '-shm', '-journal', '.authority'].map(
      (suffix) => location.databaseFile + suffix
    )
  ]
}

/** SQLite opens only the private copy, so the original WAL and shared-memory files stay untouched. */
export function readProfile(location: ProfileLocation): ProfileContents {
  const kind = classifyProfileStateStorage(location.dataFile, location.databaseFile)
  if (kind === 'json-only' || kind === 'neither') {
    if (existsSync(`${location.databaseFile}.authority`)) {
      throw new Error('Profile database is missing; repair it before transferring settings')
    }
    return {
      kind: 'json',
      root: existsSync(location.dataFile)
        ? parseProfileStateRoot(readFileSync(location.dataFile, 'utf8'))
        : {}
    }
  }
  mkdirSync(scratchRoot, { recursive: true, mode: 0o700 })
  const temporary = mkdtempSync(join(scratchRoot, 'settings-read-'))
  chmodSync(temporary, 0o700)
  try {
    const paths = profileFiles(location)
    const before = paths.map(stamp)
    for (const path of paths) {
      if (existsSync(path)) {
        copyFileSync(path, join(temporary, path.slice(dirname(path).length + 1)))
      }
    }
    if (!isDeepStrictEqual(before, paths.map(stamp))) {
      throw new Error('Profile changed while it was copied; retry export')
    }
    const opened = openProfileStateDatabaseReadOnly(
      join(temporary, 'profile-state.db'),
      location.profileId
    )
    try {
      const jsonPath = join(temporary, 'orca-data.json')
      if (
        existsSync(jsonPath) &&
        !profileStateJsonMatchesAcceptance(opened.db, readFileSync(jsonPath, 'utf8'))
      ) {
        throw new Error(
          'Profile JSON does not match its SQLite authority; repair it before transferring settings'
        )
      }
      const result = readProfileStateDomainsWithRevisionFromDatabase(opened.db, ['settings', 'ui'])
      if (result.kind === 'unreadable') {
        throw result.error
      }
      return { kind: 'sqlite', revision: result.revision, root: Object.fromEntries(result.values) }
    } finally {
      opened.db.close()
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
    throw new Error('Refusing to overwrite a settings symlink')
  }
  const temporary = `${path}.jose-settings-${process.pid}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export function backupFiles(files: string[], directory: string): string {
  const destination = join(
    directory,
    `jose-settings-backup-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}`
  )
  mkdirSync(destination, { mode: 0o700 })
  files.forEach((file, index) => {
    if (!existsSync(file)) {
      return
    }
    const copy = join(destination, `${index}-${file.slice(dirname(file).length + 1)}`)
    copyFileSync(file, copy)
    chmodSync(copy, 0o600)
  })
  return destination
}

export function mergedProfile(
  source: ProfileContents,
  snapshot: { settings: PreferenceRecord; ui: PreferenceRecord }
): PreferenceRecord {
  return {
    ...source.root,
    settings: mergePreferences(source.root.settings, snapshot.settings),
    ui: mergePreferences(source.root.ui, snapshot.ui)
  }
}

export function applyProfile(
  location: ProfileLocation,
  source: ProfileContents,
  merged: PreferenceRecord
): void {
  if (source.kind === 'json') {
    writeJson(location.dataFile, merged)
    return
  }
  if (source.revision === undefined) {
    throw new Error('Missing SQLite profile revision')
  }
  const opened = openWritableProfileStateDatabase(location.databaseFile, location.profileId)
  try {
    writeProfileStateDomains(opened.db, {
      expectedRevision: source.revision,
      replacements: ['settings', 'ui'].map((domain) => ({
        domain,
        payload: JSON.stringify(record(merged[domain]))
      }))
    })
  } finally {
    opened.db.close()
  }
}
