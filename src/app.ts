import { performance } from 'node:perf_hooks'
import { Terminal } from './terminal'
import { Renderer, type FlushStats } from './render/renderer'
import { rgb } from './render/color'
import type { Effect, FrameInfo } from './effects/types'
import { FlowField } from './effects/flowField'
import { Plasma } from './effects/plasma'
import { Starfield } from './effects/starfield'
import {
  ASSISTANT_STATES,
  STATE_LABEL,
  StateMachine,
} from './state/assistantState'
import { VisualDriver } from './state/driver'

const TARGET_FPS = 30
const FRAME_MS = 1000 / TARGET_FPS

// Headless smoke mode: run a bounded number of frames and exit (CTA_SMOKE=1).
const SMOKE = process.env['CTA_SMOKE'] === '1'
const SMOKE_FRAMES = 60

const HUD_FG = rgb(235, 235, 245)
const HUD_DIM = rgb(150, 150, 170)
const HUD_BG = rgb(0, 0, 0)

/**
 * Phase 2 harness: a state-reactive visualizer (flow field) whose look is driven
 * by the assistant state machine. State is faked here via number keys; Phase 3
 * wires it to the Claude Agent SDK's event stream. Plasma/starfield remain as
 * extra (non-reactive) scenes.
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
  const effects: Effect[] = [new FlowField(), new Plasma(), new Starfield()]
  let sceneIndex = 0
  let paused = false
  let debug = false
  let quit = false

  const machine = new StateMachine('idle')
  const driver = new VisualDriver()

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
        return
      case '\t': // Tab — cycle scene
        sceneIndex = (sceneIndex + 1) % effects.length
        effects[sceneIndex]?.resize?.(cols, rows)
        renderer.markDirty()
        return
      case ' ':
        paused = !paused
        return
      case 'd':
        debug = !debug
        return
      default:
        break
    }
    // Number keys 1..5 fake an assistant state transition.
    if (key >= '1' && key <= '5') {
      const next = ASSISTANT_STATES[key.charCodeAt(0) - 49]
      if (next) machine.set(next)
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

    // Self-correct the size every frame (a lagging resize must never paint at
    // stale dimensions).
    const size = term.size()
    if (size.cols !== cols || size.rows !== rows) {
      cols = size.cols
      rows = size.rows
      renderer.resize(cols, rows)
      effects[sceneIndex]?.resize?.(cols, rows)
    }

    const realDt = (frameStart - lastTick) / 1000
    lastTick = frameStart
    const dt = paused ? 0 : realDt
    simTime += dt
    machine.update(dt)
    const params = driver.update(dt, machine.state)

    fpsAccumMs += realDt * 1000
    fpsFrames += 1
    if (fpsAccumMs >= 250) {
      fps = (fpsFrames * 1000) / fpsAccumMs
      fpsAccumMs = 0
      fpsFrames = 0
    }

    const effect = effects[sceneIndex]!
    const info: FrameInfo = {
      dt,
      time: simTime,
      frame,
      width: cols,
      height: rows,
      state: machine.state,
      params,
    }

    const fb = renderer.begin()
    effect.render(fb, info)

    // HUD overlay — ASCII only, solid bg for legibility, drawn over the effect.
    fb.drawText(1, 0, ' CTA - reactive visualizer ', HUD_FG, HUD_BG)
    fb.drawText(1, 1, ` scene: ${effect.name}   state: ${STATE_LABEL[machine.state]}${paused ? '  (paused)' : ''} `, HUD_FG, HUD_BG)
    fb.drawText(1, 2, ` fps ${fps.toFixed(1)}   ${cols}x${rows} `, HUD_DIM, HUD_BG)
    if (debug) {
      fb.drawText(1, 3, ` redrawn ${stats.changed} cells   ${stats.bytes} bytes/frame `, HUD_DIM, HUD_BG)
    }
    fb.drawText(1, rows - 2, ' 1 idle   2 thinking   3 tool   4 responding   5 error ', HUD_DIM, HUD_BG)
    fb.drawText(1, rows - 1, ' [1-5] state   [Tab] scene   [space] pause   [d] debug   [q] quit ', HUD_DIM, HUD_BG)

    stats = renderer.flush()
    frame += 1

    const schedule = (): void => {
      const work = performance.now() - frameStart
      setTimeout(tick, Math.max(0, FRAME_MS - work))
    }
    if (stats.ok) {
      schedule()
    } else {
      // Backpressured: wait for drain before the next frame, with a timeout
      // fallback so the loop can never permanently stall.
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
