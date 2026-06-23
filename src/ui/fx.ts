import type { Framebuffer } from '../render/framebuffer'
import { hsv } from '../render/color'
import { glyphIndex, rampCodepoints } from '../render/glyphs'

const RAMP = rampCodepoints(' .:-=+*#%@')
const GLITCH = rampCodepoints('!@#$%&*?/\\|<>=')

interface Ripple {
  x: number
  y: number
  t: number
  life: number
  hue: number
  sat: number
  strength: number
  maxR: number
}

/**
 * Transient visual effects layered over the art band: expanding ripples (sonar
 * pings) for keystrokes/tool-use, and a glitch tear on errors. Spawned by the
 * app from the event stream and input; drawn on top of the active scene. All
 * glyphs are ASCII (keeps the render invariant intact).
 */
export class Fx {
  private ripples: Ripple[] = []
  private glitch = 0
  private seed = 0x51ed5

  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 0xffffffff
  }

  ripple(
    x: number,
    y: number,
    hue: number,
    opts?: { sat?: number; strength?: number; life?: number; maxR?: number },
  ): void {
    if (this.ripples.length > 48) this.ripples.shift()
    this.ripples.push({
      x,
      y,
      t: 0,
      life: opts?.life ?? 0.8,
      hue,
      sat: opts?.sat ?? 0.7,
      strength: opts?.strength ?? 1,
      maxR: opts?.maxR ?? 18,
    })
  }

  glitchPulse(amount = 1): void {
    this.glitch = Math.min(1, this.glitch + amount)
  }

  update(dt: number): void {
    this.glitch = Math.max(0, this.glitch - dt * 2.6)
    for (const r of this.ripples) r.t += dt
    this.ripples = this.ripples.filter((r) => r.t < r.life)
  }

  get active(): boolean {
    return this.ripples.length > 0 || this.glitch > 0.02
  }

  /** Draw ripples + glitch within the inclusive band [x0..x1] x [y0..y1]. */
  draw(fb: Framebuffer, x0: number, y0: number, x1: number, y1: number): void {
    for (const r of this.ripples) {
      const p = r.t / r.life
      const radius = p * r.maxR
      const fade = (1 - p) * r.strength
      if (fade <= 0.04) continue
      const ringW = 1.4
      const ay = (radius + ringW) / 2
      const rx0 = Math.max(x0, Math.floor(r.x - radius - ringW))
      const rx1 = Math.min(x1, Math.ceil(r.x + radius + ringW))
      const ry0 = Math.max(y0, Math.floor(r.y - ay))
      const ry1 = Math.min(y1, Math.ceil(r.y + ay))
      for (let cy = ry0; cy <= ry1; cy++) {
        for (let cx = rx0; cx <= rx1; cx++) {
          const dx = cx - r.x
          const dy = (cy - r.y) * 2 // cells are ~2x tall
          const near = Math.abs(Math.sqrt(dx * dx + dy * dy) - radius)
          if (near > ringW) continue
          const v = fade * (1 - near / ringW)
          if (v <= 0.05) continue
          fb.set(cx, cy, RAMP[glyphIndex(Math.min(1, v), RAMP.length)]!, hsv(r.hue, r.sat, 0.4 + 0.6 * v))
        }
      }
    }

    if (this.glitch > 0.02) {
      const cols = x1 - x0 + 1
      const rows = y1 - y0 + 1
      const n = Math.floor(this.glitch * cols * rows * 0.07)
      for (let k = 0; k < n; k++) {
        const cx = x0 + ((this.rand() * cols) | 0)
        const cy = y0 + ((this.rand() * rows) | 0)
        const cp = GLITCH[(this.rand() * GLITCH.length) | 0]!
        fb.set(cx, cy, cp, this.rand() < 0.6 ? hsv(2, 0.75, 0.7) : hsv(0, 0, 0.85))
      }
    }
  }
}
