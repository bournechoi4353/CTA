import { Framebuffer } from './framebuffer'
import { detectColorMode, selectEncoder, type SgrEncoder } from './color'
import type { Terminal } from '../terminal'

// Pen sentinel: a color value that can never equal a real one (real are >= -1),
// so the first emitted cell of a frame always re-establishes SGR state.
const UNSET = -2

export interface FlushStats {
  /** Cells that differed from the previous frame and were redrawn. */
  changed: number
  /** Bytes written to the terminal this frame. */
  bytes: number
}

/**
 * Double-buffered renderer. Effects draw into the `back` buffer (via `begin()`);
 * `flush()` diffs it against the `front` buffer (what's on screen) and emits the
 * minimal ANSI to reconcile them — cursor moves only across gaps, SGR only on
 * color change, one `stdout.write` per frame. No full-screen clears mid-run, so
 * no flicker.
 */
export class Renderer {
  private cols: number
  private rows: number
  private back: Framebuffer
  private front: Framebuffer
  private dirtyAll = true
  private readonly enc: SgrEncoder

  constructor(
    private readonly term: Terminal,
    cols: number,
    rows: number,
  ) {
    this.cols = cols
    this.rows = rows
    this.back = new Framebuffer(cols, rows)
    this.front = new Framebuffer(cols, rows)
    this.enc = selectEncoder(detectColorMode())
  }

  get width(): number {
    return this.cols
  }

  get height(): number {
    return this.rows
  }

  /** Clear and return the back buffer for this frame's drawing. */
  begin(): Framebuffer {
    this.back.clear()
    return this.back
  }

  /** Resize the surface. Forces a full repaint on the next flush. */
  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.back = new Framebuffer(cols, rows)
    this.front = new Framebuffer(cols, rows)
    this.dirtyAll = true
  }

  flush(): FlushStats {
    const cols = this.cols
    const rows = this.rows
    const ng = this.back.glyph
    const nf = this.back.fg
    const nb = this.back.bg
    const og = this.front.glyph
    const of = this.front.fg
    const ob = this.front.bg
    const dirtyAll = this.dirtyAll

    const parts: string[] = []
    if (dirtyAll) parts.push('\x1b[H\x1b[2J')

    let penFg = UNSET
    let penBg = UNSET
    let curX = -1
    let curY = -1
    let changed = 0

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        const glyph = ng[i]!
        const fg = nf[i]!
        const bg = nb[i]!
        if (!dirtyAll && glyph === og[i] && fg === of[i] && bg === ob[i]) continue
        changed += 1

        // Cursor: only move when the run breaks (a gap or a new row).
        if (curX !== x || curY !== y) {
          parts.push(`\x1b[${y + 1};${x + 1}H`)
        }
        // SGR: only when a color actually changed since the last drawn cell.
        if (fg !== penFg || bg !== penBg) {
          parts.push(this.sgr(fg, bg, penFg, penBg))
          penFg = fg
          penBg = bg
        }
        parts.push(String.fromCodePoint(glyph))
        curX = x + 1
        curY = y
      }
    }

    // Swap: `front` now holds what we just drew (= what's on screen).
    const tmp = this.front
    this.front = this.back
    this.back = tmp
    this.dirtyAll = false

    const out = parts.join('')
    if (out.length > 0) this.term.write(out)
    return { changed, bytes: out.length }
  }

  private sgr(fg: number, bg: number, penFg: number, penBg: number): string {
    const params: string[] = []
    if (fg !== penFg) params.push(this.enc.fg(fg))
    if (bg !== penBg) params.push(this.enc.bg(bg))
    return `\x1b[${params.join(';')}m`
  }
}
