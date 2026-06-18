import { performance } from 'node:perf_hooks'
import { basename } from 'node:path'
import { Terminal } from './terminal'
import { Renderer, type FlushStats } from './render/renderer'
import { DEFAULT_COLOR } from './render/color'
import type { Framebuffer } from './render/framebuffer'
import type { Effect, FrameInfo } from './effects/types'
import { FlowField } from './effects/flowField'
import { Plasma } from './effects/plasma'
import { Starfield } from './effects/starfield'
import { ASSISTANT_STATES, STATE_LABEL, StateMachine } from './state/assistantState'
import { VisualDriver } from './state/driver'
import { AgentSession } from './agent/client'
import type { AgentHandlers } from './agent/events'
import { Conversation } from './agent/conversation'
import { PermissionGate } from './agent/permissions'
import { loadSession, saveSession } from './agent/sessionStore'
import { InputLine } from './ui/input'
import { buildTranscript } from './ui/transcript'
import { toDisplay } from './ui/text'
import { drawModal } from './ui/modal'
import { theme } from './ui/theme'
import type { StyledLine } from './ui/spans'

const TARGET_FPS = 30
const FRAME_MS = 1000 / TARGET_FPS
const SMOKE = process.env['CTA_SMOKE'] === '1'
const SMOKE_FRAMES = 60

