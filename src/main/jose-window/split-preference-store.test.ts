import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SplitPreferenceStore } from './split-preference-store'

const directories: string[] = []
function fixture(): { file: string; store: SplitPreferenceStore } {
  const directory = mkdtempSync(join(tmpdir(), 'orca-split-preference-'))
  directories.push(directory)
  const file = join(directory, 'preference.json')
  return { file, store: new SplitPreferenceStore(file) }
}
afterEach(() =>
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
)

describe('workspace drag preference', () => {
  it('defaults on and survives a store restart when disabled', () => {
    const { file, store } = fixture()
    const initial = store.read()
    store.write(false)
    expect({ initial, restored: new SplitPreferenceStore(file).read() }).toEqual({
      initial: true,
      restored: false
    })
  })

  it('sends the same preference to every window and stops a closed subscription', () => {
    const { store } = fixture()
    const first: boolean[] = []
    const second: boolean[] = []
    const stop = store.subscribe((enabled) => first.push(enabled))
    const stopSecond = store.subscribe((enabled) => second.push(enabled))
    store.write(false)
    stop()
    store.write(true)
    stopSecond()
    expect({ first, second }).toEqual({ first: [true, false], second: [true, false, true] })
  })
})
