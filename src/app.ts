import { performance } from 'node:perf_hooks'
import { Terminal } from './terminal'
import { Renderer, type FlushStats } from './render/renderer'
import { DEFAULT_COLOR } from './render/color'
import type { Framebuffer } from './render/framebuffer'
import type { Effect, FrameInfo } from './effects/types'
import { FlowField } from './effects/flowField'
import { Plasma } from './effects/plasma'
import { Starfield } from './effects/starfield'
import { ASSISTANT_STATES, STATE_LABEL, StateMachine, type AssistantState } from './state/assistantState'
import { VisualDriver } from './state/driver'
import { AgentSession, EFFORTS, type Effort } from './agent/client'
import type { AgentHandlers } from './agent/events'
import { Conversation } from './agent/conversation'
import { PermissionGate, type PermissionMode } from './agent/permissions'
import { AskController } from './agent/ask'
import { loadSession, saveSession } from './agent/sessionStore'
import { InputLine } from './ui/input'
import { buildTranscript } from './ui/transcript'
import { toDisplay } from './ui/text'
import { drawModal } from './ui/modal'
import { drawBox, SYM } from './ui/box'
import { theme } from './ui/theme'
import type { StyledLine } from './ui/spans'

const VERSION = 'v0.1.0'
const TARGET_FPS = 30
const FRAME_MS = 1000 / TARGET_FPS
const SMOKE = process.env['CTA_SMOKE'] === '1'
const SMOKE_FRAMES = 60
const PLACEHOLDER = 'Ask about your code, or /help'

