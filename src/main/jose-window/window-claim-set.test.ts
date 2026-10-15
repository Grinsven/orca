import { describe, expect, it } from 'vitest'
import type {
  JoseWindowOwnershipFrame,
  JoseWindowWorktreeRef
} from '../../shared/rpc-contract/jose-window-params'
import { WindowOwnershipRegistry } from './window-ownership-registry'

const local = (worktreeId: string): JoseWindowWorktreeRef => ({
  worktreeId,
  executionHostId: 'local'
})
function connect(registry: WindowOwnershipRegistry, windowKey: string) {
  const frames: JoseWindowOwnershipFrame[] = []
  const close = registry.subscribe(windowKey, (frame) => frames.push(frame))
  const snapshot = frames[0]
  if (snapshot?.type !== 'snapshot' || !snapshot.claimSetSessionId) {
    throw new Error('Missing claim session')
  }
  const sessionId = snapshot.claimSetSessionId
  return {
    close,
    frames,
    claim: (revision: number, ...worktrees: JoseWindowWorktreeRef[]) =>
      registry.claimSet(windowKey, { sessionId, revision, worktrees })
  }
}

describe('atomic window claim sets', () => {
  it('preserves the whole accepted set when a replacement conflicts', () => {
    const registry = new WindowOwnershipRegistry()
    const first = connect(registry, 'first')
    const second = connect(registry, 'second')
    first.claim(1, local('a'), local('b'))
    second.claim(1, local('c'))
    const refused = first.claim(2, local('a'), local('c'))
    expect({
      refused,
      a: registry.liveOwnerOf(local('a')),
      b: registry.liveOwnerOf(local('b'))
    }).toMatchObject({
      refused: {
        claimed: false,
        reason: 'conflict',
        ownedRefs: [local('a'), local('b')],
        blockedRefs: [local('c')]
      },
      a: 'first',
      b: 'first'
    })
  })

  it('rejects an older request after the split has closed and replays the current request', () => {
    const registry = new WindowOwnershipRegistry()
    const first = connect(registry, 'first')
    first.claim(1, local('a'), local('b'))
    const closed = first.claim(3, local('a'))
    expect({
      stale: first.claim(2, local('a'), local('b')),
      replay: first.claim(3, local('a')),
      closed,
      b: registry.liveOwnerOf(local('b'))
    }).toMatchObject({
      stale: { claimed: false, reason: 'stale', ownedRefs: [local('a')] },
      replay: closed,
      b: null
    })
  })

  it('fences the disconnected document and releases both workspaces', () => {
    const registry = new WindowOwnershipRegistry()
    const old = connect(registry, 'first')
    old.claim(1, local('a'), local('b'))
    old.close()
    const next = connect(registry, 'first')
    next.claim(1, local('c'))
    expect({
      stale: old.claim(99, local('a'), local('b')),
      a: registry.liveOwnerOf(local('a')),
      b: registry.liveOwnerOf(local('b')),
      c: registry.liveOwnerOf(local('c'))
    }).toMatchObject({
      stale: { claimed: false, reason: 'stale' },
      a: null,
      b: null,
      c: 'first'
    })
  })

  it('publishes both refs to legacy readers and reveals either owned workspace', () => {
    const registry = new WindowOwnershipRegistry()
    const first = connect(registry, 'first')
    const second = connect(registry, 'second')
    first.claim(1, local('a'), local('b'))
    const snapshot = second.frames.at(-1)
    registry.reveal('second', local('b'))
    expect({
      snapshot,
      reveal: first.frames.at(-1),
      legacy: registry.claim('second', local('b'))
    }).toMatchObject({
      snapshot: {
        type: 'snapshot',
        ownedElsewhere: ['a', 'b'],
        ownedElsewhereRefs: [local('a'), local('b')]
      },
      reveal: { type: 'reveal', ...local('b') },
      legacy: { claimed: false }
    })
  })

  it('refuses duplicate or oversized sets without releasing an accepted workspace', () => {
    const registry = new WindowOwnershipRegistry()
    const first = connect(registry, 'first')
    first.claim(1, local('a'))
    expect({
      duplicate: first.claim(2, local('b'), local('b')),
      oversized: first.claim(3, local('a'), local('b'), local('c')),
      owner: registry.liveOwnerOf(local('a'))
    }).toMatchObject({
      duplicate: { claimed: false, reason: 'invalid' },
      oversized: { claimed: false, reason: 'invalid' },
      owner: 'first'
    })
  })
})
