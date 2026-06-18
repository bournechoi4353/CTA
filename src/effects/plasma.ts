import type { Effect, FrameInfo } from './types'
import type { Framebuffer } from '../render/framebuffer'
import { hsv } from '../render/color'
import { glyphIndex, rampCodepoints } from '../render/glyphs'

const RAMP_CP = rampCodepoints()

/**
 * Classic sum-of-sines plasma. Every cell changes every frame, so this is the
 * renderer's worst case — a full-frame throughput stress test.
 */
export class Plasma implements Effect {
  readonly name = 'plasma'

  render(fb: Framebuffer, info: FrameInfo): void {
    const t = info.time
    const w = info.width
    const h = info.height

    for (let y = 0; y < h; y++) {
      const fy = h > 1 ? y / (h - 1) : 0
      for (let x = 0; x < w; x++) {
        const fx = w > 1 ? x / (w - 1) : 0
        const v =
          Math.sin(fx * 10 + t) +
          Math.sin(fy * 8 - t * 1.3) +
          Math.sin((fx + fy) * 6 + t * 0.7) +
          Math.sin(Math.hypot(fx - 0.5, fy - 0.5) * 18 - t * 1.7)
        const n = (v + 4) / 8 // normalize ~0..1
        const cp = RAMP_CP[glyphIndex(n, RAMP_CP.length)]!
        const color = hsv((n * 280 + t * 40) % 360, 0.75, 0.35 + 0.65 * n)
        fb.set(x, y, cp, color)
      }
    }
  }
}
