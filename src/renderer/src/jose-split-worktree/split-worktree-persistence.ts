import { z } from 'zod'
import { useAppStore } from '@/store'
import { resolveOwnershipTarget } from '@/jose-window/window-ownership-client'
import { parseExecutionHostId } from '../../../shared/execution-host'
import type { SplitLayout, SplitWorkspaceRef } from './split-worktree-state'

const Ref = z.object({ worktreeId: z.string().min(1), executionHostId: z.string().min(1) })
const SavedLayout = z.object({
  version: z.literal(1),
  slots: z.tuple([Ref, Ref]),
  axis: z.enum(['horizontal', 'vertical']),
  ratio: z.number().min(0.15).max(0.85),
  focused: z.number().int().min(0).max(1)
})

let lastWrite: { key: string; value: string | null } | null = null

export function splitPersistenceKey(): string {
  const state = useAppStore.getState()
  return JSON.stringify([
    'jose-split-worktree',
    state.activeOrcaProfileId,
    resolveOwnershipTarget(state.settings)
  ])
}

export function saveSplitWorktreeLayout(
  layout: SplitLayout | null,
  focus: SplitWorkspaceRef
): void {
  try {
    const key = splitPersistenceKey()
    const value = layout
      ? JSON.stringify({
          version: 1,
          ...layout,
          focused: layout.slots[0].worktreeId === focus.worktreeId ? 0 : 1
        })
      : null
    if (lastWrite?.key === key && lastWrite.value === value) {
      return
    }
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
    lastWrite = { key, value }
  } catch {
    // The live layout remains usable when the profile storage is unavailable.
  }
}

export function readSplitWorktreeLayout(): {
  layout: SplitLayout
  focus: SplitWorkspaceRef
} | null {
  try {
    const raw = localStorage.getItem(splitPersistenceKey())
    if (!raw) {
      return null
    }
    const parsed = SavedLayout.parse(JSON.parse(raw))
    const firstHost = parseExecutionHostId(parsed.slots[0].executionHostId)?.id
    const secondHost = parseExecutionHostId(parsed.slots[1].executionHostId)?.id
    if (!firstHost || !secondHost || parsed.slots[0].worktreeId === parsed.slots[1].worktreeId) {
      return null
    }
    const slots: SplitLayout['slots'] = [
      { ...parsed.slots[0], executionHostId: firstHost },
      { ...parsed.slots[1], executionHostId: secondHost }
    ]
    return {
      layout: { slots, axis: parsed.axis, ratio: parsed.ratio },
      focus: slots[parsed.focused === 0 ? 0 : 1]
    }
  } catch {
    return null
  }
}
