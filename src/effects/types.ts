import type { Framebuffer } from '../render/framebuffer'

/** Per-frame timing/size context handed to an effect's `render`. */
export interface FrameInfo {
  /** Seconds since the previous frame (0 while paused). */
  dt: number
  /** Accumulated animation time in seconds (frozen while paused). */
  time: number
  /** Monotonic frame counter. */
  frame: number
  width: number
  height: number
}

/**
 * A visual effect draws itself into the framebuffer each frame. Effects are
 * pure-ish: they read `info`, write cells, and hold only their own state.
 *
 * Phase 2 will extend this with the assistant state so effects can react to it.
 */
export interface Effect {
  readonly name: string
  /** Optional hook when the surface size changes. */
  resize?(width: number, height: number): void
  render(fb: Framebuffer, info: FrameInfo): void
}
