import { useAppStore } from '@/store'
import { requireRuntimeTargetForFileOwner } from '@/lib/file-owner-runtime-target'
import { getRuntimeGitBranchDiff, getRuntimeGitDiff } from '@/runtime/runtime-git-diff-client'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import type { OpenFile } from '@/store/slices/editor'
import type { GitDiffResult } from '../../../../shared/git-diff-compare-types'
import { getCombinedDiffSectionConnectionId } from '@/components/editor/combined-diff/load-sections/combined-diff-section-connection'
import { withDiffSectionLoadTimeout } from '@/components/editor/combined-diff/load-sections/combined-diff-section-load-timeout'
import type { ChangesFileEntry } from './changes-file-entries'

export type ChangesBranchCompare = {
  baseRef: string
  baseOid: string
  headOid: string
  mergeBase: string
}

/** Both sides of one file as plain text, or why it cannot be shown as text. */
export type ChangesFileContents =
  | { kind: 'text'; original: string; modified: string; limited: boolean }
  | { kind: 'binary' }

function toContents(original: GitDiffResult, modified: GitDiffResult): ChangesFileContents {
  if (original.kind === 'binary' || modified.kind === 'binary') {
    return { kind: 'binary' }
  }
  return {
    kind: 'text',
    original: original.originalContent,
    modified: modified.modifiedContent,
    limited:
      original.largeDiffRenderLimit?.limited === true ||
      modified.largeDiffRenderLimit?.limited === true
  }
}

// Every read goes through the runtime git client, so SSH, WSL and paired hosts run git themselves.
export async function fetchChangesFileContents({
  entry,
  file,
  branchCompare
}: {
  entry: ChangesFileEntry
  file: OpenFile
  branchCompare: ChangesBranchCompare | null
}): Promise<ChangesFileContents> {
  const context: RuntimeGitContext = {
    target: requireRuntimeTargetForFileOwner(
      useAppStore.getState(),
      file.worktreeId,
      file.runtimeEnvironmentId
    ),
    worktreeId: file.worktreeId,
    worktreePath: file.filePath,
    connectionId: getCombinedDiffSectionConnectionId(file.worktreeId, file.filePath, entry.path)
  }
  const readBranch = (): Promise<GitDiffResult> =>
    withDiffSectionLoadTimeout(
      getRuntimeGitBranchDiff(context, {
        compare: branchCompare!,
        filePath: entry.path,
        oldPath: entry.branch?.oldPath
      })
    )
  // HEAD to working tree in one read, so staged plus unstaged edits show as one diff.
  const readWorkingTree = (): Promise<GitDiffResult> =>
    withDiffSectionLoadTimeout(
      getRuntimeGitDiff(context, { filePath: entry.path, staged: false, compareAgainstHead: true })
    )

  if (entry.branch && branchCompare) {
    if (entry.worktree.length === 0) {
      const result = await readBranch()
      return toContents(result, result)
    }
    const [branch, worktree] = await Promise.all([readBranch(), readWorkingTree()])
    return toContents(branch, worktree)
  }

  const worktree = readWorkingTree()
  const renamedFrom = entry.worktree.find(
    (row) => row.area === 'staged' && row.oldPath !== undefined
  )?.oldPath
  if (!renamedFrom) {
    const result = await worktree
    return toContents(result, result)
  }
  // Why: HEAD has no blob at a staged rename's new path; the staged read of the old path holds HEAD's side.
  const [original, modified] = await Promise.all([
    withDiffSectionLoadTimeout(getRuntimeGitDiff(context, { filePath: renamedFrom, staged: true })),
    worktree
  ])
  return toContents(original, modified)
}
