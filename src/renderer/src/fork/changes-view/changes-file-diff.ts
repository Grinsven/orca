import { parseDiffFromFile, type FileDiffMetadata } from '@pierre/diffs'
import type { ChangesFileEntry } from './changes-file-entries'

export type DiffLineStat = { additions: number; deletions: number }

const FNV_OFFSET_BASIS_32 = 0x811c9dc5
const FNV_PRIME_32 = 0x01000193

function fnv1a32(input: string): string {
  let hash = FNV_OFFSET_BASIS_32
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0
  }
  return hash.toString(36)
}

function isAddedStatus(entry: ChangesFileEntry): boolean {
  return entry.status === 'added' || entry.status === 'untracked'
}

/** Diff of two full file versions; Pierre folds the unchanged runs between hunks into bands. */
export function buildChangesFileDiff(
  entry: ChangesFileEntry,
  original: string,
  modified: string,
  ignoreWhitespace: boolean
): FileDiffMetadata {
  const oldName = entry.oldPath ?? entry.path
  // Why: the worker pool caches highlighted ASTs by key, so the key must change with the text.
  const oldFile =
    isAddedStatus(entry) && original.length === 0
      ? null
      : { name: oldName, contents: original, cacheKey: `${oldName}:${fnv1a32(original)}` }
  const newFile =
    entry.status === 'deleted' && modified.length === 0
      ? null
      : { name: entry.path, contents: modified, cacheKey: `${entry.path}:${fnv1a32(modified)}` }
  return parseDiffFromFile(oldFile, newFile, ignoreWhitespace ? { ignoreWhitespace: true } : {})
}

/** Header-only stand-in for a file whose body is not loaded (pending, binary, too large, failed). */
export function buildChangesPlaceholderDiff(entry: ChangesFileEntry): FileDiffMetadata {
  const type = isAddedStatus(entry)
    ? 'new'
    : entry.status === 'deleted'
      ? 'deleted'
      : entry.oldPath
        ? 'rename-changed'
        : 'change'
  return {
    name: entry.path,
    ...(entry.oldPath ? { prevName: entry.oldPath } : {}),
    type,
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: false,
    additionLines: [],
    deletionLines: []
  }
}

export function getFileDiffLineStat(fileDiff: FileDiffMetadata): DiffLineStat {
  let additions = 0
  let deletions = 0
  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionLines
    deletions += hunk.deletionLines
  }
  return { additions, deletions }
}
