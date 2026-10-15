import type { GitStatusResult } from '../../../../shared/git-status-types'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'

export type GitChangeCount = { count: number; partial: boolean }

export function countChangedFiles(status: GitStatusResult): GitChangeCount {
  return {
    count: new Set(status.entries.map((entry) => entry.path)).size,
    partial: status.didHitLimit === true
  }
}

export function gitChangeCountKey(context: RuntimeGitContext): string {
  return JSON.stringify([
    context.target.kind === 'environment' ? context.target.environmentId : null,
    context.connectionId ?? null,
    context.worktreeId,
    context.worktreePath
  ])
}

export function formatGitChangeCount(value: GitChangeCount | null): string | null {
  if (!value) {
    return null
  }
  if (value.count > 99) {
    return '99+'
  }
  if (value.partial) {
    return '…'
  }
  return value.count > 0 ? String(value.count) : null
}

export function describeGitChangeCount(value: GitChangeCount | null): string {
  if (!value) {
    return ''
  }
  if (value.partial) {
    return `minstens ${value.count} gewijzigde bestanden, telling onvolledig`
  }
  return `${value.count} ${value.count === 1 ? 'gewijzigd bestand' : 'gewijzigde bestanden'}`
}
