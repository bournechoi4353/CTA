import type { Effect, FrameInfo } from './types'
import type { Framebuffer } from '../render/framebuffer'
import { hsv } from '../render/color'
import { glyphIndex, rampCodepoints } from '../render/glyphs'

const RAMP_CP = rampCodepoints() // ' .:-=+*#%@'
const TAU = Math.PI * 2

/**
 * Flow-field particles (the signature reactive scene). Particles ride a smooth,
 * animated vector field and deposit fading "ink" into a persistent buffer, which
 * is rendered as density-graded trails — the look from the reference screenshots.
 *
 * Everything visible is driven by `info.params` (from the state driver): density
 * → particle count, speed → velocity, turbulence → field chaos, trail → fade,
 * hue/saturation/brightness → palette. So the same effect morphs with the
 * assistant's state.
 *
 * The AsciiCreativeCoding reference (Tamilselvan R, MIT) is our effect
 * inspiration (see CREDITS.md). This is an original implementation of the
 * flow-field-particles technique — our own trig field, not a port of its code.
 */
export class FlowField implements Effect {
  readonly name = 'flowfield'

  private w = 0
  private h = 0
  private intensity = new Float32Array(0)
  private hueBuf = new Float32Array(0)
  private px = new Float32Array(0)
  private py = new Float32Array(0)
  private plife = new Float32Array(0)
  private pool = 0
  private seed = 0x9e3779b1

  // Per-repo topology, derived from the art identity's seed (see applyIdentity).
  // Defaults reproduce the original field, so the effect is unchanged when no
  // identity is supplied.
  private idSeed = -1
  private fScale = 1 // field spatial scale
  private ph1 = 0 // phase offsets per flow term
  private ph2 = 0
  private ph3 = 0
  private ay = 1.3 // y-axis frequency multiplier
  private axy = 0.7 // diagonal (x+y) frequency multiplier
  private swirl = 1 // flow handedness (+1 / -1)

  resize(width: number, height: number): void {
    this.ensureSize(width, height)
  }

  /**
   * Re-derive the field's per-repo shape from a seed: spatial scale, three phase
   * offsets, axis/diagonal frequencies, and handedness — enough that two repos
   * swirl visibly differently. Also reseeds the particle PRNG so the ink layout
   * differs too. Deterministic: same seed → same field.
   */
  private applyIdentity(seed: number): void {
    this.idSeed = seed
    let s = seed >>> 0
    const next = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 0xffffffff
    }
    this.fScale = 0.75 + next() * 0.75 // 0.75 .. 1.5
    this.ph1 = next() * TAU
    this.ph2 = next() * TAU
    this.ph3 = next() * TAU
    this.ay = 1.0 + next() * 0.8 // 1.0 .. 1.8
    this.axy = 0.45 + next() * 0.6 // 0.45 .. 1.05
    this.swirl = next() < 0.5 ? -1 : 1
    this.seed = seed >>> 0 // particle spawn PRNG
  }

  render(fb: Framebuffer, info: FrameInfo): void {
    const id = info.identity
    if (id && id.seed !== this.idSeed) this.applyIdentity(id.seed)
    this.ensureSize(info.width, info.height)
    const w = this.w
    const h = this.h
    const p = info.params
    const t = info.time + (id?.age ?? 0) // continue this repo's field across sessions
    const hueOff = id?.hue ?? 0
    const dt = info.dt
    const intensity = this.intensity
    const hueBuf = this.hueBuf

    // Fade existing ink — longer trails when params.trail is high. Raised to
    // the frame's share of a 30fps step so the trail length is the same in
    // wall-clock time at any frame rate (and doesn't shorten when we hit 60fps).
    const fade = Math.pow(0.7 + 0.27 * clamp01(p.trail), dt * 30)
    for (let i = 0; i < intensity.length; i++) intensity[i]! *= fade

    // Advance the active particles (count scales with density).
    const active = Math.max(1, Math.floor(this.pool * clamp01(p.density)))
    const speed = 12 * p.speed * info.energy
    const aspect = 0.5 // cells are ~2x tall as wide

    for (let i = 0; i < active; i++) {
      const ang = this.angleAt(this.px[i]!, this.py[i]!, t, p.turbulence)
      const x = this.px[i]! + Math.cos(ang) * speed * dt
      const y = this.py[i]! + Math.sin(ang) * speed * dt * aspect
      const life = this.plife[i]! - dt

      if (life <= 0 || x < 0 || y < 0 || x >= w || y >= h) {
        this.respawn(i)
        continue
      }
      this.px[i] = x
      this.py[i] = y
      this.plife[i] = life

      const cell = (y | 0) * w + (x | 0)
      const v = intensity[cell]! + 0.6
      intensity[cell] = v > 1.4 ? 1.4 : v
      // Hue follows flow direction, spread around the palette's base.
      hueBuf[cell] = p.hueBase + (Math.cos(ang) * 0.5) * p.hueSpread
    }

    // Render the ink field as glyphs + color.
    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const i = cy * w + cx
        const v = intensity[i]!
        if (v <= 0.06) continue
        const n = v > 1 ? 1 : v
        const cp = RAMP_CP[glyphIndex(n, RAMP_CP.length)]!
        const color = hsv(hueBuf[i]! + hueOff, p.saturation, p.brightness * (0.25 + 0.75 * n))
        fb.set(cx, cy, cp, color)
      }
    }
  }

  private ensureSize(width: number, height: number): void {
    if (width === this.w && height === this.h) return
    this.w = width
    this.h = height
    const n = Math.max(1, width * height)
    this.intensity = new Float32Array(n)
    this.hueBuf = new Float32Array(n)
    this.pool = Math.max(64, Math.min(4000, Math.floor(width * height * 0.7)))
    this.px = new Float32Array(this.pool)
    this.py = new Float32Array(this.pool)
    this.plife = new Float32Array(this.pool)
    for (let i = 0; i < this.pool; i++) this.respawn(i)
  }

  private respawn(i: number): void {
    this.px[i] = this.rand() * this.w
    this.py[i] = this.rand() * this.h
    this.plife[i] = 0.5 + this.rand() * 2.5
  }

  // Smooth, animated flow angle at (x, y). Turbulence scales spatial frequency;
  // the per-repo scale/phase/handedness (from applyIdentity) shape the swirl.
  private angleAt(x: number, y: number, t: number, turbulence: number): number {
    const f = 0.06 * this.fScale * (0.5 + turbulence)
    const a =
      Math.sin(x * f + t * 0.6 + this.ph1) +
      Math.cos(y * f * this.ay - t * 0.4 + this.ph2) +
      Math.sin((x + y) * f * this.axy * this.swirl + t * 0.3 + this.ph3)
    return a * Math.PI
  }

  // Deterministic PRNG (keeps the field reproducible / headless-smoke stable).
  private rand(): number {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 0xffffffff
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
