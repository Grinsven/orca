import type { RaiseOwnWindowResult } from '../../../shared/jose-window-raise'
import type { JoseWindowIntentRequest } from '../../../shared/jose-window-intent'

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    /** Fork preload bridge (src/preload/jose-window-bridge.ts); absent in the web client. */
    joseWindow?: {
      isSecondWindow?: boolean
      raise?: () => Promise<RaiseOwnWindowResult>
      applyIntent?: (request: JoseWindowIntentRequest) => Promise<boolean>
      onOpenWindowRequest?: (callback: () => void) => () => void
    }
  }
}

/** True only in an Orca started by Window > New Window, i.e. running on a `-window-N` slot profile.
 *  The host window and an ordinary paired desktop or web client all read false. */
export function isSecondaryWindow(): boolean {
  return typeof window !== 'undefined' && window.joseWindow?.isSecondWindow === true
}
