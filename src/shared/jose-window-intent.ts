import { z } from 'zod'
import { JoseWindowNavigationIntent } from './rpc-contract/jose-window-params'

/** Fork-only IPC: the owning window asks its own main process to deliver a redirected request to
 *  it on the UI event the request first arrived on, so the existing bridge handler applies it. */
export const JOSE_WINDOW_APPLY_INTENT_CHANNEL = 'joseWindow:applyIntent'

/** Tab ids are this window's own; `runtimeEnvironmentId` is how this window reaches the files. */
export const JoseWindowIntentRequest = z.object({
  worktreeId: z.string().min(1),
  runtimeEnvironmentId: z.string().min(1).optional(),
  intent: JoseWindowNavigationIntent
})
export type JoseWindowIntentRequest = z.infer<typeof JoseWindowIntentRequest>

/** The UI event (and payload) a request maps to; null for a plain workspace reveal. */
export function uiEventForIntent(
  request: JoseWindowIntentRequest
): { channel: string; payload: Record<string, unknown> } | null {
  const { worktreeId, runtimeEnvironmentId, intent } = request
  switch (intent.kind) {
    case 'workspace':
      return null
    case 'file':
      return {
        channel: 'ui:openFileFromMobile',
        payload: {
          worktreeId,
          filePath: intent.filePath,
          relativePath: intent.relativePath,
          runtimeEnvironmentId,
          ...(intent.preview ? { preview: true } : {})
        }
      }
    case 'diff':
      return {
        channel: 'ui:openDiffFromMobile',
        payload: {
          worktreeId,
          filePath: intent.filePath,
          relativePath: intent.relativePath,
          staged: intent.staged,
          runtimeEnvironmentId
        }
      }
    case 'terminal':
      return {
        channel: 'ui:focusTerminal',
        payload: {
          worktreeId,
          tabId: intent.tabId,
          leafId: intent.leafId,
          ...(intent.flashFocusedPane ? { flashFocusedPane: true } : {}),
          ...(intent.scrollToBottomIfOutputSinceLastView
            ? { scrollToBottomIfOutputSinceLastView: true }
            : {})
        }
      }
    case 'tab':
      return {
        channel: 'ui:focusEditorTab',
        payload: {
          worktreeId,
          tabId: intent.tabId,
          ...(intent.userInitiated ? { userInitiated: true } : {})
        }
      }
  }
}
