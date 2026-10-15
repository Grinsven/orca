import type { ExecutionHostId } from '../../../shared/execution-host'
import type { WindowWorkspaceRef } from './window-workspace-claims'

export const CLAIM_WAIT_DEADLINE_MS = 60_000
export type WorkspaceAdmission = {
  ref: WindowWorkspaceRef
  status: 'owned' | 'pending' | 'refused'
}
type AdmissionReader = () => readonly WorkspaceAdmission[]
type Waiter = { ref: WindowWorkspaceRef; settle: (accepted: boolean) => void }
let readAdmission: AdmissionReader | null = null
const waiters = new Set<Waiter>()
const matches = (a: WindowWorkspaceRef, b: WindowWorkspaceRef): boolean =>
  a.worktreeId === b.worktreeId && a.executionHostId === b.executionHostId

function admissionFor(
  worktreeId: string,
  executionHostId?: ExecutionHostId | null
): WorkspaceAdmission | undefined {
  return readAdmission?.().find(
    (entry) =>
      entry.ref.worktreeId === worktreeId &&
      (!executionHostId || entry.ref.executionHostId === executionHostId)
  )
}

/** Manual actions are refused while a participating visible workspace lacks an accepted claim. */
export function isWindowWorkspaceCreationBlocked(
  worktreeId: string,
  executionHostId?: ExecutionHostId | null
): boolean {
  const admission = admissionFor(worktreeId, executionHostId)
  return admission !== undefined && admission.status !== 'owned'
}

/** Undefined leaves ordinary workspaces on their existing ownership gate. */
export function pendingWindowWorkspaceAdmission(
  worktreeId: string,
  executionHostId?: ExecutionHostId | null
): Promise<boolean> | null | undefined {
  const admission = admissionFor(worktreeId, executionHostId)
  if (!admission) {
    return undefined
  }
  if (admission.status === 'owned') {
    return null
  }
  if (admission.status === 'refused') {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    const waiter: Waiter = {
      ref: admission.ref,
      settle: (accepted) => {
        clearTimeout(deadline)
        waiters.delete(waiter)
        resolve(accepted)
      }
    }
    const deadline = setTimeout(() => waiter.settle(false), CLAIM_WAIT_DEADLINE_MS)
    waiters.add(waiter)
  })
}

export function bindWindowWorkspaceAdmission(read: AdmissionReader): {
  refresh: () => void
  stop: () => void
} {
  waiters.forEach((waiter) => waiter.settle(false))
  readAdmission = read
  return {
    refresh: () => {
      if (readAdmission !== read) {
        return
      }
      const admissions = read()
      waiters.forEach((waiter) => {
        const next = admissions.find((entry) => matches(entry.ref, waiter.ref))
        if (!next || next.status !== 'pending') {
          waiter.settle(next?.status === 'owned')
        }
      })
    },
    stop: () => {
      if (readAdmission !== read) {
        return
      }
      waiters.forEach((waiter) => waiter.settle(false))
      readAdmission = null
    }
  }
}
