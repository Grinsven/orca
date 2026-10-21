import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export const CHANGES_VIEW_GEN_FILE_COUNT = 30
export const CHANGES_VIEW_LARGE_LINES = 6000

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' })
}

function write(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, contents)
}

function moduleSource(name: string, lineCount: number, editEvery = 0): string {
  const lines: string[] = [`// ${name}`, "import { strict as assert } from 'node:assert'", '']
  for (let index = 0; lines.length < lineCount; index += 1) {
    const edited = editEvery > 0 && index % editEvery === editEvery - 1
    lines.push(
      edited
        ? `export function ${name}Step${index}(value: number): number { return value * ${index} + 1 }`
        : `export function ${name}Step${index}(value: number): number { return value + ${index} }`
    )
  }
  lines.push(`assert.equal(${name}Step0(1), 1)`, '')
  return lines.join('\n')
}

/**
 * A branch with a committed base (exposed as its own local branch) plus branch commits and
 * uncommitted work of every kind: modified, staged and unstaged, staged rename, deletion, untracked.
 */
export function seedChangesViewFixture(
  worktreePath: string,
  baseBranch: string
): {
  branchFiles: string[]
  uncommittedFiles: string[]
} {
  const genPath = (index: number): string => `src/gen/module-${String(index).padStart(2, '0')}.ts`
  write(worktreePath, 'src/big/large-module.ts', moduleSource('large', CHANGES_VIEW_LARGE_LINES))
  for (let index = 0; index < CHANGES_VIEW_GEN_FILE_COUNT; index += 1) {
    write(worktreePath, genPath(index), moduleSource(`gen${index}`, 300))
  }
  write(worktreePath, 'src/rename-me.ts', moduleSource('renamed', 40))
  write(worktreePath, 'src/delete-me.ts', moduleSource('deleted', 20))
  write(worktreePath, 'src/stage-and-edit.ts', moduleSource('staged', 60))
  git(worktreePath, 'add', '-A')
  git(worktreePath, 'commit', '-m', 'fixture: changes view base')
  git(worktreePath, 'branch', baseBranch)

  write(
    worktreePath,
    'src/big/large-module.ts',
    moduleSource('large', CHANGES_VIEW_LARGE_LINES, 25)
  )
  for (let index = 0; index < CHANGES_VIEW_GEN_FILE_COUNT; index += 1) {
    write(worktreePath, genPath(index), moduleSource(`gen${index}`, 300, 140))
  }
  write(worktreePath, 'src/committed-only.ts', moduleSource('committed', 30))
  git(worktreePath, 'add', '-A')
  git(worktreePath, 'commit', '-m', 'fixture: changes view branch work')

  write(worktreePath, 'src/stage-and-edit.ts', moduleSource('staged', 60, 20))
  git(worktreePath, 'add', 'src/stage-and-edit.ts')
  write(
    worktreePath,
    'src/stage-and-edit.ts',
    `${moduleSource('staged', 60, 20)}// unstaged tail\n`
  )
  git(worktreePath, 'mv', 'src/rename-me.ts', 'src/renamed.ts')
  rmSync(path.join(worktreePath, 'src/delete-me.ts'))
  write(worktreePath, 'notes/new-file.md', '# New note\n\nUntracked file in the changes view.\n')
  write(worktreePath, genPath(3), `${moduleSource('gen3', 300, 140)}// local edit\n`)

  const uncommittedFiles = [
    'notes/new-file.md',
    'src/delete-me.ts',
    genPath(3),
    'src/renamed.ts',
    'src/stage-and-edit.ts'
  ]
  const branchFiles = [
    'src/big/large-module.ts',
    'src/committed-only.ts',
    ...Array.from({ length: CHANGES_VIEW_GEN_FILE_COUNT }, (_, index) => genPath(index)),
    ...uncommittedFiles.filter((file) => file !== genPath(3))
  ]
  return { branchFiles, uncommittedFiles }
}
