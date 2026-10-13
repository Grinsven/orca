import { describe, expect, it, vi, type Mock } from 'vitest'
import type { JoseWindowOwnershipFrame } from '../../shared/rpc-contract/jose-window-params'
import { WindowOwnershipRegistry, windowKeyForCaller } from './window-ownership-registry'

const W1 = 'desktop'
const W2 = 'paired-device:window-2'

type Emit = Mock<(frame: JoseWindowOwnershipFrame) => void>
const newEmit = (): Emit => vi.fn<(frame: JoseWindowOwnershipFrame) => void>()

function lastSnapshot(emit: Emit): JoseWindowOwnershipFrame | undefined {
  return emit.mock.calls.map(([frame]) => frame).findLast((frame) => frame.type === 'snapshot')
}

describe('windowKeyForCaller', () => {
  it('names the host window and a paired window, and no window for the CLI', () => {
    expect(windowKeyForCaller({ kind: 'desktop' })).toBe('desktop')
    expect(windowKeyForCaller({ kind: 'paired-device', deviceId: 'd1' })).toBe('paired-device:d1')
    expect(windowKeyForCaller({ kind: 'local-cli' })).toBeNull()
    expect(windowKeyForCaller(undefined)).toBeNull()
  })
})

describe('WindowOwnershipRegistry', () => {
  it('lets a window claim a free worktree and shows it to the other window only', () => {
    const registry = new WindowOwnershipRegistry()
    const emit1 = newEmit()
    const emit2 = newEmit()
    registry.subscribe(W1, emit1)
    registry.subscribe(W2, emit2)

    expect(registry.claim(W1, 'wt-a')).toEqual({ claimed: true })

    expect(lastSnapshot(emit1)).toEqual({ type: 'snapshot', ownedElsewhere: [], ownedHere: 'wt-a' })
    expect(lastSnapshot(emit2)).toEqual({
      type: 'snapshot',
      ownedElsewhere: ['wt-a'],
      ownedHere: null
    })
  })

  it('refuses a claim on a worktree another live window has active (compare-and-set)', () => {
    const registry = new WindowOwnershipRegistry()
    registry.subscribe(W1, vi.fn())
    const emit2 = newEmit()
    registry.subscribe(W2, emit2)
    registry.claim(W1, 'wt-a')
    registry.claim(W2, 'wt-b')

    expect(registry.claim(W2, 'wt-a')).toEqual({ claimed: false })
    expect(registry.liveOwnerOf('wt-a')).toBe(W1)
    // The refused window has already left wt-b, so its claim on it is released.
    expect(registry.liveOwnerOf('wt-b')).toBeNull()
    expect(lastSnapshot(emit2)).toMatchObject({ ownedHere: null })
  })

  it('moves a window to its new worktree and releases on a null claim', () => {
    const registry = new WindowOwnershipRegistry()
    registry.subscribe(W1, vi.fn())
    registry.claim(W1, 'wt-a')
    registry.claim(W1, 'wt-b')
    expect(registry.liveOwnerOf('wt-a')).toBeNull()
    expect(registry.liveOwnerOf('wt-b')).toBe(W1)

    expect(registry.claim(W1, null)).toEqual({ claimed: true })
    expect(registry.liveOwnerOf('wt-b')).toBeNull()
  })

  it('drops a window claim when its last subscription goes away', () => {
    const registry = new WindowOwnershipRegistry()
    const emit1 = newEmit()
    registry.subscribe(W1, emit1)
    const unsubscribeA = registry.subscribe(W2, vi.fn())
    const unsubscribeB = registry.subscribe(W2, vi.fn())
    registry.claim(W2, 'wt-b')

    unsubscribeA()
    expect(registry.liveOwnerOf('wt-b')).toBe(W2)
    unsubscribeB()
    expect(registry.liveOwnerOf('wt-b')).toBeNull()
    expect(lastSnapshot(emit1)).toEqual({ type: 'snapshot', ownedElsewhere: [], ownedHere: null })
    expect(registry.claim(W1, 'wt-b')).toEqual({ claimed: true })
  })

  it('never lets a window without a live subscription lock a worktree', () => {
    const registry = new WindowOwnershipRegistry()
    registry.claim(W2, 'wt-a')
    registry.subscribe(W1, vi.fn())
    expect(registry.claim(W1, 'wt-a')).toEqual({ claimed: true })

    // The stale claim must not resurface once that window subscribes.
    const emit2 = newEmit()
    registry.subscribe(W2, emit2)
    expect(registry.liveOwnerOf('wt-a')).toBe(W1)
    expect(lastSnapshot(emit2)).toEqual({
      type: 'snapshot',
      ownedElsewhere: ['wt-a'],
      ownedHere: null
    })
  })

  it('delivers a reveal only to the owning window', () => {
    const registry = new WindowOwnershipRegistry()
    const emit1 = newEmit()
    const emit2 = newEmit()
    const emit3 = newEmit()
    registry.subscribe(W1, emit1)
    registry.subscribe(W2, emit2)
    registry.subscribe('paired-device:phone', emit3)
    registry.claim(W1, 'wt-a')

    expect(registry.reveal(W2, 'wt-a')).toEqual({ revealed: true })
    expect(emit1).toHaveBeenCalledWith({ type: 'reveal', worktreeId: 'wt-a' })
    expect(emit2).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'reveal' }))
    expect(emit3).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'reveal' }))
  })

  it('reveals nothing for an unowned worktree or the caller own worktree', () => {
    const registry = new WindowOwnershipRegistry()
    const emit1 = newEmit()
    registry.subscribe(W1, emit1)
    registry.claim(W1, 'wt-a')
    expect(registry.reveal(W2, 'wt-free')).toEqual({ revealed: false })
    expect(registry.reveal(W1, 'wt-a')).toEqual({ revealed: false })
    expect(emit1).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'reveal' }))
  })
})
