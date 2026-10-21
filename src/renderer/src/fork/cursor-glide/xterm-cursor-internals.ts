import type { Terminal } from '@xterm/xterm'

// The few xterm internals the glide needs. Every read is optional: a renamed field turns the
// glide off (the cursor snaps as stock xterm) instead of breaking the terminal.

type CoreServiceLike = {
  isCursorHidden: boolean
  decPrivateModes?: { cursorStyle?: 'block' | 'underline' | 'bar' }
}
type RendererLike = {
  _coreService?: CoreServiceLike
  _rowFactory?: { _coreService?: CoreServiceLike }
}
type TerminalInternals = {
  _core?: {
    coreService?: CoreServiceLike
    _inputHandler?: { _dirtyRowTracker?: { start: number; end: number } }
    _renderService?: { _renderer?: { value?: RendererLike } }
  }
}

function internals(terminal: Terminal): TerminalInternals['_core'] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Every field read below is optional and checked; a missing field disables the glide.
  return (terminal as unknown as TerminalInternals)._core
}

/** DECSCUSR from the program wins over the setting, as xterm's own renderer does. */
export function readEffectiveCursorStyle(terminal: Terminal): 'block' | 'underline' | 'bar' {
  return (
    internals(terminal)?.coreService?.decPrivateModes?.cursorStyle ??
    terminal.options.cursorStyle ??
    'block'
  )
}

/** Rows the last parsed write touched, relative to the buffer base, or null when unknown. */
export function readDirtyRows(terminal: Terminal): { start: number; end: number } | null {
  const tracker = internals(terminal)?._inputHandler?._dirtyRowTracker
  return tracker ? { start: tracker.start, end: tracker.end } : null
}

export type RendererCursorSuppression = {
  /** True when the renderer could be reached; otherwise the glide must not start. */
  readonly supported: boolean
  /** Returns true when xterm was asked to redraw the cursor row for the change. */
  set: (hidden: boolean) => boolean
  dispose: () => void
}

/**
 * Hides xterm's own cursor from its renderer only.
 *
 * Why not DECTCEM or the theme: `?25l` would be program state (serialized, reported by
 * DECRQM, overwritten by the next `?25h`), and a theme change rebuilds every row. The renderer
 * reads `isCursorHidden` from its own injected service, so it alone gets a view that adds our
 * flag; the program's value stays untouched for everyone else.
 */
export function createRendererCursorSuppression(terminal: Terminal): RendererCursorSuppression {
  let hidden = false
  const wrapped: { holder: { _coreService?: CoreServiceLike }; original: CoreServiceLike }[] = []
  const proxies = new WeakSet<CoreServiceLike>()
  const proxyFor = (real: CoreServiceLike): CoreServiceLike => {
    const proxy = new Proxy(real, {
      get(target, property) {
        if (property === 'isCursorHidden') {
          return hidden || target.isCursorHidden
        }
        const value: unknown = Reflect.get(target, property, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
      set(target, property, value) {
        return Reflect.set(target, property, value, target)
      }
    })
    proxies.add(proxy)
    return proxy
  }
  // The renderer is replaced on WebGL context loss or a GPU setting change, so wrap lazily.
  const wrapCurrentRenderer = (): boolean => {
    const renderer = internals(terminal)?._renderService?._renderer?.value
    let reached = false
    for (const holder of [renderer, renderer?._rowFactory]) {
      const current = holder?._coreService
      if (!holder || !current) {
        continue
      }
      reached = true
      if (!proxies.has(current)) {
        wrapped.push({ holder, original: current })
        holder._coreService = proxyFor(current)
      }
    }
    return reached
  }
  return {
    get supported() {
      return wrapCurrentRenderer()
    },
    set(next) {
      if (next === hidden) {
        return false
      }
      hidden = next
      if (!wrapCurrentRenderer()) {
        return false
      }
      const row = terminal.buffer.active.cursorY
      terminal.refresh(row, row)
      return true
    },
    dispose() {
      hidden = false
      for (const { holder, original } of wrapped) {
        holder._coreService = original
      }
      wrapped.length = 0
    }
  }
}
