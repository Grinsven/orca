import type { GitStatusResult } from '../../../../shared/git-status-types'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'

export type GitChangeCount = { count: number; partial: boolean }

export function countChangedFiles(status: GitStatusResult): GitChangeCount {
  return {
    // VS Code sums SCM groups: a partially staged path contributes to both groups.
    count: status.entries.length,
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
  if (value.count > 999) {
    const thousands = Math.floor(value.count / 1000)
    return `${thousands}K${value.count % 1000 === 0 ? '' : '+'}`
  }
  return value.count > 0 ? String(value.count) : null
}

export function describeGitChangeCount(value: GitChangeCount | null): string {
  if (!value) {
    return ''
  }
  if (value.partial) {
    return `minstens ${value.count} wijzigingen, telling onvolledig`
  }
  return `${value.count} ${value.count === 1 ? 'wijziging' : 'wijzigingen'}`
}
