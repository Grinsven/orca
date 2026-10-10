import { toast } from 'sonner'
import { openWorkspaceFilePreview } from '@/lib/workspace-file-preview-open'
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
  navigation?: RuntimeNavigationTarget
}): boolean {
  // Why: same rule as editor opens; no target (older callers) keeps the original switch.
  const focus = payload.navigation === undefined || navigationTargetsHost(payload.navigation)
  const result = openWorkspaceFilePreview({
    filePath: payload.filePath,
    worktreeId: payload.worktreeId,
    focus
  })
  if (result.status === 'unsupported') {
    toast.error(result.message)
    return false
  }
  return true
}
