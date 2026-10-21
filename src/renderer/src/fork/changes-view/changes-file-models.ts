import type { CodeViewDiffItem, FileDiffMetadata } from '@pierre/diffs'
import type { ChangesFileEntry } from './changes-file-entries'
import {
  buildChangesFileDiff,
  buildChangesPlaceholderDiff,
  getFileDiffLineStat,
  type DiffLineStat
} from './changes-file-diff'
import type { ChangesFileNotice } from './changes-file-header-parts'
import type { ChangesFileContents } from './fetch-changes-file'
import type { ChangesFileLoadState } from './use-changes-file-contents'

export type ChangesFileModel = {
  entry: ChangesFileEntry
  item: CodeViewDiffItem<undefined>
  notice: ChangesFileNotice
  stat: DiffLineStat | null
  collapsed: boolean
}

type ParsedDiff = { fileDiff: FileDiffMetadata; stat: DiffLineStat; id: number }

// Why: parsing is the costly step; cache per loaded contents so scope, collapse or layout changes reuse it.
const parsedByContents = new WeakMap<ChangesFileContents, Map<boolean, ParsedDiff>>()
const placeholderByEntry = new WeakMap<ChangesFileEntry, FileDiffMetadata>()
let nextParsedId = 1
const NOTICE_CODE: Record<NonNullable<ChangesFileNotice>['kind'] | 'none', number> = {
  none: 0,
  loading: 1,
  deferred: 2,
  binary: 3,
  'too-large': 4,
  error: 5
}

function parseContents(
  entry: ChangesFileEntry,
  contents: Extract<ChangesFileContents, { kind: 'text' }>,
  ignoreWhitespace: boolean
): ParsedDiff {
  let byMode = parsedByContents.get(contents)
  if (!byMode) {
    byMode = new Map()
    parsedByContents.set(contents, byMode)
  }
  const cached = byMode.get(ignoreWhitespace)
  if (cached) {
    return cached
  }
  const fileDiff = buildChangesFileDiff(
    entry,
    contents.original,
    contents.modified,
    ignoreWhitespace
  )
  const parsed = { fileDiff, stat: getFileDiffLineStat(fileDiff), id: nextParsedId++ }
  byMode.set(ignoreWhitespace, parsed)
  return parsed
}

function placeholderFor(entry: ChangesFileEntry): FileDiffMetadata {
  let placeholder = placeholderByEntry.get(entry)
  if (!placeholder) {
    placeholder = buildChangesPlaceholderDiff(entry)
    placeholderByEntry.set(entry, placeholder)
  }
  return placeholder
}

function entryStat(entry: ChangesFileEntry): DiffLineStat | null {
  return entry.added === undefined && entry.removed === undefined
    ? null
    : { additions: entry.added ?? 0, deletions: entry.removed ?? 0 }
}

function noticeFor(state: ChangesFileLoadState | undefined): ChangesFileNotice {
  if (!state || state.kind === 'pending') {
    return { kind: 'loading' }
  }
  if (state.kind === 'deferred') {
    return { kind: 'deferred' }
  }
  if (state.kind === 'error') {
    return { kind: 'error', message: state.message }
  }
  if (state.contents.kind === 'binary') {
    return { kind: 'binary' }
  }
  return state.contents.limited ? { kind: 'too-large' } : null
}

export function buildChangesFileModels({
  entries,
  states,
  collapsedPaths,
  ignoreWhitespace
}: {
  entries: readonly ChangesFileEntry[]
  states: ReadonlyMap<string, ChangesFileLoadState>
  collapsedPaths: ReadonlySet<string>
  ignoreWhitespace: boolean
}): ChangesFileModel[] {
  return entries.map((entry) => {
    const state = states.get(entry.path)
    const notice = noticeFor(state)
    const parsed =
      notice === null && state?.kind === 'loaded' && state.contents.kind === 'text'
        ? parseContents(entry, state.contents, ignoreWhitespace)
        : null
    // Without a body there is nothing to expand; the header carries the notice instead.
    const collapsed = parsed === null || collapsedPaths.has(entry.path)
    return {
      entry,
      notice,
      collapsed,
      stat: parsed?.stat ?? entryStat(entry),
      item: {
        id: entry.path,
        type: 'diff',
        fileDiff: parsed?.fileDiff ?? placeholderFor(entry),
        collapsed,
        // Why: CodeView repaints an item only when its version moves.
        version:
          (parsed?.id ?? 0) * 16 + NOTICE_CODE[notice?.kind ?? 'none'] * 2 + (collapsed ? 1 : 0)
      }
    }
  })
}

export function sumChangesStats(models: readonly ChangesFileModel[]): DiffLineStat {
  let additions = 0
  let deletions = 0
  for (const model of models) {
    additions += model.stat?.additions ?? 0
    deletions += model.stat?.deletions ?? 0
  }
  return { additions, deletions }
}
