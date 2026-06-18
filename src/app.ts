import { performance } from 'node:perf_hooks'
import { basename } from 'node:path'
import { Terminal } from './terminal'
import { Renderer, type FlushStats } from './render/renderer'
import { rgb, DEFAULT_COLOR } from './render/color'
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
import { AgentSession } from './agent/client'
import type { AgentHandlers } from './agent/events'
import { Conversation, type Role } from './agent/conversation'
import { InputLine } from './ui/input'
import { transcriptLines } from './ui/transcript'
import { toDisplay } from './ui/text'

const TARGET_FPS = 30
const FRAME_MS = 1000 / TARGET_FPS

const SMOKE = process.env['CTA_SMOKE'] === '1'
const SMOKE_FRAMES = 60

const HUD_FG = rgb(235, 235, 245)
const HUD_BG = rgb(0, 0, 0)
const PANEL_BG = rgb(12, 12, 18)
const TEXT_USER = rgb(125, 205, 255)
const TEXT_ASSISTANT = rgb(228, 228, 238)
const TEXT_SYSTEM = rgb(120, 120, 145)
const ACCENT = rgb(125, 205, 255)

function roleColor(role: Role): number {
  return role === 'user' ? TEXT_USER : role === 'system' ? TEXT_SYSTEM : TEXT_ASSISTANT
}

/**
 * Phase 3 — "it's alive". The flow-field visualizer is the assistant's face; a
 * transcript + input panel sits below it. Typing a question runs a Claude Agent
 * SDK turn whose streamed events drive the state machine, so the face reacts
 * live (thinking → tool-running → responding → idle) while the answer prints.
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
  let quit = false

  const machine = new StateMachine('idle')
  const driver = new VisualDriver()
  const conversation = new Conversation()
  const input = new InputLine()
  const agent = new AgentSession()
  const session: { model?: string; auth?: string } = {}
  let assistantTextThisTurn = false

  conversation.add('system', 'Ask about your code. Enter sends, Ctrl-C quits. /help for commands.')

  const handlers: AgentHandlers = {
    onState: (state) => machine.set(state),
    onAssistantText: (text) => {
      assistantTextThisTurn = true
      conversation.appendToLast('assistant', toDisplay(text))
    },
    onToolUse: (name) => conversation.add('system', `> ${toDisplay(name)}`),
    onSystemInit: (info) => {
      session.model = info.model
      session.auth = info.apiKeySource
    },
    onResult: (text, isError) => {
      if (isError) conversation.add('system', `! ${toDisplay(text)}`)
      else if (!assistantTextThisTurn && text.length > 0) conversation.appendToLast('assistant', toDisplay(text))
    },
  }

  const runCommand = (line: string): void => {
    const [cmd, ...rest] = line.slice(1).split(/\s+/)
    switch (cmd) {
      case 'quit':
      case 'exit':
        quit = true
        break
      case 'clear':
        conversation.clear()
        break
      case 'scene':
        sceneIndex = (sceneIndex + 1) % effects.length
        effects[sceneIndex]?.resize?.(cols, rows)
        renderer.markDirty()
        break
      case 'state': {
        const want = rest[0]
        const match = ASSISTANT_STATES.find((s) => s === want)
        if (match) machine.set(match)
        else conversation.add('system', `states: ${ASSISTANT_STATES.join(', ')}`)
        break
      }
      case 'help':
        conversation.add('system', 'commands: /help  /clear  /scene  /state <name>  /quit')
        break
      default:
        conversation.add('system', `unknown command: /${cmd ?? ''}`)
        break
    }
  }

  const offKey = term.onKey((key) => {
    if (key === '\x03') {
      quit = true
      return
    }
    if (input.handle(key) !== 'submit') return

    const line = input.value.trim()
    if (line.length === 0) {
      input.clear()
      return
    }
    if (line.startsWith('/')) {
      input.clear()
      runCommand(line)
      return
    }
    if (agent.isBusy) return // keep the text; ignore until the current turn finishes

    input.clear()
    conversation.add('user', line)
    assistantTextThisTurn = false
    machine.set('thinking')
    void agent.send(line, handlers)
  })

  const stop = (): void => {
    offKey()
    term.leave()
  }

  const start = performance.now()
  let lastTick = start
  let frame = 0
  let simTime = 0
  let fps = 0
  let fpsAccumMs = 0
  let fpsFrames = 0
  let stats: FlushStats = { changed: 0, bytes: 0, ok: true }

  const tick = (): void => {
    if (quit || (SMOKE && frame >= SMOKE_FRAMES)) {
      stop()
      return
    }

    const frameStart = performance.now()

    const size = term.size()
    if (size.cols !== cols || size.rows !== rows) {
      cols = size.cols
      rows = size.rows
      renderer.resize(cols, rows)
      effects[sceneIndex]?.resize?.(cols, rows)
    }

    const realDt = (frameStart - lastTick) / 1000
    lastTick = frameStart
    simTime += realDt
    machine.update(realDt)
    const params = driver.update(realDt, machine.state)

    fpsAccumMs += realDt * 1000
    fpsFrames += 1
    if (fpsAccumMs >= 250) {
      fps = (fpsFrames * 1000) / fpsAccumMs
      fpsAccumMs = 0
      fpsFrames = 0
    }

    const effect = effects[sceneIndex]!
    const info: FrameInfo = {
      dt: realDt,
      time: simTime,
      frame,
      width: cols,
      height: rows,
      state: machine.state,
      params,
    }

    const fb = renderer.begin()
    effect.render(fb, info) // the "face" fills the screen behind the UI

    // --- UI overlay -------------------------------------------------------
    const inputRow = rows - 1
    const panelH = Math.max(3, Math.min(12, rows - 4))
    const panelTop = inputRow - panelH

    // Top status bar.
    const status = ` CTA | ${STATE_LABEL[machine.state]}${agent.isBusy ? ' ...' : ''} | ${session.model ?? 'claude'} | auth:${session.auth ?? '-'} | ${basename(process.cwd())} `
    fb.drawText(0, 0, toDisplay(status).slice(0, cols), HUD_FG, HUD_BG)

    // Chat panel background (transcript + input row).
    fb.fillRect(0, panelTop, cols, panelH + 1, 0x20, DEFAULT_COLOR, PANEL_BG)

    // Transcript.
    const lines = transcriptLines(conversation.all, cols - 2, panelH)
    let ty = panelTop
    for (const l of lines) {
      fb.drawText(1, ty, l.text.slice(0, cols - 2), roleColor(l.role), PANEL_BG)
      ty += 1
    }

    // Input line with a block cursor.
    const shown = `> ${input.value}`
    const maxShown = Math.max(0, cols - 3)
    const visible = shown.length > maxShown ? shown.slice(shown.length - maxShown) : shown
    fb.drawText(1, inputRow, visible, TEXT_ASSISTANT, PANEL_BG)
    fb.set(1 + visible.length, inputRow, 0x20, DEFAULT_COLOR, ACCENT)

    stats = renderer.flush()
    frame += 1

    const schedule = (): void => {
      const work = performance.now() - frameStart
      setTimeout(tick, Math.max(0, FRAME_MS - work))
    }
    if (stats.ok) {
      schedule()
    } else {
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
