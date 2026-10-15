import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeDurableSecureJsonFile } from '../../shared/secure-file'
import { JoseWindowSplitPreference } from '../../shared/rpc-contract/jose-window-params'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'

/** The ownership host shares this preference with every window paired to it. */
export class SplitPreferenceStore {
  private readonly listeners = new Set<(enabled: boolean) => void>()

  constructor(private readonly file: string) {}

  read(): boolean {
    try {
      const value: unknown = JSON.parse(readFileSync(this.file, 'utf8'))
      return JoseWindowSplitPreference.parse(value).enabled
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return true
      }
      throw error
    }
  }

  write(enabled: boolean): void {
    writeDurableSecureJsonFile(this.file, { enabled })
    this.listeners.forEach((listener) => listener(enabled))
  }

  subscribe(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener)
    listener(this.read())
    return () => this.listeners.delete(listener)
  }
}

let store: SplitPreferenceStore | null = null

export function splitPreferenceStore(): SplitPreferenceStore {
  store ??= new SplitPreferenceStore(join(getProfileUserDataPath(), 'jose-split-preference.json'))
  return store
}
