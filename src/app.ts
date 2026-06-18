import { performance } from 'node:perf_hooks'
import { Terminal } from './terminal'
import { Renderer, type FlushStats } from './render/renderer'
import { rgb } from './render/color'
import type { Effect, FrameInfo } from './effects/types'
import { Plasma } from './effects/plasma'
import { Starfield } from './effects/starfield'

const TARGET_FPS = 30
const FRAME_MS = 1000 / TARGET_FPS

// Headless smoke mode: run a bounded number of frames and exit (CTA_SMOKE=1).
const SMOKE = process.env['CTA_SMOKE'] === '1'
const SMOKE_FRAMES = 60

const HUD_FG = rgb(235, 235, 245)
const HUD_DIM = rgb(150, 150, 170)
const HUD_BG = rgb(0, 0, 0)

/**
 * Phase 1 harness: drive the render engine with a switchable stress scene and a
 * small (ASCII-only) HUD overlay. Phases 2+ replace the scene list with the
 * real, state-reactive visualizer and add the agent/transcript/input panes.
 */
export function run(): void {
  const term = new Terminal()

  if (!term.isInteractive && !SMOKE) {
    process.stderr.write(
      'CTA needs an interactive terminal (a TTY). Run it directly in your shell.\n',
    )
    process.exitCode = 1
    return
  }

  term.enter()

  let cols = term.size().cols
  let rows = term.size().rows
  const renderer = new Renderer(term, cols, rows)
  const effects: Effect[] = [new Plasma(), new Starfield()]
  let sceneIndex = 0
  let paused = false
  let debug = false
  let quit = false

  const start = performance.now()
  let lastTick = start
  let frame = 0
  let simTime = 0
  let fps = 0
  let fpsAccumMs = 0
  let fpsFrames = 0
  let stats: FlushStats = { changed: 0, bytes: 0, ok: true }

  const offKey = term.onKey((key) => {
    switch (key) {
      case 'q':
      case '\x03': // Ctrl-C
        quit = true
        break
      case '\t': // Tab — cycle scene
        sceneIndex = (sceneIndex + 1) % effects.length
        effects[sceneIndex]?.resize?.(cols, rows)
        renderer.markDirty()
        break
      case ' ':
        paused = !paused
        break
      case 'd':
        debug = !debug
        break
      default:
        break
    }
  })

  const stop = (): void => {
    offKey()
    term.leave()
  }

  const tick = (): void => {
    if (quit || (SMOKE && frame >= SMOKE_FRAMES)) {
      stop()
      return
    }

    const frameStart = performance.now()

    // Self-correct the size every frame: a delayed or coalesced resize event can
    // never leave us painting a frame sized to stale dimensions (a corruption
    // source). renderer.resize() forces a full repaint when the size changes.
    const size = term.size()
    if (size.cols !== cols || size.rows !== rows) {
      cols = size.cols
      rows = size.rows
      renderer.resize(cols, rows)
      effects[sceneIndex]?.resize?.(cols, rows)
    }

    const dt = (frameStart - lastTick) / 1000
    lastTick = frameStart
    if (!paused) simTime += dt

    fpsAccumMs += dt * 1000
    fpsFrames += 1
    if (fpsAccumMs >= 250) {
      fps = (fpsFrames * 1000) / fpsAccumMs
      fpsAccumMs = 0
      fpsFrames = 0
    }

    const effect = effects[sceneIndex]!
    const info: FrameInfo = {
      dt: paused ? 0 : dt,
      time: simTime,
      frame,
      width: cols,
      height: rows,
    }

    const fb = renderer.begin()
    effect.render(fb, info)

    // HUD overlay — ASCII only, solid bg for legibility, drawn over the effect.
    fb.drawText(1, 0, ' CTA - render engine ', HUD_FG, HUD_BG)
    fb.drawText(1, 1, ` scene: ${effect.name}${paused ? '  (paused)' : ''} `, HUD_FG, HUD_BG)
    fb.drawText(1, 2, ` fps ${fps.toFixed(1)}   ${cols}x${rows} `, HUD_DIM, HUD_BG)
    if (debug) {
      fb.drawText(1, 3, ` redrawn ${stats.changed} cells   ${stats.bytes} bytes/frame `, HUD_DIM, HUD_BG)
    }
    fb.drawText(1, rows - 1, ' [Tab] scene   [space] pause   [d] debug   [q] quit ', HUD_DIM, HUD_BG)

    stats = renderer.flush()
    frame += 1

    const schedule = (): void => {
      const work = performance.now() - frameStart
      setTimeout(tick, Math.max(0, FRAME_MS - work))
    }
    if (stats.ok) {
      schedule()
    } else {
      // Backpressured: don't pile up writes (truncated writes are a corruption
      // source). Wait for the stream to drain, with a timeout fallback so the
      // loop can never permanently stall.
      let resumed = false
      const resume = (): void => {
        if (resumed) return
        resumed = true
        schedule()
      }
      term.onceDrain(resume)
      setTimeout(resume, 100)
    }
  }

  tick()
}
