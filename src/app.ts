import { performance } from 'node:perf_hooks'
import { Terminal } from './terminal'
import { Renderer, type FlushStats } from './render/renderer'
import { DEFAULT_COLOR } from './render/color'
import type { Framebuffer } from './render/framebuffer'
import type { Effect, FrameInfo } from './effects/types'
import { FlowField } from './effects/flowField'
import { Torus } from './effects/torus'
import { Matrix } from './effects/matrix'
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
import { deriveIdentity } from './identity'
import { loadField, saveField } from './effects/fieldStore'
import { InputLine } from './ui/input'
import { buildTranscript } from './ui/transcript'
import { toDisplay } from './ui/text'
import { drawModal } from './ui/modal'
import { drawBox, SYM } from './ui/box'
import { Fx } from './ui/fx'
import { formatEditDiff } from './ui/diff'
import { theme, applyTheme, THEME_NAMES, setBorders, setLayout } from './ui/theme'
import { loadConfig, saveConfig } from './configStore'
import type { StyledLine } from './ui/spans'

const VERSION = 'v0.1.0'
const TARGET_FPS = 60
const FRAME_MS = 1000 / TARGET_FPS
const SMOKE = process.env['SIGIL_SMOKE'] === '1'
const SMOKE_FRAMES = 60
const PLACEHOLDER = 'Ask about your code, or /help'
const EFFORT_ENERGY: Record<string, number> = { low: 0.5, medium: 0.75, high: 1.0, xhigh: 1.3, max: 1.6 }

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