const K = {
  ctrlC: '\x03',
  esc: '\x1b',
  up: '\x1b[A',
  down: '\x1b[B',
  shiftTab: '\x1b[Z',
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
  const ask = new AskController()
  const agent = new AgentSession(gate, ask)

  const session: { model?: string; auth?: string } = {}
  const usage = { input: 0, output: 0, cost: 0 }
  const history: string[] = []
  let historyIdx = 0
  let assistantTextThisTurn = false

  let cache: { rev: number; width: number; lines: StyledLine[] } = { rev: -1, width: -1, lines: [] }
  let scroll = 0
  let prevTotal = 0
  const view = { total: 0, winH: 1 }

  const resumable = loadSession(process.cwd())
  conversation.add(
    'system',
    resumable
      ? 'Welcome back. A previous session was found - type /resume to continue it, or just ask.'
      : 'Ask about your code. Try "what does src/app.ts do?" or /help for commands.',
  )

  const handlers: AgentHandlers = {
    onState: (state) => machine.set(state),
    onAssistantText: (text) => {
      assistantTextThisTurn = true
      conversation.appendToLast('assistant', toDisplay(text))
    },
    onToolUse: (name) => conversation.add('system', `${SYM.mode} ${toDisplay(prettyTool(name))}`),
    onSystemInit: (info) => {
      session.model = info.model
      session.auth = info.apiKeySource
    },
    onUsage: (u) => {
      usage.input += u.input
      usage.output += u.output
      usage.cost += u.costUsd
    },
    onNotice: (text) => conversation.add('system', toDisplay(text)),
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
      case 'effort': {
        const arg = rest[0]
        if (arg && (EFFORTS as readonly string[]).includes(arg)) agent.setEffort(arg as Effort)
        else agent.setEffort(EFFORTS[(EFFORTS.indexOf(agent.currentEffort) + 1) % EFFORTS.length]!)
        conversation.add('system', `effort (thinking level): ${agent.currentEffort}`)
        break
      }
      case 'help':
        conversation.add(
          'system',
          'commands: /help /clear /new /resume /scene /state <name> /effort [low|medium|high|xhigh|max] /quit   keys: PgUp/PgDn scroll, Up/Down history, shift+tab cycles permissions, Esc cancels a running turn',
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
    if (agent.isBusy) return

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
    scroll = Math.max(0, Math.min(scroll, max))
  }

  const offKey = term.onKey((key) => {
    if (key === K.ctrlC) {
      quit = true
      return
    }
    if (ask.current) {
      if (key === K.esc) {
        agent.cancel()
        return
      }
      if (key.length === 1) {
        const q = ask.current
        const idx = key.charCodeAt(0) - 49 // '1' -> 0
        if (idx >= 0 && idx < q.options.length) {
          conversation.add('system', `? ${toDisplay(q.question)} ${SYM.mode} ${toDisplay(q.options[idx] ?? '')}`)
          ask.answer(idx)
        }
      }
      return
    }
    if (gate.current) {
      if (key === 'y' || key === 'Y') gate.decide('allow')
      else if (key === 'a' || key === 'A') gate.decide('always')
      else if (key === 'n' || key === 'N' || key === K.esc) gate.decide('deny')
      return
    }
    if (key === K.shiftTab) {
      gate.cycleMode()
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
      if (agent.isBusy) {
        agent.cancel()
        return
      }
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
    effect.render(fb, info) // the living art fills the screen behind the chrome

    composeUi(fb, {
      cols,
      rows,
      state: machine.state,
      busy: agent.isBusy,
      model: session.model,
      auth: session.auth,
      mode: gate.permissionMode,
      effort: agent.currentEffort,
      tokens: usage.input + usage.output,
      cost: usage.cost,
      inputValue: input.value,
      scroll,
    })

    // transcript inside the conversation box
    const layout = computeLayout(cols, rows)
    if (layout.transcriptH >= 3) {
      const innerW = cols - 4
      if (cache.rev !== conversation.revision || cache.width !== innerW) {
        cache = { rev: conversation.revision, width: innerW, lines: buildTranscript(conversation.all, innerW) }
      }
      const total = cache.lines.length
      const winH = layout.transcriptH - 2
      if (scroll > 0 && total > prevTotal) scroll += total - prevTotal
      prevTotal = total
      view.total = total
      view.winH = winH
      clampScroll()
      const startIdx = Math.max(0, total - winH - scroll)
      cache.lines.slice(startIdx, startIdx + winH).forEach((line, i) => {
        drawStyledLine(fb, 2, layout.transcriptTop + 1 + i, line, innerW)
      })
    }

    const question = ask.current
    if (question) {
      drawModal(fb, cols, rows, {
        title: 'a question for you',
        lines: [question.question, '', ...question.options.map((o, i) => `${i + 1}) ${o}`)],
        footer: `press 1-${question.options.length} to choose   |   Esc to cancel`,
      })
    }
    const pending = gate.current
    if (pending && !question) {
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

export interface UiState {
  cols: number
  rows: number
  state: AssistantState
  busy: boolean
  model?: string
  auth?: string
  mode: PermissionMode
  effort: string
  tokens: number
  cost: number
  inputValue: string
  scroll: number
}

export function computeLayout(cols: number, rows: number) {
  const headerH = rows >= 14 ? 4 : 3
  const statusRow = rows - 1
  const inputTop = statusRow - 3 // 3-row input box
  const midRows = Math.max(0, inputTop - headerH)
  let transcriptH = 0
  if (midRows >= 7) transcriptH = Math.min(16, Math.max(5, Math.floor(midRows * 0.42)))
  else if (midRows >= 3) transcriptH = midRows
  const transcriptTop = inputTop - transcriptH
  return { headerH, statusRow, inputTop, transcriptTop, transcriptH }
}

export function composeUi(fb: Framebuffer, s: UiState): void {
  const { cols } = s
  const layout = computeLayout(cols, s.rows)
  const model = toDisplay(s.model ?? 'claude')

  // --- header box ---
  drawBox(fb, 0, 0, cols, layout.headerH, { borderFg: theme.borderFg, bg: theme.panelBg, titleFg: theme.borderTitle })
  const stateText = STATE_LABEL[s.state] + (s.busy ? ' ...' : '')
  drawRow(
    fb,
    1,
    `${SYM.logo} CTA ${VERSION}${SYM.sep}${model}${SYM.sep}${planLabel(s.auth)}`,
    theme.hudFg,
    stateText,
    theme.accent,
    theme.panelBg,
    2,
    cols - 3,
  )
  if (layout.headerH >= 4) {
    drawRow(fb, 2, toDisplay(process.cwd()), theme.system, `ask about your code${SYM.sep}/help`, theme.system, theme.panelBg, 2, cols - 3)
  }

  // --- conversation box (transcript drawn separately in run loop) ---
  if (layout.transcriptH >= 2) {
    drawBox(fb, 0, layout.transcriptTop, cols, layout.transcriptH, {
      borderFg: theme.borderFg,
      bg: theme.panelBg,
      title: 'conversation',
      titleFg: theme.borderTitle,
    })
  }

  // --- input box ---
  drawBox(fb, 0, layout.inputTop, cols, 3, { borderFg: theme.borderFg, bg: theme.panelBg })
  const iy = layout.inputTop + 1
  fb.drawText(2, iy, '> ', theme.accent, theme.panelBg)
  const tx = 4
  const maxText = Math.max(0, cols - tx - 2)
  if (s.inputValue.length === 0) {
    fb.set(tx, iy, 0x20, DEFAULT_COLOR, theme.accent) // cursor block
    fb.drawText(tx + 1, iy, PLACEHOLDER.slice(0, Math.max(0, maxText - 1)), theme.placeholder, theme.panelBg)
  } else {
    const visible = s.inputValue.length > maxText ? s.inputValue.slice(s.inputValue.length - maxText) : s.inputValue
    fb.drawText(tx, iy, visible, theme.assistant, theme.panelBg)
    fb.set(tx + visible.length, iy, 0x20, DEFAULT_COLOR, theme.accent)
  }

  // --- status line ---
  fb.fillRect(0, layout.statusRow, cols, 1, 0x20, DEFAULT_COLOR, theme.hudBg)
  const cancelHint = s.busy ? `${SYM.sep}Esc cancels` : ''
  const left = `${SYM.mode} ${modeLabel(s.mode)}  (shift+tab)${cancelHint}`
  const scrollTag = s.scroll > 0 ? `${SYM.sep}scroll +${s.scroll}` : ''
  const right = `${SYM.dot} ${s.effort}${SYM.sep}${STATE_LABEL[s.state]}${SYM.sep}${model}${SYM.sep}${formatTokens(s.tokens)} tok${SYM.sep}$${s.cost.toFixed(4)}${scrollTag}`
  drawRow(fb, layout.statusRow, left, theme.warn, right, theme.system, theme.hudBg, 1, cols - 2)
}

// Draw a left-aligned and a right-aligned string on the same row within [x0, x1].
function drawRow(
  fb: Framebuffer,
  y: number,
  left: string,
  leftFg: number,
  right: string,
  rightFg: number,
  bg: number | undefined,
  x0: number,
  x1: number,
): void {
  const width = x1 - x0 + 1
  if (width <= 0) return
  const r = right.slice(0, width)
  const rightX = x1 - r.length + 1
  const leftMax = Math.max(0, rightX - x0 - 1)
  if (leftMax > 0) fb.drawText(x0, y, left.slice(0, leftMax), leftFg, bg ?? theme.panelBg)
  if (r.length > 0) fb.drawText(rightX, y, r, rightFg, bg ?? theme.panelBg)
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

function prettyTool(name: string): string {
  return name.startsWith('mcp__') ? (name.split('__').pop() ?? name) : name
}

function planLabel(auth?: string): string {
  switch (auth) {
    case 'oauth':
      return 'subscription'
    case 'user':
    case 'project':
    case 'org':
      return 'api key'
    case 'temporary':
      return 'temp key'
    default:
      return auth ?? 'auth: -'
  }
}

function modeLabel(mode: PermissionMode): string {
  switch (mode) {
    case 'acceptEdits':
      return 'auto-accept edits'
    case 'bypass':
      return 'bypass permissions'
    case 'plan':
      return `plan${SYM.sep}read-only`
    default:
      return 'ask before writes'
  }
}
