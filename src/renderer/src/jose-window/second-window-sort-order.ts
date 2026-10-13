import { parseExecutionHostId } from '../../../shared/execution-host'
import type { WorktreeRuntimeOwnerState } from '@/lib/worktree-runtime-owner-state'
import {
  splitWorktreeSortOrderByHost,
  type WorktreeSortOrderHostGroup
} from '@/lib/worktree-sort-order-host-split'
import { isSecondaryWindow } from './is-secondary-window'

/** The host groups this window may persist its smart order to.
 *  Why: runtime sortOrder is the host's shared worktree metadata, which window 1 shows and cold
 *  start reads, so a second window keeps its own order and stores only its local worktrees. */
export function splitWorktreeSortOrderForThisWindow(
  state: WorktreeRuntimeOwnerState,
  orderedIds: readonly string[]
): WorktreeSortOrderHostGroup[] {
  const groups = splitWorktreeSortOrderByHost(state, orderedIds)
  if (!isSecondaryWindow()) {
    return groups
  }
  return groups.filter((group) => parseExecutionHostId(group.hostId)?.kind !== 'runtime')
}