export function run(initialPrompt?: string): void {
  const term = new Terminal()
  if (!term.isInteractive && !SMOKE) {
    process.stderr.write(
      'sigil needs an interactive terminal (a TTY). Run it directly in your shell.\n',
    )
    process.exitCode = 1
    return
  }

  term.enter()

  const config = loadConfig()
  let themeName = config.theme && THEME_NAMES.includes(config.theme) ? config.theme : 'nova'
  applyTheme(themeName)
  if (typeof config.asciiBorders === 'boolean') setBorders(config.asciiBorders)
  setLayout(config.layout !== 'panel') // borderless bleed is the default; 'panel' restores boxes

  let cols = term.size().cols
  let rows = term.size().rows
  const renderer = new Renderer(term, cols, rows)
  const effects: Effect[] = [new FlowField(), new Torus(), new Matrix(), new Plasma(), new Starfield()]
  let sceneIndex = config.scene ? Math.max(0, effects.findIndex((e) => e.name === config.scene)) : 0
  let quit = false

  const machine = new StateMachine('idle')
  const driver = new VisualDriver()
  const conversation = new Conversation()
  const input = new InputLine()
  if (initialPrompt) input.set(initialPrompt)
  const gate = new PermissionGate()
  const ask = new AskController()
  const agent = new AgentSession(gate, ask)
  if (config.effort && (EFFORTS as readonly string[]).includes(config.effort)) {
    agent.setEffort(config.effort as Effort)
  }
  if (config.permissionMode && ['default', 'acceptEdits', 'bypass', 'plan'].includes(config.permissionMode)) {
    gate.setMode(config.permissionMode as PermissionMode)
  }
  const fx = new Fx()
  const artBand = (): { x0: number; y0: number; x1: number; y1: number } => {
    const l = computeLayout(cols, rows)
    return { x0: 0, y0: l.headerH, x1: cols - 1, y1: Math.max(l.headerH, l.transcriptTop - 1) }
  }

  const session: { model?: string; auth?: string } = {}
  const usage = { input: 0, output: 0, cost: 0 }
  const history: string[] = []
  let historyIdx = 0
  let assistantTextThisTurn = false

  // --- per-repo art identity (Phase 9b) ---
  // The signature field is seeded from this repo and persists across sessions:
  // derive it once (first launch = the field's "birth"), then pin its seed/hue
  // and keep accumulating `age` so each relaunch *continues* the same field.
  const repoCwd = process.cwd()
  const storedField = loadField(repoCwd)
  const fieldBorn = storedField?.born ?? Date.now()
  const identity = storedField
    ? { seed: storedField.seed, hue: storedField.hue, age: storedField.age }
    : { ...deriveIdentity(repoCwd), age: 0 }
  if (!storedField) saveField(repoCwd, { ...identity, born: fieldBorn })
  const saveFieldAge = (): void => {
    saveField(repoCwd, { seed: identity.seed, hue: identity.hue, age: identity.age + simTime, born: fieldBorn })
  }

  let cache: { rev: number; width: number; bleed: boolean; lines: StyledLine[] } = { rev: -1, width: -1, bleed: theme.bleed, lines: [] }
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

  const burst = (hue: number, strength: number, life: number): void => {
    const b = artBand()
    fx.ripple((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, hue, { strength, life, maxR: Math.min(cols, rows * 2) * 0.55 })
  }

  const handlers: AgentHandlers = {
    onState: (state) => {
      if (state === 'error') fx.glitchPulse(1)
      machine.set(state)
    },
    onAssistantText: (text) => {
      assistantTextThisTurn = true
      conversation.appendToLast('assistant', toDisplay(text))
    },
    onToolUse: (name, input) => {
      conversation.add('system', `${SYM.mode} ${toDisplay(prettyTool(name))}`)
      burst(toolHue(name), 1.1, 0.9)
      if (input) {
        const diff = formatEditDiff(name, input)
        if (diff) conversation.add('diff', diff)
      }
    },
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
      if (!isError) burst(150, 0.8, 1.2)
      const id = agent.currentSessionId
      if (id) saveSession(process.cwd(), id)
    },
  }

  const persist = (): void => {
    saveConfig({
      theme: themeName,
      scene: effects[sceneIndex]?.name,
      effort: agent.currentEffort,
      asciiBorders: theme.asciiBorders,
      permissionMode: gate.permissionMode,
      layout: theme.bleed ? 'bleed' : 'panel',
    })
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
      case 'scene': {
        const arg = rest[0]
        if (arg) {
          const i = effects.findIndex((e) => e.name === arg)
          if (i >= 0) sceneIndex = i
          else conversation.add('system', `scenes: ${effects.map((e) => e.name).join(', ')}`)
        } else {
          sceneIndex = (sceneIndex + 1) % effects.length
        }
        effects[sceneIndex]?.resize?.(cols, rows)
        renderer.markDirty()
        persist()
        break
      }
      case 'theme': {
        const arg = rest[0]
        if (arg && applyTheme(arg)) themeName = arg
        else {
          themeName = THEME_NAMES[(THEME_NAMES.indexOf(themeName) + 1) % THEME_NAMES.length]!
          applyTheme(themeName)
        }
        renderer.markDirty()
        conversation.add('system', `theme: ${themeName}  (${THEME_NAMES.join(', ')})`)
        persist()
        break
      }
      case 'borders':
        setBorders(!theme.asciiBorders)
        renderer.markDirty()
        conversation.add('system', `borders: ${theme.asciiBorders ? 'ascii' : 'rounded'}`)
        persist()
        break
      case 'layout': {
        const arg = rest[0]
        if (arg === 'bleed' || arg === 'borderless') setLayout(true)
        else if (arg === 'panel' || arg === 'boxed' || arg === 'panelled') setLayout(false)
        else setLayout(!theme.bleed)
        renderer.markDirty() // geometry changed -> force a clean full repaint
        conversation.add('system', `layout: ${theme.bleed ? 'bleed (borderless, art-first)' : 'panel (boxed)'}`)
        persist()
        break
      }
      case 'field': {
        const hueStr = `${identity.hue >= 0 ? '+' : ''}${identity.hue}`
        if (rest[0] === 'new' || rest[0] === 'reroll') {
          const fresh = deriveIdentity(repoCwd, String(Date.now()))
          identity.seed = fresh.seed
          identity.hue = fresh.hue
          saveFieldAge()
          renderer.markDirty()
          conversation.add('system', `field rerolled${SYM.sep}seed ${identity.seed.toString(16)}${SYM.sep}hue ${identity.hue >= 0 ? '+' : ''}${identity.hue} deg`)
        } else {
          const ageMin = (identity.age + simTime) / 60
          conversation.add(
            'system',
            `this repo's field${SYM.sep}seed ${identity.seed.toString(16)}${SYM.sep}hue ${hueStr} deg${SYM.sep}age ${ageMin.toFixed(1)} min   (/field new to reroll)`,
          )
        }
        break
      }
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
        persist()
        break
      }
      case 'mode': {
        const m = rest[0]
        const valid = ['default', 'acceptEdits', 'bypass', 'plan']
        if (m && valid.includes(m)) {
          gate.setMode(m as PermissionMode)
          conversation.add('system', `permission mode: ${m}`)
          persist()
        } else {
          conversation.add('system', `permission modes: ${valid.join(', ')}  (bypass = full access; or shift+tab to cycle)`)
        }
        break
      }
      case 'help':
        conversation.add(
          'system',
          'commands: /help /clear /new /resume /scene [name] /theme [name] /layout [bleed|panel] /borders /field [new] /mode [bypass|acceptEdits|plan] /effort [level] /quit   keys: PgUp/PgDn scroll, shift+tab permissions, Esc cancels',
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
      persist()
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
    const action = input.handle(key)
    if (action === 'change') {
      const b = artBand()
      fx.ripple(Math.min(cols - 2, 4 + input.value.length), b.y1, 205, { strength: 0.5, life: 0.6, maxR: 8, sat: 0.55 })
    } else if (action === 'submit') {
      submit()
    }
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
      saveFieldAge() // checkpoint this repo's field lifetime before leaving
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

    // Graceful degradation: too small for the layout — show a hint and wait.
    if (cols < 40 || rows < 12) {
      const fb = renderer.begin()
      const msg = `sigil needs a bigger terminal (min 40x12, now ${cols}x${rows})`
      fb.drawText(Math.max(0, (cols - msg.length) >> 1), rows >> 1, msg.slice(0, cols), theme.warn, theme.hudBg)
      renderer.flush()
      setTimeout(tick, 250)
      return
    }

    const realDt = (frameStart - lastTick) / 1000
    lastTick = frameStart
    simTime += realDt
    machine.update(realDt)
    const params = driver.update(realDt, machine.state)
    const energy = EFFORT_ENERGY[agent.currentEffort] ?? 1

    const effect = effects[sceneIndex]!
    const info: FrameInfo = {
      dt: realDt,
      time: simTime,
      frame,
      width: cols,
      height: rows,
      energy,
      state: machine.state,
      params,
      identity,
    }

    const fb = renderer.begin()
    effect.render(fb, info) // the living art fills the screen behind the chrome
    fx.update(realDt)
    const band = artBand()
    fx.draw(fb, band.x0, band.y0, band.x1, band.y1)

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

    // transcript: inside the conversation box (panel), or as floating frosted
    // ribbons composited over the live art (bleed) — blank lines leave the field
    // showing through, so the chat reads like subtitles over video.
    const layout = computeLayout(cols, rows)
    const bleed = layout.bleed
    if (layout.transcriptH >= (bleed ? 1 : 3)) {
      const innerW = cols - 4
      const lineBg = bleed ? theme.scrimBg : theme.panelBg
      if (cache.rev !== conversation.revision || cache.width !== innerW || cache.bleed !== bleed) {
        cache = { rev: conversation.revision, width: innerW, bleed, lines: buildTranscript(conversation.all, innerW, lineBg) }
      }
      const total = cache.lines.length
      const winH = layout.transcriptH - (bleed ? 0 : 2)
      if (scroll > 0 && total > prevTotal) scroll += total - prevTotal
      prevTotal = total
      view.total = total
      view.winH = winH
      clampScroll()
      const startIdx = Math.max(0, total - winH - scroll)
      const yBase = layout.transcriptTop + (bleed ? 0 : 1)
      const visible = cache.lines.slice(startIdx, startIdx + winH)
      // In bleed, anchor a short conversation to the bottom (just above the
      // input) so the art owns the open space above it, not a mid-screen gap.
      const vOffset = bleed ? Math.max(0, winH - visible.length) : 0
      visible.forEach((line, i) => {
        const y = yBase + vOffset + i
        if (bleed) scrimStyledLine(fb, 2, y, line, innerW, lineBg)
        drawStyledLine(fb, 2, y, line, innerW)
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
    if (frame % 300 === 0) saveFieldAge() // periodic checkpoint (~10s) survives a crash

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
  const bleed = theme.bleed
  // Bleed trades box borders + a tall header/input for thin, single-row chrome,
  // so the art owns far more of the screen.
  const headerH = bleed ? (rows >= 16 ? 2 : 1) : rows >= 14 ? 4 : 3
  const statusRow = rows - 1
  const inputH = bleed ? 1 : 3 // 1 floating line vs a 3-row box
  const inputTop = statusRow - inputH
  const midRows = Math.max(0, inputTop - headerH)
  let transcriptH = 0
  if (bleed) {
    // Keep the transcript modest so a generous open art band sits above it; the
    // field still shows through the ribbon gaps regardless.
    if (midRows >= 6) transcriptH = Math.min(16, Math.max(3, Math.floor(midRows * 0.42)))
    else if (midRows >= 1) transcriptH = midRows
  } else {
    if (midRows >= 7) transcriptH = Math.min(16, Math.max(5, Math.floor(midRows * 0.42)))
    else if (midRows >= 3) transcriptH = midRows
  }
  const transcriptTop = inputTop - transcriptH
  return { headerH, statusRow, inputTop, inputH, transcriptTop, transcriptH, bleed }
}

export function composeUi(fb: Framebuffer, s: UiState): void {
  if (theme.bleed) {
    composeUiBleed(fb, s)
    return
  }
  const { cols } = s
  const layout = computeLayout(cols, s.rows)
  const model = toDisplay(s.model ?? 'claude')

  // --- header box ---
  drawBox(fb, 0, 0, cols, layout.headerH, { borderFg: theme.borderFg, bg: theme.panelBg, titleFg: theme.borderTitle })
  const stateText = STATE_LABEL[s.state] + (s.busy ? ' ...' : '')
  drawRow(
    fb,
    1,
    `${SYM.logo} sigil ${VERSION}${SYM.sep}${model}${SYM.sep}${planLabel(s.auth)}`,
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

// --- Borderless "bleed" layout ------------------------------------------------
// No boxes: the art fills the whole screen and the chrome (header, input, status)
// plus the chat float on content-width frosted ribbons, so the field bleeds
// through every gap between them and out to every edge.

const SCRIM_PAD = 1 // cells of frosted padding around each floating text group

/** Lay a frosted ribbon (blank glyphs over `bg`) on row `y`; clips to the screen. */
function scrimRibbon(fb: Framebuffer, x: number, y: number, w: number, bg: number): void {
  let sx = x
  let sw = w
  if (sx < 0) {
    sw += sx
    sx = 0
  }
  sw = Math.min(sw, fb.width - sx)
  if (sw > 0) fb.fillRect(sx, y, sw, 1, 0x20, DEFAULT_COLOR, bg)
}

/** Scrim a padded ribbon behind one text group, then draw the text onto it. */
function scrimText(fb: Framebuffer, x: number, y: number, text: string, fg: number, bg: number): void {
  if (text.length === 0) return
  scrimRibbon(fb, x - SCRIM_PAD, y, text.length + SCRIM_PAD * 2, bg)
  fb.drawText(x, y, text, fg, bg)
}

/** Scrim only the used width of a transcript line (blank lines stay pure art). */
function scrimStyledLine(fb: Framebuffer, x: number, y: number, line: StyledLine, maxW: number, bg: number): void {
  let len = 0
  for (const span of line.spans) len += span.text.length
  len = Math.min(len, maxW)
  if (len <= 0) return
  scrimRibbon(fb, x - SCRIM_PAD, y, len + SCRIM_PAD * 2, bg)
}

/** A left + right text group on one row, each on its own ribbon, art glowing between. */
function floatRow(
  fb: Framebuffer,
  y: number,
  left: string,
  leftFg: number,
  right: string,
  rightFg: number,
  x0: number,
  x1: number,
  bg: number,
): void {
  const width = x1 - x0 + 1
  if (width <= 0) return
  const r = right.length > width ? right.slice(0, width) : right
  const rightX = x1 - r.length + 1
  const leftMax = Math.max(0, rightX - x0 - 1) // keep a 1-cell art gap before the right group
  const l = left.length > leftMax ? left.slice(0, leftMax) : left
  if (l.length > 0) scrimText(fb, x0, y, l, leftFg, bg)
  if (r.length > 0) scrimText(fb, rightX, y, r, rightFg, bg)
}

function composeUiBleed(fb: Framebuffer, s: UiState): void {
  const { cols } = s
  const layout = computeLayout(cols, s.rows)
  const model = toDisplay(s.model ?? 'claude')
  const bg = theme.scrimBg
  const x0 = 1
  const x1 = cols - 2

  // --- header: title + live state, floating at the top edge ---
  const stateText = STATE_LABEL[s.state] + (s.busy ? ' ...' : '')
  floatRow(
    fb,
    0,
    `${SYM.logo} sigil ${VERSION}${SYM.sep}${model}${SYM.sep}${planLabel(s.auth)}`,
    theme.hudFg,
    stateText,
    theme.accent,
    x0,
    x1,
    bg,
  )
  if (layout.headerH >= 2) {
    floatRow(fb, 1, toDisplay(process.cwd()), theme.system, `ask about your code${SYM.sep}/help`, theme.system, x0, x1, bg)
  }

  // --- input: one floating line with a caret; ribbon stays visible when empty ---
  const iy = layout.inputTop
  const label = '> '
  const maxText = Math.max(4, cols - x0 - 3)
  const empty = s.inputValue.length === 0
  const visible = empty
    ? PLACEHOLDER.slice(0, maxText)
    : s.inputValue.length > maxText
      ? s.inputValue.slice(s.inputValue.length - maxText)
      : s.inputValue
  const ribbonW = Math.min(cols - x0 + SCRIM_PAD, Math.max(Math.min(cols - x0, 36), label.length + visible.length + 1 + SCRIM_PAD * 2))
  scrimRibbon(fb, x0 - SCRIM_PAD, iy, ribbonW, bg)
  fb.drawText(x0, iy, label, theme.accent, bg)
  const tx = x0 + label.length
  if (empty) {
    fb.set(tx, iy, 0x20, DEFAULT_COLOR, theme.accent) // caret block
    fb.drawText(tx + 1, iy, visible.slice(0, Math.max(0, maxText - 1)), theme.placeholder, bg)
  } else {
    fb.drawText(tx, iy, visible, theme.assistant, bg)
    fb.set(tx + visible.length, iy, 0x20, DEFAULT_COLOR, theme.accent) // caret block
  }

  // --- status: permission mode + live stats, floating at the bottom edge ---
  const cancelHint = s.busy ? `${SYM.sep}Esc cancels` : ''
  const left = `${SYM.mode} ${modeLabel(s.mode)}  (shift+tab)${cancelHint}`
  const scrollTag = s.scroll > 0 ? `${SYM.sep}scroll +${s.scroll}` : ''
  const right = `${SYM.dot} ${s.effort}${SYM.sep}${STATE_LABEL[s.state]}${SYM.sep}${model}${SYM.sep}${formatTokens(s.tokens)} tok${SYM.sep}$${s.cost.toFixed(4)}${scrollTag}`
  floatRow(fb, layout.statusRow, left, theme.warn, right, theme.system, x0, x1, bg)
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

function toolHue(name: string): number {
  const t = name.toLowerCase()
  if (t.includes('read')) return 190
  if (t.includes('glob') || t.includes('grep') || t.includes('search')) return 55
  if (t.includes('edit') || t.includes('write') || t.includes('notebook')) return 135
  if (t.includes('bash')) return 22
  if (t.includes('ask')) return 300
  return 210
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
