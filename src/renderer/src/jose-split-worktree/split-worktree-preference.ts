import { useEffect } from 'react'
import { create } from 'zustand'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { subscribeRuntimeEnvironment } from '@/runtime/runtime-environment-pairing-refresh'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { resolveOwnershipTarget } from '@/jose-window/window-ownership-client'
import { JoseWindowSplitPreference } from '../../../shared/rpc-contract/jose-window-params'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'

export const useSplitPreference = create(() => ({ enabled: true, ready: false, pending: false }))
let target: RuntimeClientTarget | null = null

export function splitWorkspaceDragEnabled(): boolean {
  const state = useSplitPreference.getState()
  return state.ready && state.enabled
}

export async function setSplitWorkspaceDragEnabled(enabled: boolean): Promise<void> {
  const current = target
  if (!current || useSplitPreference.getState().pending) {
    return
  }
  useSplitPreference.setState({ pending: true })
  try {
    const result = await callRuntimeRpc(current, 'joseWindow.splitPreference.set', { enabled })
    const parsed = JoseWindowSplitPreference.parse(result)
    if (target === current) {
      useSplitPreference.setState({ enabled: parsed.enabled })
    }
  } catch {
    toast.error('Could not save the workspace drag setting.')
  } finally {
    if (target === current) {
      useSplitPreference.setState({ pending: false })
    }
  }
}

/** Reads the preference from the same host that coordinates this window's ownership. */
export function useSplitPreferenceConnection(): void {
  const environmentId = useAppStore((state) => {
    const owner = resolveOwnershipTarget(state.settings)
    return owner === null ? undefined : owner.kind === 'local' ? null : owner.environmentId
  })
  useEffect(() => {
    if (environmentId === undefined) {
      return
    }
    const current: RuntimeClientTarget =
      environmentId === null ? { kind: 'local' } : { kind: 'environment', environmentId }
    return connectSplitPreference(current)
  }, [environmentId])
}

function connectSplitPreference(current: RuntimeClientTarget): () => void {
  target = current
  let disposed = false
  let stop: (() => void) | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  useSplitPreference.setState({ enabled: true, ready: false, pending: false })
  const receive = (response: RuntimeRpcResponse<unknown>): void => {
    if (disposed || !response.ok) {
      return
    }
    const parsed = JoseWindowSplitPreference.safeParse(response.result)
    if (parsed.success) {
      useSplitPreference.setState({ enabled: parsed.data.enabled, ready: true })
    }
  }
  const disconnected = (): void => {
    if (disposed) {
      return
    }
    useSplitPreference.setState({ ready: false })
    stop?.()
    stop = undefined
    clearTimeout(retry)
    retry = setTimeout(() => void connect(), 1_000)
  }
  const connect = async (): Promise<void> => {
    try {
      const subscription =
        current.kind === 'local'
          ? await window.api.runtime.subscribe(
              { method: 'joseWindow.splitPreference.subscribe' },
              receive
            )
          : await subscribeRuntimeEnvironment(
              {
                selector: current.environmentId,
                method: 'joseWindow.splitPreference.subscribe',
                expectedEnvironmentPairingRevision: getRuntimeEnvironmentRevision(
                  current.environmentId
                )
              },
              { onResponse: receive, onError: disconnected, onClose: disconnected }
            )
      if (disposed) {
        subscription.unsubscribe()
      } else {
        stop = subscription.unsubscribe
      }
    } catch {
      disconnected()
    }
  }
  void connect()
  return () => {
    disposed = true
    clearTimeout(retry)
    stop?.()
    if (target === current) {
      target = null
    }
  }
}
