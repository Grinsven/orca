import { describe, expect, it } from 'vitest'
import type { ChangesFileEntry } from './changes-file-entries'
import { buildChangesFileModels, sumChangesStats } from './changes-file-models'
import type { ChangesFileLoadState } from './use-changes-file-contents'

const lines = (count: number, edit?: number): string =>
  `${Array.from({ length: count }, (_, i) => (i === edit ? `edited ${i}` : `line ${i}`)).join('\n')}\n`

function entry(path: string, status: ChangesFileEntry['status'] = 'modified'): ChangesFileEntry {
  return { path, status, worktree: [] }
}

function loaded(original: string, modified: string): ChangesFileLoadState {
  return {
    kind: 'loaded',
    version: '0|x',
    contents: { kind: 'text', original, modified, limited: false }
  }
}

describe('buildChangesFileModels', () => {
  it('folds the unchanged runs between hunks', () => {
    const file = entry('src/long.ts')
    const [model] = buildChangesFileModels({
      entries: [file],
      states: new Map([[file.path, loaded(lines(400), lines(400, 200))]]),
      collapsedPaths: new Set(),
      ignoreWhitespace: false
    })
    expect(model.notice).toBeNull()
    expect(model.collapsed).toBe(false)
    expect(model.stat).toEqual({ additions: 1, deletions: 1 })
    const [hunk] = model.item.fileDiff.hunks
    // Nearly all 200 lines before the edit sit in one folded band; a few stay as context.
    expect(hunk.collapsedBefore).toBeGreaterThan(190)
    expect(model.item.fileDiff.hunks).toHaveLength(1)
  })

  it('reuses the parsed diff across renders and changes the version on collapse', () => {
    const file = entry('a.ts')
    const states = new Map([[file.path, loaded('a\n', 'b\n')]])
    const args = { entries: [file], states, ignoreWhitespace: false }
    const [open] = buildChangesFileModels({ ...args, collapsedPaths: new Set() })
    const [again] = buildChangesFileModels({ ...args, collapsedPaths: new Set() })
    const [folded] = buildChangesFileModels({ ...args, collapsedPaths: new Set(['a.ts']) })
    expect(again.item.fileDiff).toBe(open.item.fileDiff)
    expect(again.item.version).toBe(open.item.version)
    expect(folded.item.version).not.toBe(open.item.version)
    expect(folded.collapsed).toBe(true)
  })

  it('hides whitespace-only edits when asked', () => {
    const file = entry('a.ts')
    const states = new Map([[file.path, loaded('if (x) {\n  y()\n}\n', 'if (x) {\n    y()\n}\n')]])
    const [shown] = buildChangesFileModels({
      entries: [file],
      states,
      collapsedPaths: new Set(),
      ignoreWhitespace: false
    })
    const [hidden] = buildChangesFileModels({
      entries: [file],
      states,
      collapsedPaths: new Set(),
      ignoreWhitespace: true
    })
    expect(shown.stat).toEqual({ additions: 1, deletions: 1 })
    expect(hidden.stat).toEqual({ additions: 0, deletions: 0 })
  })

  it('keeps files without a body collapsed with a notice and the git counts', () => {
    const pending = { ...entry('pending.ts'), added: 4, removed: 2 }
    const binary = entry('logo.png', 'added')
    const big = entry('big.json')
    const failed = entry('failed.ts')
    const models = buildChangesFileModels({
      entries: [pending, binary, big, failed],
      states: new Map<string, ChangesFileLoadState>([
        ['logo.png', { kind: 'loaded', version: 'v', contents: { kind: 'binary' } }],
        ['big.json', { kind: 'deferred' }],
        ['failed.ts', { kind: 'error', version: 'v', message: 'Diff did not finish loading.' }]
      ]),
      collapsedPaths: new Set(),
      ignoreWhitespace: false
    })
    expect(models.map((model) => [model.notice?.kind, model.collapsed])).toEqual([
      ['loading', true],
      ['binary', true],
      ['deferred', true],
      ['error', true]
    ])
    expect(models[1].item.fileDiff.type).toBe('new')
    expect(sumChangesStats(models)).toEqual({ additions: 4, deletions: 2 })
  })

  it('marks a deleted file and a rename with the right change type', () => {
    const deleted = entry('old.ts', 'deleted')
    const renamed = { ...entry('new-name.ts', 'renamed'), oldPath: 'old-name.ts' }
    const [deletedModel, renamedModel] = buildChangesFileModels({
      entries: [deleted, renamed],
      states: new Map([
        ['old.ts', loaded('gone\n', '')],
        ['new-name.ts', loaded('same\nline\n', 'same\nline changed\n')]
      ]),
      collapsedPaths: new Set(),
      ignoreWhitespace: false
    })
    expect(deletedModel.item.fileDiff.type).toBe('deleted')
    expect(renamedModel.item.fileDiff).toMatchObject({
      type: 'rename-changed',
      prevName: 'old-name.ts'
    })
  })
})