// Key sequences we intercept before the input line.
const K = {
  ctrlC: '\x03',
  esc: '\x1b',
  up: '\x1b[A',
  down: '\x1b[B',
  pageUp: '\x1b[5~',
  pageDown: '\x1b[6~',
  home: ['\x1b[H', '\x1b[1~'],
  end: ['\x1b[F', '\x1b[4~'],
}

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
  const gate = new PermissionGate()
  const agent = new AgentSession(gate)

  const session: { model?: string; auth?: string } = {}
  const usage = { input: 0, output: 0, cost: 0 }
  const history: string[] = []
  let historyIdx = 0
  let assistantTextThisTurn = false

  // Transcript line cache + scroll state.
  let cache: { rev: number; width: number; lines: StyledLine[] } = { rev: -1, width: -1, lines: [] }
  let scroll = 0 // lines scrolled up from the bottom (0 = following newest)
  let prevTotal = 0
  const view = { total: 0, winH: 1 }

  const resumable = loadSession(process.cwd())
  conversation.add(
    'system',
    resumable
      ? 'Ask about your code. Enter sends, Ctrl-C quits. /help for commands. A previous session was found - /resume to continue it.'
      : 'Ask about your code. Enter sends, Ctrl-C quits. /help for commands.',
  )

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
    onUsage: (u) => {
      usage.input += u.input
      usage.output += u.output
      usage.cost += u.costUsd
    },
    onResult: (text, isError) => {
      if (isError) conversation.add('system', `! ${toDisplay(text)}`)
      else if (!assistantTextThisTurn && text.length > 0) conversation.appendToLast('assistant', toDisplay(text))
      const id = agent.currentSessionId
      if (id) saveSession(process.cwd(), id)
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
        const match = ASSISTANT_STATES.find((s) => s === rest[0])
        if (match) machine.set(match)
        else conversation.add('system', `states: ${ASSISTANT_STATES.join(', ')}`)
        break
      }
      case 'resume':
        if (resumable) {
          agent.resume(resumable)
          conversation.add('system', `resumed session ${resumable.slice(0, 8)} - context restored (scrollback is not)`)
        } else {
          conversation.add('system', 'no previous session to resume')
        }
        break
      case 'new':
        agent.reset()
        conversation.clear()
        conversation.add('system', 'new session')
        break
      case 'help':
        conversation.add(
          'system',
          'commands: /help  /clear  /new  /resume  /scene  /state <name>  /quit   keys: PgUp/PgDn scroll, Up/Down history',
        )
        break
      default:
        conversation.add('system', `unknown command: /${cmd ?? ''}`)
        break
    }
  }

  const submit = (): void => {
    const value = input.value.trim()
    if (value.length === 0) {
      input.clear()
      return
    }
    if (value.startsWith('/')) {
      input.clear()
      runCommand(value)
      return
    }
    if (agent.isBusy) return // keep the text; ignore until the current turn finishes

    input.clear()
    history.push(value)
    historyIdx = history.length
    conversation.add('user', value)
    assistantTextThisTurn = false
    scroll = 0
    machine.set('thinking')
    void agent.send(value, handlers)
  }

  const clampScroll = (): void => {
    const max = Math.max(0, view.total - view.winH)
    if (scroll > max) scroll = max
    if (scroll < 0) scroll = 0
  }

  const offKey = term.onKey((key) => {
    if (key === K.ctrlC) {
      quit = true
      return
    }
    if (gate.current) {
      if (key === 'y' || key === 'Y') gate.decide('allow')
      else if (key === 'a' || key === 'A') gate.decide('always')
      else if (key === 'n' || key === 'N' || key === K.esc) gate.decide('deny')
      return
    }

    const page = Math.max(1, view.winH - 1)
    if (key === K.pageUp) {
      scroll += page
      clampScroll()
      return
    }
    if (key === K.pageDown) {
      scroll -= page
      clampScroll()
      return
    }
    if (K.home.includes(key)) {
      scroll = Math.max(0, view.total - view.winH)
      return
    }
    if (K.end.includes(key)) {
      scroll = 0
      return
    }
    if (key === K.up) {
      if (history.length > 0 && historyIdx > 0) {
        historyIdx -= 1
        input.set(history[historyIdx] ?? '')
      }
      return
    }
    if (key === K.down) {
      if (historyIdx < history.length) {
        historyIdx += 1
        input.set(historyIdx === history.length ? '' : (history[historyIdx] ?? ''))
      }
      return
    }
    if (key === K.esc) {
      input.clear()
      return
    }

    if (input.handle(key) === 'submit') submit()
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
    effect.render(fb, info)

    // --- layout ---
    const inputRow = rows - 1
    const panelH = Math.max(3, Math.min(14, rows - 4))
    const panelTop = inputRow - panelH

    // status bar
    const tokens = usage.input + usage.output
    const scrollTag = scroll > 0 ? ` | scroll +${scroll}` : ''
    const status = ` CTA | ${STATE_LABEL[machine.state]}${agent.isBusy ? ' ...' : ''} | ${session.model ?? 'claude'} | ${formatTokens(tokens)} tok | $${usage.cost.toFixed(4)} | ${basename(process.cwd())}${scrollTag} `
    fb.fillRect(0, 0, cols, 1, 0x20, DEFAULT_COLOR, theme.hudBg)
    fb.drawText(0, 0, toDisplay(status).slice(0, cols), theme.hudFg, theme.hudBg)

    // chat panel
    fb.fillRect(0, panelTop, cols, panelH + 1, 0x20, DEFAULT_COLOR, theme.panelBg)

    // transcript (cached; rebuilt on change or resize)
    const innerW = cols - 2
    if (cache.rev !== conversation.revision || cache.width !== innerW) {
      cache = { rev: conversation.revision, width: innerW, lines: buildTranscript(conversation.all, innerW) }
    }
    const total = cache.lines.length
    const winH = panelH
    if (scroll > 0 && total > prevTotal) scroll += total - prevTotal // hold position as new lines arrive
    prevTotal = total
    view.total = total
    view.winH = winH
    clampScroll()

    const startIdx = Math.max(0, total - winH - scroll)
    const visibleLines = cache.lines.slice(startIdx, startIdx + winH)
    visibleLines.forEach((line, i) => drawStyledLine(fb, 1, panelTop + i, line, innerW))

    // input line + cursor
    const shown = `> ${input.value}`
    const maxShown = Math.max(0, cols - 3)
    const visible = shown.length > maxShown ? shown.slice(shown.length - maxShown) : shown
    fb.drawText(1, inputRow, visible, theme.assistant, theme.panelBg)
    fb.set(1 + visible.length, inputRow, 0x20, DEFAULT_COLOR, theme.accent)

    // permission modal (on top)
    const pending = gate.current
    if (pending) {
      const more = gate.queued > 1 ? `   (+${gate.queued - 1} more)` : ''
      drawModal(fb, cols, rows, {
        title: `permission required - ${pending.title}`,
        lines: pending.detail,
        footer: `[y] allow   [a] always allow   [n] deny${more}`,
      })
    }

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
      const resumeLoop = (): void => {
        if (resumed) return
        resumed = true
        schedule()
      }
      term.onceDrain(resumeLoop)
      setTimeout(resumeLoop, 100)
    }
  }

  tick()
}

function drawStyledLine(fb: Framebuffer, x: number, y: number, line: StyledLine, maxW: number): void {
  let used = 0
  for (const span of line.spans) {
    if (used >= maxW) break
    const text = span.text.length > maxW - used ? span.text.slice(0, maxW - used) : span.text
    if (text.length > 0) fb.drawText(x + used, y, text, span.fg, span.bg)
    used += text.length
  }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
