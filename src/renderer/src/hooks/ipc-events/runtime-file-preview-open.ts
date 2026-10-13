import { toast } from 'sonner'
import { openWorkspaceFilePreview } from '@/lib/workspace-file-preview-open'
import { redirectIfOwnedElsewhere } from '@/jose-window/ownership-guard'
import type { JoseWindowNavigationIntent } from '../../../../shared/rpc-contract/jose-window-params'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import {
  navigationTargetsHost,
  type RuntimeNavigationTarget
} from '../../../../shared/runtime-navigation'

/**
 * Opens a `files.open --preview` request as a rendered page. Returns false when the preview
 * cannot render here, after telling the user why, so the caller opens the source instead.
 */
export function openRuntimeFilePreview(payload: {
  worktreeId: string
  filePath: string
  relativePath: string
  navigation?: RuntimeNavigationTarget
  executionHostId?: ExecutionHostId
}): boolean {
  // Why: same rule as editor opens; no target (older callers) keeps the original switch.
  const focus = payload.navigation === undefined || navigationTargetsHost(payload.navigation)
  const { worktreeId, filePath, relativePath, executionHostId } = payload
  const intent: JoseWindowNavigationIntent = { kind: 'file', filePath, relativePath, preview: true }
  if (focus && redirectIfOwnedElsewhere(worktreeId, { intent, executionHostId })) {
    return true
  }
  const result = openWorkspaceFilePreview({
    filePath: payload.filePath,
    worktreeId: payload.worktreeId,
    focus,
    executionHostId
  })
  if (result.status === 'unsupported') {
    toast.error(result.message)
    return false
  }
  return true
}
