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
import { isOwnedByAnotherWindow } from '../../src/renderer/src/jose-window/ownership-guard'
import type { OwnershipSubscriptionCallbacks } from '../../src/renderer/src/jose-window/window-ownership-client'
import {
  afterOwnershipClaim,
  deferredUntilOwnershipClaim
} from '../../src/renderer/src/jose-window/ownership-claim-gate'
import { isWindowWorkspaceCreationBlocked } from '../../src/renderer/src/jose-window/window-workspace-admission'

const initial = useAppStore.getState()
const local = (worktreeId: string) => ({ worktreeId, executionHostId: 'local' as const })
const remote = (worktreeId: string) => ({ worktreeId, executionHostId: 'runtime:paired' as const })
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  useAppStore.setState(initial, true)
})

function harness(legacyRemote = false) {
  useAppStore.setState({ activeWorktreeId: 'a', activeWorkspaceExecutionHostId: 'local' })
  const registry = new WindowOwnershipRegistry()
  const remoteRegistry = new WindowOwnershipRegistry()
  const remoteOwner = 'paired-device:this-window'
  let remoteCallbacks: OwnershipSubscriptionCallbacks | null = null
  let closeRemote = (): void => {}
  const deps: WindowOwnershipDeps = {
    store: useAppStore,
    subscribe: async (target, callbacks) => {
      if (target.kind !== 'environment') {
        throw new Error('Expected remote authority')
      }
      if (legacyRemote) {
        callbacks.onFrame({ type: 'snapshot', ownedHere: null, ownedElsewhere: [] })
        return { unsubscribe: () => {} }
      }
      remoteCallbacks = callbacks
      closeRemote = remoteRegistry.subscribe(remoteOwner, callbacks.onFrame)
      return { unsubscribe: closeRemote }
    },
    claim: async () => true,
    claimSet: vi.fn(async (target, params) =>
      target.kind === 'local'
        ? registry.claimSet('desktop', params)
        : remoteRegistry.claimSet(remoteOwner, params)
    ),
    reveal: vi.fn(async () => true),
    raise: vi.fn(),
    applyIntent: () => {},
    activateHere: (worktreeId, executionHostId) => {
      useAppStore.setState({
        activeWorktreeId: worktreeId,
        activeWorkspaceExecutionHostId: executionHostId ?? null
      })
      return true
    },
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
  const connectPrimary = () =>
    registry.subscribe('desktop', (frame) => {
      if (frame.type === 'snapshot') {
        controller.snapshot(frame)
      }
    })
  let close = connectPrimary()
  cleanups.push(() => {
    controller.stop()
    close()
  })
  return {
    controller,
    registry,
    remoteRegistry,
    remoteOwner,
    deps,
    disconnectPrimary: () => {
      close()
      controller.disconnect()
    },
    reconnectPrimary: () => {
      close = connectPrimary()
    },
    disconnectRemote: () => {
      closeRemote()
      remoteCallbacks?.onClose()
    }
  }
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

describe('claims across runtime authorities', () => {
  it('keeps local and paired claims while either group has focus and releases the removed authority', async () => {
    const h = harness()
    const opened = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    opened.commit()
    useAppStore.setState({
      activeWorktreeId: 'b',
      activeWorkspaceExecutionHostId: 'runtime:paired'
    })
    h.controller.syncSelection()
    await flush()
    const before = [h.registry.liveOwnerOf(local('a')), h.remoteRegistry.liveOwnerOf(local('b'))]
    useAppStore.setState({ activeWorktreeId: 'a', activeWorkspaceExecutionHostId: 'local' })
    const closed = await prepareWindowWorkspaceClaims([local('a')])
    if (closed.status !== 'accepted') {
      throw new Error('Expected close claim')
    }
    closed.commit()
    expect({
      before,
      remoteAfter: h.remoteRegistry.liveOwnerOf(local('b')),
      snapshot: getWindowWorkspaceClaims().ownedRefs
    }).toEqual({
      before: ['desktop', h.remoteOwner],
      remoteAfter: null,
      snapshot: [local('a')]
    })
  })

  it('rolls back local additions when the paired authority refuses the second group', async () => {
    const h = harness()
    h.controller.syncSelection()
    await flush()
    cleanups.push(h.remoteRegistry.subscribe('other', () => {}))
    h.remoteRegistry.claim('other', local('b'))
    const result = await prepareWindowWorkspaceClaims([local('c'), remote('b')])
    expect({
      result,
      localA: h.registry.liveOwnerOf(local('a')),
      localC: h.registry.liveOwnerOf(local('c')),
      remoteB: h.remoteRegistry.liveOwnerOf(local('b'))
    }).toMatchObject({
      result: { status: 'refused', blockedRefs: [remote('b')] },
      localA: 'desktop',
      localC: null,
      remoteB: 'other'
    })
  })

  it('acquires the new authority before releasing a currently visible local group', async () => {
    const h = harness()
    const first = await prepareWindowWorkspaceClaims([local('a'), local('b')])
    if (first.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    first.commit()
    vi.mocked(h.deps.claimSet!).mockClear()
    const second = await prepareWindowWorkspaceClaims([local('a'), remote('c')])
    const calls = vi.mocked(h.deps.claimSet!).mock.calls.map(([target, params]) => ({
      target: target.kind,
      refs: params.worktrees.map((ref) => ref.worktreeId)
    }))
    if (second.status !== 'accepted') {
      throw new Error('Expected replacement claim')
    }
    second.commit()
    expect(calls).toEqual([
      { target: 'environment', refs: ['c'] },
      { target: 'local', refs: ['a'] }
    ])
  })

  it('reveals an unfocused group through its own runtime authority', async () => {
    const h = harness()
    const opened = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    opened.commit()
    h.remoteRegistry.reveal('other', local('b'))
    expect({
      active: useAppStore.getState().activeWorktreeId,
      host: useAppStore.getState().activeWorkspaceExecutionHostId,
      raised: vi.mocked(h.deps.raise).mock.calls.length,
      localOwner: h.registry.liveOwnerOf(local('a'))
    }).toEqual({
      active: 'b',
      host: 'runtime:paired',
      raised: 1,
      localOwner: 'desktop'
    })
  })

  it('keeps other-window guards in their own runtime namespace', async () => {
    const h = harness()
    cleanups.push(h.remoteRegistry.subscribe('other', () => {}))
    h.remoteRegistry.claim('other', local('c'))
    const opened = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    opened.commit()
    expect({
      local: isOwnedByAnotherWindow('c', { executionHostId: 'local' }),
      remote: isOwnedByAnotherWindow('c', { executionHostId: 'runtime:paired' })
    }).toEqual({ local: false, remote: true })
  })

  it('refuses an old paired host without releasing the current local selection', async () => {
    const h = harness(true)
    h.controller.syncSelection()
    await flush()
    const result = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
    expect({ result, owner: h.registry.liveOwnerOf(local('a')) }).toMatchObject({
      result: { status: 'unsupported' },
      owner: 'desktop'
    })
  })
})

describe('ownership transition recovery', () => {
  it('keeps a reconnected empty authority unconfirmed until its reclaim executes', async () => {
    const h = harness()
    const opened = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    opened.commit()
    await flush()
    const claim = h.deps.claimSet!
    let execute: (() => Promise<void>) | undefined
    h.deps.claimSet = (target, params) =>
      target.kind === 'environment'
        ? new Promise((resolve) => {
            execute = async () => resolve(await claim(target, params))
          })
        : claim(target, params)
    h.disconnectRemote()
    await flush()
    const before = getWindowWorkspaceClaims().status
    if (!execute) {
      throw new Error('Expected deferred reclaim')
    }
    await execute()
    await flush()
    expect({
      before,
      after: getWindowWorkspaceClaims().status,
      owner: h.remoteRegistry.liveOwnerOf(local('b'))
    }).toEqual({
      before: 'unverifiable',
      after: 'ready',
      owner: h.remoteOwner
    })
  })

  it('keeps a failed commit rollbackable after its subscription changes', async () => {
    const h = harness()
    h.controller.syncSelection()
    await flush()
    const prepared = await prepareWindowWorkspaceClaims([local('a'), local('b')])
    if (prepared.status !== 'accepted') {
      throw new Error('Expected preparation')
    }
    h.disconnectPrimary()
    h.reconnectPrimary()
    let rejected = false
    try {
      prepared.commit()
    } catch {
      rejected = true
    }
    await prepared.rollback()
    await flush()
    expect({
      rejected,
      a: h.registry.liveOwnerOf(local('a')),
      b: h.registry.liveOwnerOf(local('b'))
    }).toEqual({
      rejected: true,
      a: 'desktop',
      b: null
    })
  })

  it('rejects a transition when an earlier authority disconnects during the final release', async () => {
    const h = harness()
    const opened = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    opened.commit()
    await flush()
    const claim = h.deps.claimSet!
    let finish: (() => void) | undefined
    h.deps.claimSet = async (target, params) => {
      const result = await claim(target, params)
      if (
        target.kind === 'environment' &&
        params.worktrees.length === 1 &&
        params.worktrees[0]?.worktreeId === 'c'
      ) {
        await new Promise<void>((resolve) => {
          finish = resolve
        })
      }
      return result
    }
    const pending = prepareWindowWorkspaceClaims([local('a'), remote('c')])
    await flush()
    if (!finish) {
      throw new Error('Expected deferred final release')
    }
    h.disconnectPrimary()
    finish()
    const result = await pending
    expect({
      status: result.status,
      primary: h.registry.liveOwnerOf(local('a')),
      remote: h.remoteRegistry.liveOwnerOf(local('b'))
    }).toEqual({
      status: 'unverifiable',
      primary: null,
      remote: h.remoteOwner
    })
  })

  it('keeps the owned survivor after a reconnect refusal and stops repeating the refused pair', async () => {
    const h = harness()
    const opened = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    opened.commit()
    useAppStore.setState({
      activeWorktreeId: 'b',
      activeWorkspaceExecutionHostId: 'runtime:paired'
    })
    await flush()
    cleanups.push(h.remoteRegistry.subscribe('other', () => {}))
    const calls = vi.mocked(h.deps.claimSet!)
    calls.mockClear()
    h.disconnectRemote()
    h.remoteRegistry.claim('other', local('b'))
    await flush()
    const afterRefusal = calls.mock.calls.length
    h.controller.syncSelection()
    await flush()
    h.controller.syncSelection()
    await flush()
    expect({
      active: useAppStore.getState().activeWorktreeId,
      host: useAppStore.getState().activeWorkspaceExecutionHostId,
      afterRefusal,
      afterSync: calls.mock.calls.length,
      owner: h.registry.liveOwnerOf(local('a'))
    }).toEqual({
      active: 'a',
      host: 'local',
      afterRefusal: 2,
      afterSync: 2,
      owner: 'desktop'
    })
  })

  it('restores an ancillary singleton and reveals the winner when navigation loses a claim race', async () => {
    const h = harness()
    const opened = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
    if (opened.status !== 'accepted') {
      throw new Error('Expected split claim')
    }
    opened.commit()
    useAppStore.setState({
      activeWorktreeId: 'b',
      activeWorkspaceExecutionHostId: 'runtime:paired'
    })
    const closed = await prepareWindowWorkspaceClaims([remote('b')])
    if (closed.status !== 'accepted') {
      throw new Error('Expected singleton claim')
    }
    closed.commit()
    await flush()
    cleanups.push(h.remoteRegistry.subscribe('other', () => {}))
    h.remoteRegistry.claim('other', local('c'))
    useAppStore.setState({
      activeWorktreeId: 'c',
      activeWorkspaceExecutionHostId: 'runtime:paired'
    })
    h.controller.syncSelection()
    await flush()
    expect({
      active: useAppStore.getState().activeWorktreeId,
      host: useAppStore.getState().activeWorkspaceExecutionHostId,
      reveal: vi.mocked(h.deps.reveal).mock.calls,
      owner: h.remoteRegistry.liveOwnerOf(local('b'))
    }).toEqual({
      active: 'b',
      host: 'runtime:paired',
      reveal: [[{ kind: 'environment', environmentId: 'paired' }, local('c')]],
      owner: h.remoteOwner
    })
  })
})

describe('visible workspace creation admission', () => {
  it.each([true, false])(
    'resumes automatic seeding only after an accepted ancillary reclaim: %s',
    async (accepted) => {
      const h = harness()
      const opened = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
      if (opened.status !== 'accepted') {
        throw new Error('Expected split claim')
      }
      opened.commit()
      await flush()
      const claim = h.deps.claimSet!
      let execute: (() => Promise<void>) | undefined
      let deferredOnce = false
      h.deps.claimSet = (target, params) => {
        if (target.kind === 'environment' && !deferredOnce) {
          deferredOnce = true
          return new Promise((resolve) => {
            execute = async () => resolve(await claim(target, params))
          })
        }
        return claim(target, params)
      }
      h.disconnectRemote()
      await flush()
      const seed = vi.fn(async () => 'seeded')
      const wake = vi.fn()
      const pending = afterOwnershipClaim('b', 'runtime:paired', seed, 'refused')
      const deferred = deferredUntilOwnershipClaim('b', wake)
      const before = {
        seed: seed.mock.calls.length,
        wake: wake.mock.calls.length,
        blocked: isWindowWorkspaceCreationBlocked('b', 'runtime:paired'),
        otherHost: isWindowWorkspaceCreationBlocked('b', 'local'),
        ordinary: isWindowWorkspaceCreationBlocked('ordinary', 'runtime:paired')
      }
      if (!accepted) {
        cleanups.push(h.remoteRegistry.subscribe('other', () => {}))
        h.remoteRegistry.claim('other', local('b'))
      }
      if (!execute) {
        throw new Error('Expected deferred reclaim')
      }
      await execute()
      await flush()
      expect({
        before,
        deferred,
        outcome: await pending,
        seed: seed.mock.calls.length,
        wake: wake.mock.calls.length
      }).toEqual({
        before: { seed: 0, wake: 0, blocked: true, otherHost: false, ordinary: false },
        deferred: true,
        outcome: accepted ? 'seeded' : 'refused',
        seed: accepted ? 1 : 0,
        wake: accepted ? 1 : 0
      })
    }
  )

  it.each(['removed', 'stopped'] as const)(
    'does not seed after a waiting workspace is %s',
    async (end) => {
      const h = harness()
      const opened = await prepareWindowWorkspaceClaims([local('a'), remote('b')])
      if (opened.status !== 'accepted') {
        throw new Error('Expected split claim')
      }
      opened.commit()
      await flush()
      h.disconnectRemote()
      const seed = vi.fn(async () => 'seeded')
      const wake = vi.fn()
      const pending = afterOwnershipClaim('b', 'runtime:paired', seed, 'refused')
      deferredUntilOwnershipClaim('b', wake)
      if (end === 'stopped') {
        h.controller.stop()
      } else {
        const closed = await prepareWindowWorkspaceClaims([local('a')])
        if (closed.status !== 'accepted') {
          throw new Error('Expected survivor claim')
        }
        closed.commit()
      }
      await flush()
      expect({
        outcome: await pending,
        seed: seed.mock.calls.length,
        wake: wake.mock.calls.length
      }).toEqual({
        outcome: 'refused',
        seed: 0,
        wake: 0
      })
    }
  )
})
