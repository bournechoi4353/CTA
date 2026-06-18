import type { Framebuffer } from '../render/framebuffer'
import { DEFAULT_COLOR } from '../render/color'
import { theme } from './theme'

// Curated single-width chrome glyphs (safe: 1 cell each, well-formed UTF-8).
export const SYM = {
  sep: ' · ', // U+00B7
  logo: '✦', // U+2726
  mode: '▸', // U+25B8
  dot: '●', // U+25CF
}

interface Border {
  tl: number
  tr: number
  bl: number
  br: number
  h: number
  v: number
}

// Rounded box-drawing (U+256D/E, U+2570/F, U+2500, U+2502).
const ROUNDED: Border = { tl: 0x256d, tr: 0x256e, bl: 0x2570, br: 0x256f, h: 0x2500, v: 0x2502 }
// ASCII fallback (theme.asciiBorders = true).
const ASCII: Border = { tl: 0x2b, tr: 0x2b, bl: 0x2b, br: 0x2b, h: 0x2d, v: 0x7c }

export interface BoxStyle {
  title?: string
  titleFg?: number
  borderFg: number
  bg: number
}

/** Draw a bordered, filled box. The interior is (x+1, y+1) .. (x+w-2, y+h-2). */
export function drawBox(fb: Framebuffer, x: number, y: number, w: number, h: number, s: BoxStyle): void {
  if (w < 2 || h < 2) return
  const c = theme.asciiBorders ? ASCII : ROUNDED

  fb.fillRect(x, y, w, h, 0x20, DEFAULT_COLOR, s.bg)
  for (let i = 1; i < w - 1; i++) {
    fb.set(x + i, y, c.h, s.borderFg, s.bg)
    fb.set(x + i, y + h - 1, c.h, s.borderFg, s.bg)
  }
  for (let j = 1; j < h - 1; j++) {
    fb.set(x, y + j, c.v, s.borderFg, s.bg)
    fb.set(x + w - 1, y + j, c.v, s.borderFg, s.bg)
  }
  fb.set(x, y, c.tl, s.borderFg, s.bg)
  fb.set(x + w - 1, y, c.tr, s.borderFg, s.bg)
  fb.set(x, y + h - 1, c.bl, s.borderFg, s.bg)
  fb.set(x + w - 1, y + h - 1, c.br, s.borderFg, s.bg)

  if (s.title && w > 6) {
    const title = ` ${s.title} `.slice(0, w - 4)
    fb.drawText(x + 2, y, title, s.titleFg ?? s.borderFg, s.bg)
  }
}
