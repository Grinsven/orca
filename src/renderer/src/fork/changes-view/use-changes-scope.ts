import { useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { GitBranchChangeEntry } from '../../../../shared/git-diff-compare-types'
import type { GitStatusEntry } from '../../../../shared/git-status-types'
import {
  buildBranchChangesEntries,
  buildUncommittedChangesEntries,
  type ChangesFileEntry,
  type ChangesScope
} from './changes-file-entries'
import type { ChangesBranchCompare } from './fetch-changes-file'

const EMPTY_STATUS: GitStatusEntry[] = []
const EMPTY_BRANCH: GitBranchChangeEntry[] = []
// Why: switching tabs unmounts the view; the picked scope should survive that, per tab.
const scopeByTabId = new Map<string, ChangesScope>()

function initialScope(file: OpenFile): ChangesScope {
  return file.diffSource === 'combined-uncommitted' ? 'uncommitted' : 'branch'
}

export type ChangesScopeData = {
  scope: ChangesScope
  setScope: (scope: ChangesScope) => void
  /** Null when the branch has no usable compare (unborn HEAD, missing base, still loading). */
  branchCompare: ChangesBranchCompare | null
  entries: ChangesFileEntry[]
  /** Identity of what the view compares; a new key drops every loaded file. */
  scopeKey: string
}

export function useChangesScope(file: OpenFile): ChangesScopeData {
  const [pickedScope, setPickedScope] = useState<ChangesScope>(
    () => scopeByTabId.get(file.id) ?? initialScope(file)
  )
  const statusEntries = useAppStore((s) => s.gitStatusByWorktree[file.worktreeId] ?? EMPTY_STATUS)
  const liveBranchEntries = useAppStore(
    (s) => s.gitBranchChangesByWorktree[file.worktreeId] ?? EMPTY_BRANCH
  )
  const summary = useAppStore((s) => s.gitBranchCompareSummaryByWorktree[file.worktreeId])

  const liveReady =
    summary?.status === 'ready' && !!summary.baseOid && !!summary.headOid && !!summary.mergeBase
  // Why: the live summary wins; the tab's open-time snapshot covers a summary that is still loading.
  const source = liveReady ? summary : file.branchCompare
  const baseRef = source?.baseRef
  const baseOid = source?.baseOid
  const headOid = source?.headOid
  const mergeBase = source?.mergeBase
  const branchCompare = useMemo<ChangesBranchCompare | null>(
    () =>
      baseRef && baseOid && headOid && mergeBase ? { baseRef, baseOid, headOid, mergeBase } : null,
    [baseRef, baseOid, headOid, mergeBase]
  )
  const compareKey = branchCompare ? `${baseRef}:${mergeBase}:${headOid}` : ''
  const branchEntries = liveReady ? liveBranchEntries : (file.branchEntriesSnapshot ?? EMPTY_BRANCH)
  const scope: ChangesScope =
    pickedScope === 'branch' && !branchCompare ? 'uncommitted' : pickedScope

  const entries = useMemo(
    () =>
      scope === 'branch'
        ? buildBranchChangesEntries(branchEntries, statusEntries)
        : buildUncommittedChangesEntries(statusEntries),
    [branchEntries, scope, statusEntries]
  )

  const setScope = (next: ChangesScope): void => {
    scopeByTabId.set(file.id, next)
    setPickedScope(next)
  }

  return {
    scope,
    setScope,
    branchCompare,
    entries,
    scopeKey: scope === 'branch' ? `branch:${compareKey}` : 'uncommitted'
  }
}
