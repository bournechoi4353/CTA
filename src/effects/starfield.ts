import type { Effect, FrameInfo } from './types'
import type { Framebuffer } from '../render/framebuffer'
import { hsv } from '../render/color'

interface Star {
  x: number
  y: number
  z: number
}

const STAR_COUNT = 600
const RAMP = '.,:;+*oO#@'
const RAMP_CP = [...RAMP].map((c) => c.codePointAt(0) ?? 0x20)

/**
 * A flying starfield. Only a few hundred cells change per frame, so this
 * exercises the renderer's diff efficiency (small byte counts) — the opposite
 * load profile to the plasma.
 */
export class Starfield implements Effect {
  readonly name = 'starfield'
  private readonly stars: Star[] = []
  private seed = 0x2545f491

  constructor() {
    for (let i = 0; i < STAR_COUNT; i++) this.stars.push(this.spawn())
  }

  // Deterministic PRNG — keeps the field reproducible (and headless-smoke stable).
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 0xffffffff
  }

  private spawn(): Star {
    return {
      x: this.rand() * 2 - 1,
      y: this.rand() * 2 - 1,
      z: this.rand() * 0.9 + 0.1,
    }
  }

  render(fb: Framebuffer, info: FrameInfo): void {
    const w = info.width
    const h = info.height
    const cx = w / 2
    const cy = h / 2
    // Terminal cells are ~twice as tall as wide; squash the vertical axis.
    const aspect = 0.5
    const speed = info.dt * 0.45

    for (const star of this.stars) {
      star.z -= speed
      if (star.z <= 0.02) {
        const s = this.spawn()
        star.x = s.x
        star.y = s.y
        star.z = 1
        continue
      }
      const k = 0.6 / star.z
      const sx = Math.round(cx + star.x * k * cx)
      const sy = Math.round(cy + star.y * k * cy * aspect)
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue

      const bright = Math.min(1, 1 - star.z + 0.1)
      const idx = Math.min(RAMP_CP.length - 1, Math.floor(bright * RAMP_CP.length))
      const color = hsv(200 + bright * 80, 0.25 + 0.3 * (1 - bright), 0.4 + 0.6 * bright)
      fb.set(sx, sy, RAMP_CP[idx]!, color)
    }
  }
}
