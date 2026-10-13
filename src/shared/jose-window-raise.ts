/** Fork-only IPC: a window asks its own main process to bring it to the front. */
export const JOSE_WINDOW_RAISE_CHANNEL = 'joseWindow:raise'

export type RaiseOwnWindowResult = 'raised' | 'background-launch' | 'no-window'
