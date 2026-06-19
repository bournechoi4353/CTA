import type { Framebuffer } from '../render/framebuffer'
import type { AssistantState } from '../state/assistantState'
import type { VisualParams } from '../state/driver'

/**
 * A repository's persistent visual fingerprint, seeded from its path + git state
 * and carried across sessions (see src/identity.ts + src/effects/fieldStore.ts).
 * Lets the same repo render the same signature field every launch — and a
 * different one from any other repo.
 */
export interface ArtIdentity {
  /** 32-bit seed driving field topology + particle spawn. */
  seed: number
  /** Palette rotation in degrees, added to the state's base hue. */
  hue: number
  /** Accumulated field lifetime (seconds) across sessions — offsets animation
   *  time so a relaunch *continues* the field instead of resetting it. */
  age: number
}

/** Per-frame timing/size/state context handed to an effect's `render`. */
export interface FrameInfo {
  /** Seconds since the previous frame (0 while paused). */
  dt: number
  /** Accumulated animation time in seconds (frozen while paused). */
  time: number
  /** Monotonic frame counter. */
  frame: number
  width: number
  height: number
  /** Motion multiplier from the effort/thinking level (low ~0.5 .. max ~1.6). */
  energy: number
  /** The assistant's current discrete state. */
  state: AssistantState
  /** Smoothly-interpolated visual knobs for the current state. */
  params: VisualParams
  /** This repo's persistent field fingerprint (absent → effects use defaults). */
  identity?: ArtIdentity
}

/**
 * A visual effect draws itself into the framebuffer each frame. Effects are
 * pure-ish: they read `info`, write cells, and hold only their own state.
 * State-reactive effects read `info.params` / `info.state`; static scenes
 * (plasma, starfield) ignore them.
 */
export interface Effect {
  readonly name: string
  /** Optional hook when the surface size changes. */
  resize?(width: number, height: number): void
  render(fb: Framebuffer, info: FrameInfo): void
}
