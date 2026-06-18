import { DEFAULT_COLOR } from './color'

const BLANK_GLYPH = 0x20 // space

/**
 * A grid of cells, each holding a glyph codepoint plus fg/bg colors, stored as
 * parallel typed arrays for cheap clears and diffs. Effects draw into one of
 * these; the Renderer diffs two of them.
 */
export class Framebuffer {
  readonly width: number
  readonly height: number
  readonly glyph: Uint32Array
  readonly fg: Int32Array
  readonly bg: Int32Array

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    const n = Math.max(0, width * height)
    this.glyph = new Uint32Array(n)
    this.fg = new Int32Array(n)
    this.bg = new Int32Array(n)
    this.clear()
  }

  /** Reset every cell to a blank space with default colors. */
  clear(): void {
    this.glyph.fill(BLANK_GLYPH)
    this.fg.fill(DEFAULT_COLOR)
    this.bg.fill(DEFAULT_COLOR)
  }

  /** Set a single cell. Out-of-bounds writes are ignored. */
  set(x: number, y: number, glyph: number, fg: number, bg: number = DEFAULT_COLOR): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const i = y * this.width + x
    this.glyph[i] = glyph
    this.fg[i] = fg
    this.bg[i] = bg
  }

  /** Draw a string left-to-right starting at (x, y). Clipped at the edges. */
  drawText(x: number, y: number, text: string, fg: number, bg: number = DEFAULT_COLOR): void {
    let cx = x
    for (const ch of text) {
      this.set(cx, y, ch.codePointAt(0) ?? BLANK_GLYPH, fg, bg)
      cx += 1
    }
  }

  /** Fill a rectangle with a glyph + colors (clipped to bounds). */
  fillRect(x: number, y: number, w: number, h: number, glyph: number, fg: number, bg: number = DEFAULT_COLOR): void {
    const x1 = Math.min(this.width, x + w)
    const y1 = Math.min(this.height, y + h)
    for (let cy = Math.max(0, y); cy < y1; cy++) {
      for (let cx = Math.max(0, x); cx < x1; cx++) {
        const i = cy * this.width + cx
        this.glyph[i] = glyph
        this.fg[i] = fg
        this.bg[i] = bg
      }
    }
  }
}
