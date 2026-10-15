import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import { WindowOwnershipRegistry } from '../../src/main/jose-window/window-ownership-registry'
import type { JoseWindowClaimSetResult } from '../../src/shared/rpc-contract/jose-window-params'
import { createWindowClaimSetSession } from '../../src/renderer/src/jose-window/window-claim-set-session'
import {
  getWindowWorkspaceClaims,
  prepareWindowWorkspaceClaims
} from '../../src/renderer/src/jose-window/window-workspace-claims'
import type { WindowOwnershipDeps } from '../../src/renderer/src/jose-window/window-ownership-session'

const initial = useAppStore.getState()
const local = (worktreeId: string) => ({ worktreeId, executionHostId: 'local' as const })
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  useAppStore.setState(initial, true)
})

function harness() {
  useAppStore.setState({ activeWorktreeId: 'a', activeWorkspaceExecutionHostId: 'local' })
  const registry = new WindowOwnershipRegistry()
  const deps: WindowOwnershipDeps = {
    store: useAppStore,
    subscribe: async () => ({ unsubscribe: () => {} }),
    claim: async () => true,
    claimSet: vi.fn(async (_target, params) => registry.claimSet('desktop', params)),
    reveal: async () => true,
    raise: () => {},
    applyIntent: () => {},
    activateHere: () => true,
    isMissingMethod: () => false
  }
  const controller = createWindowClaimSetSession({
    target: { kind: 'local' },
    deps,
    settle: () => {},
    refuseOutside: () => {},
    accepted: () => {},
    refused: () => {}
  })
  const close = registry.subscribe('desktop', (frame) => {
    if (frame.type === 'snapshot') {
      controller.snapshot(frame)
    }
  })
  cleanups.push(() => {
    controller.stop()
    close()
  })
  return { controller, registry, deps }
}

describe('prepared workspace claims', () => {
  it('keeps both visible claims across focus and view changes and resumes singleton navigation after close', async () => {
    const h = harness()
    const opened = await prepareWindowWorkspaceClaims([local('a'), local('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    opened.commit()
    useAppStore.setState({ activeWorktreeId: 'b', activeView: 'settings' })
    h.controller.syncSelection()
    await flush()
    const before = [h.registry.liveOwnerOf(local('a')), h.registry.liveOwnerOf(local('b'))]
    useAppStore.setState({ activeWorktreeId: 'a' })
    const closed = await prepareWindowWorkspaceClaims([local('a')])
    if (closed.status !== 'accepted') {
      throw new Error('Expected survivor claim')
    }
    closed.commit()
    useAppStore.setState({ activeWorktreeId: 'c' })
    h.controller.syncSelection()
    await flush()
    expect({
      before,
      after: ['a', 'b', 'c'].map((id) => h.registry.liveOwnerOf(local(id)))
    }).toEqual({
      before: ['desktop', 'desktop'],
      after: [null, null, 'desktop']
    })
  })

  it('keeps the current pair when another window owns the replacement', async () => {
    const h = harness()
    const opened = await prepareWindowWorkspaceClaims([local('a'), local('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    opened.commit()
    const closeOther = h.registry.subscribe('other', () => {})
    cleanups.push(closeOther)
    h.registry.claim('other', local('c'))
    const refused = await prepareWindowWorkspaceClaims([local('a'), local('c')])
    expect({
      refused,
      owners: ['a', 'b', 'c'].map((id) => h.registry.liveOwnerOf(local(id)))
    }).toEqual({
      refused: { status: 'refused', blockedRefs: [local('c')] },
      owners: ['desktop', 'desktop', 'other']
    })
  })

  it('rolls an abandoned preparation back to the earlier accepted set', async () => {
    const h = harness()
    h.controller.syncSelection()
    await flush()
    const opened = await prepareWindowWorkspaceClaims([local('a'), local('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    await opened.rollback()
    expect(['a', 'b'].map((id) => h.registry.liveOwnerOf(local(id)))).toEqual(['desktop', null])
  })

  it('refuses the same raw workspace id on two execution hosts before claiming', async () => {
    const h = harness()
    const result = await prepareWindowWorkspaceClaims([
      local('a'),
      { worktreeId: 'a', executionHostId: 'ssh:box' }
    ])
    expect({ result, calls: vi.mocked(h.deps.claimSet!).mock.calls.length }).toMatchObject({
      result: { status: 'refused' },
      calls: 0
    })
  })

  it('does not authorize a layout with an answer from a disconnected ownership stream', async () => {
    const h = harness()
    let answer: ((result: JoseWindowClaimSetResult) => void) | undefined
    h.deps.claimSet = () =>
      new Promise((resolve) => {
        answer = resolve
      })
    const pending = prepareWindowWorkspaceClaims([local('a'), local('b')])
    await flush()
    h.controller.disconnect()
    answer?.({ claimed: true, revision: 1, ownedRefs: [local('a'), local('b')], blockedRefs: [] })
    expect({ result: await pending, state: getWindowWorkspaceClaims().status }).toMatchObject({
      result: { status: 'unverifiable' },
      state: 'unverifiable'
    })
  })

  it('keeps older hosts in the ordinary single-workspace path', async () => {
    const h = harness()
    h.controller.snapshot({ type: 'snapshot', ownedHere: 'a', ownedElsewhere: [] })
    expect({
      result: await prepareWindowWorkspaceClaims([local('a'), local('b')]),
      supported: h.controller.isSupported()
    }).toEqual({
      result: { status: 'unsupported', blockedRefs: [] },
      supported: false
    })
  })
})
