import type { Effect, FrameInfo } from './types'
import type { Framebuffer } from '../render/framebuffer'
import { hsv } from '../render/color'
import { glyphIndex, rampCodepoints } from '../render/glyphs'

const RAMP = rampCodepoints(' .,-~:;=!*#$@')

/**
 * A rotating ASCII torus (the classic "donut") with z-buffered luminance
 * shading. Reactive: rotation speed from params.speed, palette from
 * params.hue/saturation/brightness — so it spins faster and recolors with the
 * assistant's state. Adapted from the standard donut technique; original code.
 */
export class Torus implements Effect {
  readonly name = 'torus'
  private a = 0
  private b = 0
  private w = 0
  private h = 0
  private zbuf = new Float32Array(0)
  private lum = new Float32Array(0)
  private hue = new Float32Array(0)

  resize(width: number, height: number): void {
    this.ensure(width, height)
  }

  private ensure(width: number, height: number): void {
    if (width === this.w && height === this.h) return
    this.w = width
    this.h = height
    const n = Math.max(1, width * height)
    this.zbuf = new Float32Array(n)
    this.lum = new Float32Array(n)
    this.hue = new Float32Array(n)
  }

  render(fb: Framebuffer, info: FrameInfo): void {
    this.ensure(info.width, info.height)
    const w = this.w
    const h = this.h
    const p = info.params
    const hueOff = info.identity?.hue ?? 0 // this repo's palette rotation
    this.a += info.dt * (0.6 + p.speed * 0.8) * info.energy
    this.b += info.dt * (0.3 + p.speed * 0.5) * info.energy

    const zbuf = this.zbuf
    const lum = this.lum
    zbuf.fill(0)
    lum.fill(0)

    const cosA = Math.cos(this.a)
    const sinA = Math.sin(this.a)
    const cosB = Math.cos(this.b)
    const sinB = Math.sin(this.b)
    const R1 = 1
    const R2 = 2
    const K2 = 5
    const K1 = Math.min(w, h * 2) * 0.55
    const cx = w / 2
    const cy = h / 2

    for (let theta = 0; theta < 6.283; theta += 0.1) {
      const ct = Math.cos(theta)
      const st = Math.sin(theta)
      const circleX = R2 + R1 * ct
      const circleY = R1 * st
      for (let phi = 0; phi < 6.283; phi += 0.03) {
        const cp = Math.cos(phi)
        const sp = Math.sin(phi)
        const x = circleX * (cosB * cp + sinA * sinB * sp) - circleY * cosA * sinB
        const y = circleX * (sinB * cp - sinA * cosB * sp) + circleY * cosA * cosB
        const z = K2 + cosA * circleX * sp + circleY * sinA
        const ooz = 1 / z
        const sx = (cx + K1 * ooz * x) | 0
        const sy = (cy - K1 * 0.5 * ooz * y) | 0
        const L = cp * ct * sinB - cosA * ct * sp - sinA * st + cosB * (cosA * st - ct * sinA * sp)
        if (sx >= 0 && sx < w && sy >= 0 && sy < h && L > 0) {
          const i = sy * w + sx
          if (ooz > zbuf[i]!) {
            zbuf[i] = ooz
            lum[i] = L
            this.hue[i] = p.hueBase + hueOff + L * p.hueSpread * 0.5
          }
        }
      }
    }

    for (let i = 0; i < lum.length; i++) {
      const L = lum[i]!
      if (L <= 0) continue
      const n = Math.min(1, L / Math.SQRT2)
      const cp = RAMP[glyphIndex(n, RAMP.length)]!
      fb.set(i % w, (i / w) | 0, cp, hsv(this.hue[i]!, p.saturation, p.brightness * (0.3 + 0.7 * n)))
    }
  }
}
