import type { AssistantState } from './assistantState'

/**
 * The visual knobs an effect reads. The driver smoothly interpolates these
 * toward the active state's target each frame, so the visualizer *morphs*
 * between states instead of snapping.
 */
export interface VisualParams {
  /** Base hue in degrees. */
  hueBase: number
  /** How far hue varies across the field (degrees). */
  hueSpread: number
  saturation: number
  brightness: number
  /** Fraction of particles active, 0..1. */
  density: number
  /** Velocity multiplier. */
  speed: number
  /** Flow-field distortion / chaos. */
  turbulence: number
  /** Trail persistence, 0..1 (higher = longer trails). */
  trail: number
}

// Per-state look. Tuned to read at a glance: cool & calm idle, churning violet
// thinking, directed green tool-use, warm lively responding, dim red error.
const TARGETS: Record<AssistantState, VisualParams> = {
  idle:       { hueBase: 205, hueSpread: 50, saturation: 0.55, brightness: 0.62, density: 0.35, speed: 0.50, turbulence: 0.5, trail: 0.80 },
  thinking:   { hueBase: 275, hueSpread: 70, saturation: 0.72, brightness: 0.72, density: 0.70, speed: 0.95, turbulence: 1.3, trail: 0.50 },
  tool:       { hueBase: 135, hueSpread: 35, saturation: 0.80, brightness: 0.75, density: 0.60, speed: 1.20, turbulence: 0.4, trail: 0.55 },
  responding: { hueBase: 35,  hueSpread: 75, saturation: 0.85, brightness: 0.88, density: 0.95, speed: 1.40, turbulence: 0.9, trail: 0.45 },
  error:      { hueBase: 2,   hueSpread: 18, saturation: 0.45, brightness: 0.50, density: 0.30, speed: 0.25, turbulence: 0.5, trail: 0.70 },
}

// Smoothing time constant (seconds). Smaller = snappier state transitions.
const TAU = 0.45

export class VisualDriver {
  private readonly cur: VisualParams = { ...TARGETS.idle }

  /** Step the current params toward the active state's target. */
  update(dt: number, state: AssistantState): VisualParams {
    const target = TARGETS[state]
    const k = dt <= 0 ? 0 : 1 - Math.exp(-dt / TAU)
    const c = this.cur
    c.hueBase = lerpAngle(c.hueBase, target.hueBase, k)
    c.hueSpread = lerp(c.hueSpread, target.hueSpread, k)
    c.saturation = lerp(c.saturation, target.saturation, k)
    c.brightness = lerp(c.brightness, target.brightness, k)
    c.density = lerp(c.density, target.density, k)
    c.speed = lerp(c.speed, target.speed, k)
    c.turbulence = lerp(c.turbulence, target.turbulence, k)
    c.trail = lerp(c.trail, target.trail, k)
    return c
  }

  get params(): VisualParams {
    return this.cur
  }
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k
}

// Interpolate along the shortest path around the 360° hue circle.
function lerpAngle(a: number, b: number, k: number): number {
  const d = (((b - a) % 360) + 540) % 360 - 180
  return a + d * k
}
