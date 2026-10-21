import type { IDisposable, ITerminalAddon, Terminal } from '@xterm/xterm'
import { useAppStore } from '@/store'
import { CursorGlideOverlay } from './cursor-glide-overlay'
import { isCalmBlinkEnabled, isCursorGlideEnabled } from './cursor-glide-settings'
import { CursorMotionModel, type CursorCell, type CursorSchedule } from './cursor-motion-model'
import { CursorRowDamage } from './cursor-row-damage'
import {
  createRendererCursorSuppression,
  readDirtyRows,
  readEffectiveCursorStyle,
  type RendererCursorSuppression
} from './xterm-cursor-internals'

/**
 * Diri's cursor feel for one xterm terminal: short typed moves slide over 80 ms, and with blink
 * on the cursor fades calmly instead of flashing. xterm draws the cursor whenever nothing
 * animates; the overlay takes over only while it moves or fades, so a resting cursor costs
 * nothing and keeps xterm's exact glyph rendering.
 */
export class CursorGlideAddon implements ITerminalAddon {
  private terminal: Terminal | null = null
  private overlay: CursorGlideOverlay | null = null
  private suppression: RendererCursorSuppression | null = null
  private readonly model = new CursorMotionModel()
  private readonly damage = new CursorRowDamage()
  private readonly disposables: IDisposable[] = []
  private lastCell: CursorCell | null = null
  private glideEnabled = true
  private calmBlink = false
  private focused = false
  private animating = false
  private hideAfterRender: IDisposable | null = null
  private frameRequest: number | null = null
  private wakeTimer: ReturnType<typeof setTimeout> | null = null

