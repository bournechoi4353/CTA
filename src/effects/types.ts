import type { Framebuffer } from '../render/framebuffer'
import type { AssistantState } from '../state/assistantState'
import type { VisualParams } from '../state/driver'

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
  /** The assistant's current discrete state. */
  state: AssistantState
  /** Smoothly-interpolated visual knobs for the current state. */
  params: VisualParams
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
