import { Framebuffer } from './framebuffer'
import { detectColorMode, selectEncoder, type SgrEncoder } from './color'
import type { Terminal } from '../terminal'

// Pen sentinel: a color value that can never equal a real one (real are >= -1),
// so the first emitted cell of a frame always re-establishes SGR state.
const UNSET = -2

// Periodically repaint every cell (without a clear) so any corruption from a
// dropped or garbled write self-heals instead of lingering — important for
// sparse scenes where most cells are otherwise never rewritten.
const RESYNC_EVERY_FRAMES = 600

export interface FlushStats {
  /** Cells that differed from the previous frame and were redrawn. */
  changed: number
  /** Bytes written to the terminal this frame. */
  bytes: number
  /** False if the stream is backpressured — caller should await drain. */
  ok: boolean
}

/**
 * Double-buffered renderer. Effects draw into the `back` buffer (via `begin()`);
 * `flush()` diffs it against the `front` buffer (what's on screen) and emits the
 * minimal ANSI to reconcile them — cursor moves only across gaps, SGR only on
 * color change, one `stdout.write` per frame. No full clears mid-run, so no
 * flicker.
 *
 * Robustness: every emitted glyph is sanitized to a printable character, every
 * frame is bounded by an SGR reset, and a full repaint is forced every
 * RESYNC_EVERY_FRAMES so transient corruption can't persist.
 */
export class Renderer {
  private cols: number
  private rows: number
  private back: Framebuffer
  private front: Framebuffer
  private dirtyAll = true
  private resync = false
  private flushes = 0
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

  /** Resize the surface. Forces a full clear+repaint on the next flush. */
  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.back = new Framebuffer(cols, rows)
    this.front = new Framebuffer(cols, rows)
    this.dirtyAll = true
  }

  /** Force a full (flicker-free) repaint on the next flush — a clean resync. */
  markDirty(): void {
    this.resync = true
  }

  flush(): FlushStats {
    this.flushes += 1
    if (this.flushes % RESYNC_EVERY_FRAMES === 0) this.resync = true

    const cols = this.cols
    const rows = this.rows
    const ng = this.back.glyph
    const nf = this.back.fg
    const nb = this.back.bg
    const og = this.front.glyph
    const of = this.front.fg
    const ob = this.front.bg
    const repaintAll = this.dirtyAll || this.resync
    const clearFirst = this.dirtyAll

    const parts: string[] = []
    if (clearFirst) parts.push('\x1b[H\x1b[2J')

    let penFg = UNSET
    let penBg = UNSET
    let curX = -1
    let curY = -1
    let changed = 0

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x
        const fg = nf[i]!
        const bg = nb[i]!
        let cp = ng[i]!
        if (!repaintAll && cp === og[i] && fg === of[i] && bg === ob[i]) continue
        changed += 1

        // Never emit a control byte — it would desync the terminal's parser and
        // garble everything after it. Effects shouldn't produce these, but a
        // single stray byte is exactly what turns the screen into "creepy text".
        if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) cp = 0x20

        if (curX !== x || curY !== y) parts.push(`\x1b[${y + 1};${x + 1}H`)
        if (fg !== penFg || bg !== penBg) {
          parts.push(this.sgr(fg, bg, penFg, penBg))
          penFg = fg
          penBg = bg
        }
        parts.push(String.fromCodePoint(cp))
        curX = x + 1
        curY = y
      }
    }

    // Bound the frame with a clean reset so no attribute state leaks past it.
    if (changed > 0) parts.push('\x1b[0m')

    // Swap: `front` now holds what we just drew (= what's on screen).
    const tmp = this.front
    this.front = this.back
    this.back = tmp
    this.dirtyAll = false
    this.resync = false

    const out = parts.join('')
    const ok = out.length === 0 ? true : this.term.write(out)
    return { changed, bytes: out.length, ok }
  }

  private sgr(fg: number, bg: number, penFg: number, penBg: number): string {
    const params: string[] = []
    if (fg !== penFg) params.push(this.enc.fg(fg))
    if (bg !== penBg) params.push(this.enc.bg(bg))
    return `\x1b[${params.join(';')}m`
  }
}