  activate(terminal: Terminal): void {
    this.terminal = terminal
    this.overlay = new CursorGlideOverlay(terminal)
    this.suppression = createRendererCursorSuppression(terminal)
    this.applySettings(useAppStore.getState().settings)
    let settings = useAppStore.getState().settings
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.settings !== settings) {
        settings = state.settings
        this.applySettings(settings)
      }
    })
    this.disposables.push(
      { dispose: unsubscribe },
      terminal.onWriteParsed(() => this.handleWriteParsed()),
      terminal.onResize(() => this.reset()),
      terminal.onScroll(() => this.reset()),
      terminal.buffer.onBufferChange(() => this.reset())
    )
    const textarea = terminal.textarea
    if (textarea) {
      const onKey = (): void => this.handleKeystroke()
      const onFocus = (): void => this.handleFocus(true)
      const onBlur = (): void => this.handleFocus(false)
      textarea.addEventListener('keydown', onKey, true)
      textarea.addEventListener('compositionend', onKey)
      textarea.addEventListener('focus', onFocus)
      textarea.addEventListener('blur', onBlur)
      this.focused = document.activeElement === textarea
      this.disposables.push({
        dispose: () => {
          textarea.removeEventListener('keydown', onKey, true)
          textarea.removeEventListener('compositionend', onKey)
          textarea.removeEventListener('focus', onFocus)
          textarea.removeEventListener('blur', onBlur)
        }
      })
    }
    this.lastCell = this.cursorCell()
  }

  dispose(): void {
    this.stopLoop()
    this.cancelPendingHide()
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose()
    }
    this.suppression?.dispose()
    this.overlay?.dispose()
    this.terminal = null
  }

  private applySettings(settings: Parameters<typeof isCursorGlideEnabled>[0]): void {
    this.glideEnabled = isCursorGlideEnabled(settings)
    this.calmBlink = isCalmBlinkEnabled(settings)
    if (!this.glideEnabled) {
      this.reset()
    } else {
      this.kick()
    }
  }

  private get active(): boolean {
    return this.glideEnabled && this.focused && this.terminal !== null
  }

  /** The cursor's viewport cell, or null when the program hid it or the view is scrolled back. */
  private cursorCell(): CursorCell | null {
    const terminal = this.terminal
    if (!terminal || !terminal.modes.showCursor) {
      return null
    }
    const buffer = terminal.buffer.active
    if (buffer.viewportY !== buffer.baseY) {
      return null
    }
    return { col: Math.min(buffer.cursorX, terminal.cols - 1), row: buffer.cursorY }
  }

  private handleKeystroke(): void {
    if (!this.active) {
      return
    }
    this.model.noteKeystroke(performance.now())
    // Typing during a fade must bring the solid cursor back right away.
    if (this.calmBlink) {
      this.kick()
    }
  }

  private handleFocus(focused: boolean): void {
    this.focused = focused
    if (!focused) {
      // Blurred panes keep xterm's own hollow outline, which never moves or blinks.
      this.reset()
      return
    }
    this.model.noteActivity(performance.now())
    this.lastCell = this.cursorCell()
    this.kick()
  }

  private handleWriteParsed(): void {
    const terminal = this.terminal
    const next = this.cursorCell()
    if (!terminal || !this.active) {
      this.lastCell = next
      return
    }
    const buffer = terminal.buffer.active
    const viewportDirty = readDirtyRows(terminal) ?? { start: buffer.cursorY, end: buffer.cursorY }
    const dirty = {
      start: buffer.baseY + viewportDirty.start,
      end: buffer.baseY + viewportDirty.end
    }
    const cursorRow = buffer.baseY + buffer.cursorY
    const now = performance.now()
    let damage = {
      rowsDamaged: dirty.end - dirty.start + 1,
      touchesCursorRow: cursorRow >= dirty.start && cursorRow <= dirty.end
    }
    if (this.model.isGlideCandidate(this.lastCell, next, now)) {
      // Only a write that could glide pays for reading rows; a stream of output never does.
      damage = this.damage.measure(
        dirty,
        cursorRow,
        (row) => buffer.getLine(row)?.translateToString(true) ?? null
      )
    } else {
      this.damage.forget(dirty)
    }
    const { rowsDamaged, touchesCursorRow } = damage
    this.model.noteUpdate({ previous: this.lastCell, next, rowsDamaged, touchesCursorRow }, now)
    this.lastCell = next
    if (this.animating || this.model.isGliding(now) || this.calmBlink) {
      // Paint the first frame now: xterm renders this write on the coming animation frame, and
      // its cursor must already be hidden there or it flashes at the destination.
      this.paint(now)
    }
  }

  /** Re-evaluates the cursor now and schedules whatever comes next. */
  private kick(): void {
    if (this.active) {
      this.paint(performance.now())
    }
  }

  private paint(now: number): void {
    this.stopLoop()
    const cell = this.cursorCell()
    const overlay = this.overlay
    const suppression = this.suppression
    if (!this.active || !cell || !overlay || !suppression?.supported) {
      this.restoreXtermCursor()
      return
    }
    const frame = this.model.sample(cell, now, this.calmBlink)
    const animating = frame.offsetCols !== 0 || frame.offsetRows !== 0 || frame.opacity < 1
    if (animating) {
      const glyph = frame.offsetCols === 0 && frame.offsetRows === 0 ? this.glyphAt(cell) : null
      overlay.show(cell, frame, readEffectiveCursorStyle(this.terminal!), glyph)
      this.cancelPendingHide()
      suppression.set(true)
      this.animating = true
    } else {
      this.restoreXtermCursor()
    }
    this.schedule(frame.schedule)
  }

  private glyphAt(cell: CursorCell): string | null {
    const buffer = this.terminal?.buffer.active
    const chars = buffer
      ?.getLine(buffer.baseY + cell.row)
      ?.getCell(cell.col)
      ?.getChars()
    return chars ? chars : null
  }

  private schedule(schedule: CursorSchedule): void {
    if (schedule.kind === 'frame') {
      this.frameRequest = requestAnimationFrame((time) => {
        this.frameRequest = null
        this.paint(time)
      })
    } else if (schedule.kind === 'after') {
      // A hold looks the same for its whole length: sleep on one timer, not on frames.
      this.wakeTimer = setTimeout(() => {
        this.wakeTimer = null
        this.paint(performance.now())
      }, schedule.ms)
    }
  }

  private stopLoop(): void {
    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest)
      this.frameRequest = null
    }
    if (this.wakeTimer !== null) {
      clearTimeout(this.wakeTimer)
      this.wakeTimer = null
    }
  }

  private restoreXtermCursor(): void {
    this.animating = false
    if (!this.suppression?.set(false)) {
      if (!this.hideAfterRender) {
        this.overlay?.hide()
      }
      return
    }
    // xterm paints its own cursor on its next render; hiding the overlay now would leave one
    // frame with no cursor at all, so it goes when that render lands.
    this.cancelPendingHide()
    const hide = (): void => {
      this.cancelPendingHide()
      this.overlay?.hide()
    }
    const rendered = this.terminal?.onRender(hide)
    // A paused renderer (hidden pane) never renders; the overlay must not outlive that.
    const fallback = setTimeout(hide, 100)
    this.hideAfterRender = {
      dispose: () => {
        rendered?.dispose()
        clearTimeout(fallback)
      }
    }
  }

  private cancelPendingHide(): void {
    this.hideAfterRender?.dispose()
    this.hideAfterRender = null
  }

  /** A jump no glide should cover: drop motion and give the cursor back to xterm. */
  private reset(): void {
    this.stopLoop()
    this.model.snap()
    this.damage.reset()
    this.restoreXtermCursor()
    this.lastCell = this.cursorCell()
  }
}
