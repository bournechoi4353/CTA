import type { Effect, FrameInfo } from './types'
import type { Framebuffer } from '../render/framebuffer'
import { hsv } from '../render/color'

const CHARS = '0123456789ABCDEF<>|=+*#$@%&abcdef:.'
const CHAR_CP = [...CHARS].map((c) => c.codePointAt(0) ?? 0x20)

/**
 * Matrix digital rain (ASCII). Columns of glyphs fall with a bright head and a
 * fading tail. Reactive: speed/density from params, palette hue/saturation/
 * brightness — so the rain recolors with the assistant's state (the classic
 * green is just `idle`-ish; responding glows warm, etc.). Original implementation.
 */
export class Matrix implements Effect {
  readonly name = 'matrix'
  private w = 0
  private h = 0
  private intensity = new Float32Array(0)
  private glyphBuf = new Uint32Array(0)
  private dropY = new Float32Array(0)
  private dropSpeed = new Float32Array(0)
  private colActive = new Float32Array(0)
  private seed = 0x1234567

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 0xffffffff
  }

  resize(width: number, height: number): void {
    this.ensure(width, height)
  }

  private ensure(width: number, height: number): void {
    if (width === this.w && height === this.h) return
    this.w = width
    this.h = height
    this.intensity = new Float32Array(width * height)
    this.glyphBuf = new Uint32Array(width * height)
    this.dropY = new Float32Array(width)
    this.dropSpeed = new Float32Array(width)
    this.colActive = new Float32Array(width)
    for (let x = 0; x < width; x++) {
      this.dropY[x] = this.rand() * height
      this.dropSpeed[x] = 6 + this.rand() * 18
      this.colActive[x] = this.rand()
    }
  }

  render(fb: Framebuffer, info: FrameInfo): void {
    this.ensure(info.width, info.height)
    const w = this.w
    const h = this.h
    const p = info.params
    const dt = info.dt
    const intensity = this.intensity
    const glyphBuf = this.glyphBuf

    const fade = 0.74 + 0.2 * clamp01(p.trail)
    for (let i = 0; i < intensity.length; i++) intensity[i]! *= fade

    const density = clamp01(p.density)
    for (let x = 0; x < w; x++) {
      if (this.colActive[x]! >= density) continue
      let y = this.dropY[x]! + this.dropSpeed[x]! * (0.4 + p.speed) * dt
      if (y >= h + 2) {
        y = -(this.rand() * h * 0.6)
        this.dropSpeed[x] = 6 + this.rand() * 18
      }
      this.dropY[x] = y
      const cy = y | 0
      if (cy >= 0 && cy < h) {
        const cell = cy * w + x
        intensity[cell] = 1
        glyphBuf[cell] = CHAR_CP[(this.rand() * CHAR_CP.length) | 0]!
      }
    }

    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const i = cy * w + cx
        const v = intensity[i]!
        if (v <= 0.05) continue
        const glyph = glyphBuf[i]! || 0x20
        const head = v > 0.85
        const color = hsv(p.hueBase, head ? 0.1 : p.saturation, Math.min(1, p.brightness * (0.25 + 0.75 * v)))
        fb.set(cx, cy, glyph, color)
      }
    }
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
