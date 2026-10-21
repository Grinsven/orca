import type { Terminal } from '@xterm/xterm'
import type { CursorCell, CursorFrame } from './cursor-motion-model'
import './cursor-glide.css'

type CursorShape = 'block' | 'underline' | 'bar'

function px(value: string): number {
  return Number.parseFloat(value) || 0
}

/** One absolutely placed block in xterm's screen element, moved with transforms. */
export class CursorGlideOverlay {
  private element: HTMLDivElement | null = null
  private glyph: HTMLSpanElement | null = null
  private visible = false
  private shapeKey = ''

  constructor(private readonly terminal: Terminal) {}

  /** Cell size in CSS px, from the size xterm writes onto its screen element (no layout read). */
  cellSize(): { width: number; height: number } | null {
    const screen = this.screen()
    if (!screen || this.terminal.cols <= 0 || this.terminal.rows <= 0) {
      return null
    }
    const width = px(screen.style.width) / this.terminal.cols
    const height = px(screen.style.height) / this.terminal.rows
    return width > 0 && height > 0 ? { width, height } : null
  }

  show(cell: CursorCell, frame: CursorFrame, shape: CursorShape, glyph: string | null): void {
    const size = this.cellSize()
    const element = this.ensure()
    if (!size || !element || !this.glyph) {
      return
    }
    const theme = this.terminal.options.theme ?? {}
    const width = shape === 'bar' ? (this.terminal.options.cursorWidth ?? 1) : size.width
    const height = shape === 'underline' ? 1 : size.height
    const shapeKey = `${shape}:${width}:${height}:${theme.cursor ?? ''}:${theme.cursorAccent ?? ''}`
    if (shapeKey !== this.shapeKey) {
      this.shapeKey = shapeKey
      element.style.width = `${width}px`
      element.style.height = `${height}px`
      element.style.background = theme.cursor ?? theme.foreground ?? '#ffffff'
      const { fontFamily, fontSize, fontWeight } = this.terminal.options
      this.glyph.style.color = theme.cursorAccent ?? theme.background ?? '#000000'
      this.glyph.style.font = `${fontWeight ?? 'normal'} ${fontSize ?? 14}px ${fontFamily ?? 'monospace'}`
      this.glyph.style.lineHeight = `${size.height}px`
    }
    const glyphText = shape === 'block' ? (glyph ?? '') : ''
    if (this.glyph.textContent !== glyphText) {
      this.glyph.textContent = glyphText
    }
    const x = (cell.col + frame.offsetCols) * size.width
    const y = (cell.row + frame.offsetRows) * size.height + (size.height - height)
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`
    element.style.opacity = String(frame.opacity)
    if (!this.visible) {
      this.visible = true
      element.dataset.visible = 'true'
    }
  }

  hide(): void {
    if (this.visible && this.element) {
      this.visible = false
      this.element.dataset.visible = 'false'
    }
  }

  dispose(): void {
    this.element?.remove()
    this.element = null
    this.glyph = null
  }

  private screen(): HTMLElement | null {
    return this.terminal.element?.querySelector<HTMLElement>('.xterm-screen') ?? null
  }

  private ensure(): HTMLDivElement | null {
    const screen = this.screen()
    if (!screen) {
      return null
    }
    if (this.element?.parentElement === screen) {
      return this.element
    }
    this.element?.remove()
    const element = document.createElement('div')
    element.className = 'orca-cursor-glide'
    element.dataset.visible = 'false'
    element.setAttribute('aria-hidden', 'true')
    const glyph = document.createElement('span')
    glyph.className = 'orca-cursor-glide-glyph'
    element.append(glyph)
    screen.append(element)
    this.element = element
    this.glyph = glyph
    this.visible = false
    this.shapeKey = ''
    return element
  }
}
