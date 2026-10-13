import type { JoseWindowOwnershipFrame } from '../../shared/rpc-contract/jose-window-params'
import type { RpcCallerIdentity } from '../runtime/rpc/rpc-caller-identity'

type Subscriber = { windowKey: string; emit: (frame: JoseWindowOwnershipFrame) => void }

/** One window per caller identity: `desktop` is this host's own window, `paired-device:<id>` a
 *  second window paired over loopback. The CLI and unnamed transports own no window. */
export function windowKeyForCaller(caller: RpcCallerIdentity | undefined): string | null {
  if (caller?.kind === 'desktop') {
    return 'desktop'
  }
  if (caller?.kind === 'paired-device') {
    return `paired-device:${caller.deviceId}`
  }
  return null
}

/**
 * A worktree is owned by the window that has it active. Only a window with a live subscription
 * owns anything: a crashed or disconnected window cannot be raised, so its claim must not lock
 * the worktree away from the others.
 */
export class WindowOwnershipRegistry {
  private readonly activeByWindow = new Map<string, string>()
  private readonly subscribers = new Map<number, Subscriber>()
  private nextSubscriberId = 1

  subscribe(windowKey: string, emit: Subscriber['emit']): () => void {
    const id = this.nextSubscriberId++
    this.subscribers.set(id, { windowKey, emit })
    emit(this.snapshotFor(windowKey))
    // Why: a new live window makes its pending claim visible to the others.
    this.broadcast(windowKey)
    return () => {
      if (!this.subscribers.delete(id)) {
        return
      }
      if (!this.isLive(windowKey)) {
        this.activeByWindow.delete(windowKey)
        this.broadcast()
      }
    }
  }

  /** Compare-and-set: succeeds unless another live window has the worktree active. A refused
   *  claim still releases the caller's previous worktree, which it has already left. */
  claim(windowKey: string, worktreeId: string | null): { claimed: boolean } {
    const owner = worktreeId === null ? null : this.liveOwnerOf(worktreeId)
    const claimed = owner === null || owner === windowKey
    const next = claimed ? worktreeId : null
    if (this.activeByWindow.get(windowKey) === (next ?? undefined)) {
      return { claimed }
    }
    if (next === null) {
      this.activeByWindow.delete(windowKey)
    } else {
      // Why: a stale claim from a window that is not live yet must not resurface when it subscribes.
      for (const [other, active] of this.activeByWindow) {
        if (active === next && other !== windowKey) {
          this.activeByWindow.delete(other)
        }
      }
      this.activeByWindow.set(windowKey, next)
    }
    this.broadcast()
    return { claimed }
  }

  /** Asks the owning window, and only that window, to come forward on its worktree. */
  reveal(callerKey: string, worktreeId: string): { revealed: boolean } {
    const owner = this.liveOwnerOf(worktreeId)
    if (owner === null || owner === callerKey) {
      return { revealed: false }
    }
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.windowKey === owner) {
        subscriber.emit({ type: 'reveal', worktreeId })
      }
    }
    return { revealed: true }
  }

  liveOwnerOf(worktreeId: string): string | null {
    for (const [windowKey, active] of this.activeByWindow) {
      if (active === worktreeId && this.isLive(windowKey)) {
        return windowKey
      }
    }
    return null
  }

  private isLive(windowKey: string): boolean {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.windowKey === windowKey) {
        return true
      }
    }
    return false
  }

  private snapshotFor(windowKey: string): JoseWindowOwnershipFrame {
    const ownedElsewhere: string[] = []
    for (const [owner, worktreeId] of this.activeByWindow) {
      if (owner !== windowKey && this.isLive(owner)) {
        ownedElsewhere.push(worktreeId)
      }
    }
    return {
      type: 'snapshot',
      ownedElsewhere,
      ownedHere: this.activeByWindow.get(windowKey) ?? null
    }
  }

  private broadcast(exceptWindowKey?: string): void {
    for (const subscriber of this.subscribers.values()) {
      if (subscriber.windowKey !== exceptWindowKey) {
        subscriber.emit(this.snapshotFor(subscriber.windowKey))
      }
    }
  }
}

export const windowOwnershipRegistry = new WindowOwnershipRegistry()
