import { toast } from 'sonner'
import type { JoseWindowOpenWindowResult } from '../../../shared/rpc-contract/jose-window-params'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import { isMissingOwnershipMethod } from './window-ownership-client'

let loggedHostTooOld = false

/** New Window from a second window: the paired host opens it, so every window pairs to the host. */
export async function openWindowOnHost(
  target: RuntimeClientTarget
): Promise<JoseWindowOpenWindowResult | null> {
  try {
    return await callRuntimeRpc<JoseWindowOpenWindowResult>(
      target,
      'joseWindow.openWindow',
      {},
      { timeoutMs: 30_000 }
    )
  } catch (error) {
    if (isMissingOwnershipMethod(error)) {
      if (!loggedHostTooOld) {
        loggedHostTooOld = true
        console.info('[jose-window] host has no joseWindow.openWindow; it needs an update')
      }
      toast.error(
        translate(
          'menu.newOrcaWindowHostTooOld',
          'Update the main Orca window to open a new window from here.'
        )
      )
      return null
    }
    console.error('[jose-window] New Window on the host failed', error)
    toast.error(translate('menu.newOrcaWindowFailed', 'Could not open a new window.'))
    return null
  }
}

export function resetOpenWindowLogForTests(): void {
  loggedHostTooOld = false
}
