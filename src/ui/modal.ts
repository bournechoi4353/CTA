import type { Framebuffer } from '../render/framebuffer'
import { rgb, DEFAULT_COLOR } from '../render/color'
import { toDisplay } from './text'
import { wrapText } from './wrap'

const BG = rgb(20, 20, 30)
const BORDER = rgb(125, 205, 255)
const TITLE = rgb(245, 245, 255)
const TEXT = rgb(220, 220, 232)
const FOOTER = rgb(150, 150, 175)

const PLUS = 0x2b // +
const DASH = 0x2d // -
const PIPE = 0x7c // |

export interface ModalContent {
  title: string
  lines: string[]
  footer: string
}

/** Draw a centered, ASCII-bordered modal box over the current frame. */
export function drawModal(fb: Framebuffer, cols: number, rows: number, content: ModalContent): void {
  const w = Math.max(24, Math.min(cols - 4, 74))
  const innerW = w - 4

  const wrapped: string[] = []
  for (const line of content.lines) {
    for (const part of wrapText(toDisplay(line), innerW)) wrapped.push(part)
  }
  const bodyH = Math.max(1, Math.min(wrapped.length, Math.max(1, rows - 9)))
  const shown = wrapped.slice(0, bodyH)
  if (wrapped.length > bodyH && shown.length > 0) shown[shown.length - 1] = '...'

  const h = bodyH + 5 // top, title, divider, body, footer, bottom
  const x0 = Math.max(0, (cols - w) >> 1)
  const y0 = Math.max(0, (rows - h) >> 1)

  fb.fillRect(x0, y0, w, h, 0x20, DEFAULT_COLOR, BG)

  // Sides first, then horizontal rules so the corners read as `+`.
  for (let r = y0; r < y0 + h; r++) {
    fb.set(x0, r, PIPE, BORDER, BG)
    fb.set(x0 + w - 1, r, PIPE, BORDER, BG)
  }
  hrule(fb, x0, y0, w)
  hrule(fb, x0, y0 + 2, w)
  hrule(fb, x0, y0 + h - 1, w)

  fb.drawText(x0 + 2, y0 + 1, clip(toDisplay(content.title), innerW), TITLE, BG)
  shown.forEach((line, i) => fb.drawText(x0 + 2, y0 + 3 + i, clip(line, innerW), TEXT, BG))
  fb.drawText(x0 + 2, y0 + h - 2, clip(toDisplay(content.footer), innerW), FOOTER, BG)
}

function hrule(fb: Framebuffer, x: number, y: number, w: number): void {
  fb.set(x, y, PLUS, BORDER, BG)
  for (let i = 1; i < w - 1; i++) fb.set(x + i, y, DASH, BORDER, BG)
  fb.set(x + w - 1, y, PLUS, BORDER, BG)
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s
}
