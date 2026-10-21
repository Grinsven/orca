import { useCallback, useEffect, useRef, useState } from 'react'
import type { OpenFile } from '@/store/slices/editor'
import { hasBinaryFileExtension } from '../../../../shared/binary-file-extensions'
import { MAX_AUTOMATIC_DIFF_CHANGED_LINES } from '@/components/editor/combined-diff-on-demand-load'
import { getDiffSectionLoadErrorMessage } from '@/components/editor/combined-diff/load-sections/combined-diff-section-load-timeout'
import { getChangesEntryVersion, type ChangesFileEntry } from './changes-file-entries'
import {
  fetchChangesFileContents,
  type ChangesBranchCompare,
  type ChangesFileContents
} from './fetch-changes-file'

export type ChangesFileLoadState =
  | { kind: 'pending' }
  | { kind: 'deferred' }
  | { kind: 'loaded'; version: string; contents: ChangesFileContents }
  | { kind: 'error'; version: string; message: string }

type LoadedByPath = ReadonlyMap<string, ChangesFileLoadState>

const PENDING: ChangesFileLoadState = { kind: 'pending' }
const DEFERRED: ChangesFileLoadState = { kind: 'deferred' }
const EMPTY_LOADED: LoadedByPath = new Map()
// Same as T3's review panel: enough to fill the first screen without flooding the git host.
const LOAD_CONCURRENCY = 4

function isLargeByCount(entry: ChangesFileEntry): boolean {
  return (entry.added ?? 0) + (entry.removed ?? 0) > MAX_AUTOMATIC_DIFF_CHANGED_LINES
}

function isSettledAt(state: ChangesFileLoadState | undefined, version: string): boolean {
  return (state?.kind === 'loaded' || state?.kind === 'error') && state.version === version
}

export function useChangesFileContents({
  file,
  entries,
  branchCompare,
  scopeKey
}: {
  file: OpenFile
  entries: readonly ChangesFileEntry[]
  branchCompare: ChangesBranchCompare | null
  /** Changes when the scope or compare target changes; drops every loaded file. */
  scopeKey: string
}): {
  states: ReadonlyMap<string, ChangesFileLoadState>
  loadFile: (path: string) => void
  refresh: () => void
} {
  const [loaded, setLoaded] = useState<{ scopeKey: string; byPath: LoadedByPath }>(() => ({
    scopeKey,
    byPath: EMPTY_LOADED
  }))
  const [forcedPaths, setForcedPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [generation, setGeneration] = useState(0)
  const byPath = loaded.scopeKey === scopeKey ? loaded.byPath : EMPTY_LOADED
  const byPathRef = useRef(byPath)
  // Why: the loader reads settled files as a snapshot; depending on them would restart it per file.
  useEffect(() => {
    byPathRef.current = byPath
  }, [byPath])
  const versionOf = useCallback(
    (entry: ChangesFileEntry) => `${generation}|${getChangesEntryVersion(entry)}`,
    [generation]
  )
  const isDeferred = useCallback(
    (entry: ChangesFileEntry) =>
      !hasBinaryFileExtension(entry.path) && !forcedPaths.has(entry.path) && isLargeByCount(entry),
    [forcedPaths]
  )

  useEffect(() => {
    const queue = entries.filter(
      (entry) =>
        !isSettledAt(byPathRef.current.get(entry.path), versionOf(entry)) && !isDeferred(entry)
    )
    if (queue.length === 0) {
      return
    }
    let cancelled = false
    const settle = (path: string, state: ChangesFileLoadState): void => {
      if (cancelled) {
        return
      }
      setLoaded((prev) => {
        const next = new Map(prev.scopeKey === scopeKey ? prev.byPath : EMPTY_LOADED)
        next.set(path, state)
        return { scopeKey, byPath: next }
      })
    }
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (!cancelled && cursor < queue.length) {
        const entry = queue[cursor++]
        const version = versionOf(entry)
        if (hasBinaryFileExtension(entry.path)) {
          settle(entry.path, { kind: 'loaded', version, contents: { kind: 'binary' } })
          continue
        }
        try {
          const contents = await fetchChangesFileContents({ entry, file, branchCompare })
          settle(entry.path, { kind: 'loaded', version, contents })
        } catch (error) {
          const message = getDiffSectionLoadErrorMessage(error)
          settle(entry.path, { kind: 'error', version, message })
        }
      }
    }
    for (let index = 0; index < Math.min(LOAD_CONCURRENCY, queue.length); index += 1) {
      void worker()
    }
    return () => {
      cancelled = true
    }
  }, [branchCompare, entries, file, isDeferred, scopeKey, versionOf])

  const states = new Map<string, ChangesFileLoadState>()
  for (const entry of entries) {
    // Why: a changed or refreshed file keeps its previous body until the new one lands, so it never flashes blank.
    const state = byPath.get(entry.path)
    states.set(entry.path, state ?? (isDeferred(entry) ? DEFERRED : PENDING))
  }

  const loadFile = useCallback((path: string) => {
    setForcedPaths((prev) => (prev.has(path) ? prev : new Set(prev).add(path)))
  }, [])
  const refresh = useCallback(() => setGeneration((value) => value + 1), [])

  return { states, loadFile, refresh }
}
