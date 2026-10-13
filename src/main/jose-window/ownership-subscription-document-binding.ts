import type { WebContents } from 'electron'

const OWNERSHIP_SUBSCRIBE_METHOD = 'joseWindow.subscribe'

type DocumentLifecycleSender = Pick<WebContents, 'on' | 'removeListener'>

/**
 * The host counts a window as live while its ownership stream is open, so window 2's stream must
 * end with the renderer document that opened it: a crashed or reloaded renderer cannot answer a
 * reveal. Same events as the local path (desktop-runtime-sender-lifecycle.ts). Returns the unbind.
 */
export function bindOwnershipSubscriptionToDocument(
  method: string,
  sender: DocumentLifecycleSender,
  close: () => void
): () => void {
  if (method !== OWNERSHIP_SUBSCRIBE_METHOD) {
    return () => {}
  }
  sender.on('render-process-gone', close)
  sender.on('did-navigate', close)
  return () => {
    sender.removeListener('render-process-gone', close)
    sender.removeListener('did-navigate', close)
  }
}
