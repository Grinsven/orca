import '../runtime/rpc/unused-default-rpc-methods.test-fixture'
import { afterEach, describe, expect, it } from 'vitest'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import type { RpcDispatchStreamingOptions } from '../runtime/rpc/dispatcher-stream-options'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import { JOSE_WINDOW_METHODS } from './window-ownership-rpc-methods'

const runtime = new OrcaRuntimeService()
const rpc = new RpcDispatcher({ runtime, methods: JOSE_WINDOW_METHODS })

const HOST: RpcDispatchStreamingOptions = { caller: { kind: 'desktop' }, connectionId: 'ipc-1' }
const WINDOW_2: RpcDispatchStreamingOptions = {
  pairedDeviceId: 'window-2',
  clientKind: 'runtime',
  connectionId: 'ws-2'
}

afterEach(() => {
  runtime.cleanupSubscriptionsForConnection('ipc-1')
  runtime.cleanupSubscriptionsForConnection('ws-2')
})

function subscribe(options: RpcDispatchStreamingOptions): unknown[] {
  const frames: unknown[] = []
  void rpc.dispatchStreaming(
    { id: 'sub', authToken: 't', method: 'joseWindow.subscribe' },
    (response) => {
      const parsed: { ok: boolean; result?: unknown; error?: unknown } = JSON.parse(response)
      frames.push(parsed.ok ? parsed.result : { error: parsed.error })
    },
    options
  )
  return frames
}

async function call(method: string, params: unknown, options?: RpcDispatchStreamingOptions) {
  return rpc.dispatch({ id: 'c', authToken: 't', method, params }, options)
}

describe('joseWindow RPC methods', () => {
  it('keys windows by caller identity and refuses a claim on the other window worktree', async () => {
    const hostFrames = subscribe(HOST)
    subscribe(WINDOW_2)

    expect(await call('joseWindow.claim', { worktreeId: 'wt-a' }, HOST)).toMatchObject({
      ok: true,
      result: { claimed: true }
    })
    expect(await call('joseWindow.claim', { worktreeId: 'wt-a' }, WINDOW_2)).toMatchObject({
      ok: true,
      result: { claimed: false }
    })
    expect(await call('joseWindow.reveal', { worktreeId: 'wt-a' }, WINDOW_2)).toMatchObject({
      ok: true,
      result: { revealed: true }
    })
    expect(hostFrames).toContainEqual({ type: 'reveal', worktreeId: 'wt-a' })
  })

  it('releases a window claim when its connection closes', async () => {
    subscribe(HOST)
    const window2Frames = subscribe(WINDOW_2)
    await call('joseWindow.claim', { worktreeId: 'wt-b' }, WINDOW_2)

    runtime.cleanupSubscriptionsForConnection('ws-2')
    await Promise.resolve()

    expect(window2Frames.at(-1)).toEqual({ type: 'end' })
    expect(await call('joseWindow.claim', { worktreeId: 'wt-b' }, HOST)).toMatchObject({
      result: { claimed: true }
    })
  })

  it('ends the stream when the subscriber aborts it', async () => {
    const controller = new AbortController()
    const frames = subscribe({ ...HOST, signal: controller.signal })
    await call('joseWindow.claim', { worktreeId: 'wt-c' }, HOST)
    controller.abort()
    await Promise.resolve()
    expect(frames.at(-1)).toEqual({ type: 'end' })
    subscribe(WINDOW_2)
    expect(await call('joseWindow.claim', { worktreeId: 'wt-c' }, WINDOW_2)).toMatchObject({
      result: { claimed: true }
    })
  })

  it('gives the orca CLI no window', async () => {
    expect(await call('joseWindow.claim', { worktreeId: 'wt-a' })).toMatchObject({ ok: false })
  })
})
