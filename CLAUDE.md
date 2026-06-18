# CLAUDE.md

Guidance for Claude Code (and any AI agent) working in this repo.

## Status

**Phase 5 + Claude-Code-style layout built.** North star: **"Claude Code, but
mine"** — a Claude-Agent-SDK coding assistant with the user's living art as the
centerpiece, **no mascot**. The UI is now a calm **bordered layout**: a rounded
**header box** (`✦ CTA · model · plan · cwd · tips`), the **flow-field art band**
in the middle (the centerpiece), a titled **conversation box**, a **input box**
with placeholder, and a **status line** (`▸ permission-mode (shift+tab to cycle) ·
state · model · tokens · cost`). Box widget: [src/ui/box.ts](src/ui/box.ts);
rounded Unicode by default, ASCII fallback via `theme.asciiBorders`. **Permission
modes** cycle with `shift+tab`: ask-before-writes → auto-accept-edits → bypass →
plan/read-only ([src/agent/permissions.ts](src/agent/permissions.ts)). Render
output is **ASCII + a curated chrome glyph set** (box-drawing plus `· ✦ ▸ ●`);
arbitrary model output is still sanitized to ASCII — verified 0 control bytes / no
stray glyphs. The compositor is `composeUi()` in [src/app.ts](src/app.ts).

**Agent capabilities (added on top):** the agent can **ask the user preference
questions** via an in-process `ask_user` tool ([src/agent/ask.ts](src/agent/ask.ts))
rendered as a numbered modal — the built-in `AskUserQuestion` is disallowed so
ours is used. A running turn can be **cancelled** with `Esc` (`Options.abortController`
+ `agent.cancel()`). The model's **thinking level / effort** is set with
`/effort [low|medium|high|xhigh|max]` (`Options.effort`), shown in the status line.
`zod` is now a dependency (for the `ask_user` tool schema). These are wired and
typecheck against the SDK, but the *live* behavior (model choosing to ask, abort
actually interrupting, effort applied) needs a real run to confirm.

**Phase 6 — effects library & theming.** Scene library (`/scene [name]` or
cycle): flowfield, **torus** ([src/effects/torus.ts](src/effects/torus.ts), a
rotating ASCII donut), **matrix** ([src/effects/matrix.ts](src/effects/matrix.ts),
digital rain), plasma, starfield — the reactive scenes read the state driver, so
any can be the "face". Swappable chrome **themes** (`/theme [nova|matrix|amber|mono]`)
via [src/ui/theme.ts](src/ui/theme.ts) (a live-mutated `theme` object that all
modules read), a `/borders` rounded↔ascii toggle, all persisted to
[~/.cta/config.json](src/configStore.ts) (theme/scene/effort/borders) and restored
on launch. `applyTheme()` reassigns `theme`'s fields in place, so switches
propagate without re-importing.

**Phase 8 — the art reacts.** A transient **fx** layer ([src/ui/fx.ts](src/ui/fx.ts))
draws ripples + glitch over the art band: each tool use fires a hue-coded
**ripple** (Read=cyan, Edit=green, Bash=orange…), **errors glitch** the field,
turns burst, and **typing sends ripples** up from the input. Effort scales motion
via `info.energy` (low=calm, max=storm) in the reactive effects. The transcript
shows **diffs** (a `diff` turn role, red/green, from [src/ui/diff.ts](src/ui/diff.ts))
when the agent edits, and code blocks are **syntax-highlighted**
([src/ui/syntax.ts](src/ui/syntax.ts)). All fx/diff/syntax output stays ASCII (the
render invariant holds). The live feel (ripples on real tool use, diffs on real
edits) needs a real run to judge, but the wiring typechecks against the SDK.

Underneath, the chat renders **markdown**
([src/ui/markdown.ts](src/ui/markdown.ts)) — fenced code blocks, headers,
bullets, inline `code`/**bold** — as colored spans
([src/ui/spans.ts](src/ui/spans.ts)) over a cached, **scrollable** transcript
(PgUp/PgDn, Home/End; auto-follows newest unless you scroll up). A status bar
shows state · model · tokens · cost · cwd · scroll. The input line has **history**
(Up/Down) and **slash commands** (`/help /clear /new /resume /scene /state
/quit`). **Session resume** persists the last session per project
([~/.cta/sessions.json](src/agent/sessionStore.ts)); `/resume` continues it.
Colors are centralized in [src/ui/theme.ts](src/ui/theme.ts). (The compositor is
inline in [src/app.ts](src/app.ts), not a separate module.) Phase 4's
approval-gate modal is unchanged.

> Verified headless: markdown render + span wrap + ASCII-safety, transcript,
> session-store round-trip. Live-only (confirm on a real run): token/cost totals
> populate from `result` messages, `/resume`'s SDK reconnect, and scroll feel.

**Next: Phase 6 — effects library & theming** (port more scenes, palettes,
config) — see [PLAN.md](PLAN.md). Sections below describing later phases are
intent, not fact yet.

## What CTA is

A terminal-resident **coding companion**. Claude drives the conversation and
coding tools via the Claude Agent SDK; a **from-scratch ANSI render loop** draws
a **reactive visualizer** — an ambient "face" that animates based on what the
assistant is doing (idle / thinking / running a tool / responding).

Locked decisions:

| | |
|---|---|
| Art role   | Reactive visualizer (state-driven), alongside chat + input |
| Purpose    | Coding companion — reads/edits code, runs commands, in your repos |
| Art source | From scratch — our own ANSI renderer + effects (no curses lib) |
| Stack      | TypeScript / Node |

Open decision (gates Phase 3, see PLAN.md): **auth model** — API key vs. the
subscription-via-CLI-subprocess path.

## Architecture

Three concerns, deliberately decoupled:

```
 input ─┐
        ▼
   ┌─────────┐   state    ┌────────────┐   draws   ┌──────────┐
   │  agent  │──transitions▶│ state machine│──params─▶│  effects │
   │ (Claude)│            └────────────┘           └────┬─────┘
   └─────────┘                                          │ cells
        ▲                                               ▼
        │ tools/permissions                      ┌────────────┐
        └────────────────────────────────────────│  renderer  │─▶ stdout (ANSI)
                                                  └────────────┘
```

- **Renderer** owns the screen: a double-buffered cell grid, diffed each frame,
  flushed as ANSI to stdout. Knows nothing about Claude.
- **Effects** are pure-ish draw routines: `(dt, state, framebuffer) → draws`.
  No global state. Ported from the AsciiCreativeCoding reference (see below).
- **State machine** is the contract between the two: assistant state → visual
  params (palette, density, speed, turbulence, glyph ramp).
- **Agent** wires the Claude Agent SDK; its streamed events drive state
  transitions; its tool calls go through a permission gate.

The point of this split: the renderer and effects can be built and tested
(Phases 0–2) with **zero** AI/auth involvement; the agent layer plugs in at
Phase 3.

## Target directory layout

Materializes as phases land. `✓` = exists today (Phase 0); the rest is intent.

```
src/
  index.ts            # bin entry                                         ✓
  terminal.ts         # alt screen, raw mode, resize, teardown            ✓
  app.ts              # frame loop + HUD; drives the renderer              ✓
  render/
    framebuffer.ts    # cell grid (typed arrays), double buffer            ✓
    renderer.ts       # diff two buffers → minimal ANSI; resize            ✓
    color.ts          # packed RGB, HSV, truecolor + 256 fallback          ✓
    glyphs.ts         # brightness → glyph ramps                           ✓
  effects/
    types.ts          # Effect interface                                   ✓
    plasma.ts         # full-frame stress scene                            ✓
    starfield.ts      # sparse-diff stress scene                           ✓
    flowField.ts      # reactive flow-field (state-driven)                ✓
    torus.ts          # reactive rotating ASCII donut                     ✓
    matrix.ts         # reactive digital rain                             ✓
  state/
    assistantState.ts # state enum + machine                              ✓
    driver.ts         # state → interpolated visual params                ✓
  agent/
    client.ts         # AgentSession: turns, resume, gating, effort, cancel    ✓
    events.ts         # SDKMessage → state + text + usage + notices            ✓
    ask.ts            # ask_user preference-question controller                ✓
    conversation.ts   # chat transcript model (+ revision counter)             ✓
    debug.ts          # CTA_DEBUG raw-message log                              ✓
    permissions.ts    # write/Bash gate (queue, always-allow, mode cycle)      ✓
    sessionStore.ts   # persist last session id per project                    ✓
  ui/
    input.ts          # raw-mode line editor + history recall                  ✓
    transcript.ts     # conversation -> styled lines (markdown)                ✓
    markdown.ts       # markdown -> styled spans (code/headers/bullets)        ✓
    spans.ts          # Span/StyledLine + span-aware wrap                      ✓
    wrap.ts           # plain word-wrap helper                                 ✓
    text.ts           # sanitize text -> safe single-width ASCII               ✓
    modal.ts          # ASCII approval-modal box                               ✓
    box.ts            # rounded/ascii bordered boxes + chrome symbols          ✓
    fx.ts             # ripples + glitch over the art (events/keystrokes)      ✓
    syntax.ts         # code-block syntax highlighting                         ✓
    diff.ts           # edit/write -> red/green diff text                      ✓
    theme.ts          # swappable palettes (nova/matrix/amber/mono)          ✓
  configStore.ts      # persisted prefs: ~/.cta/config.json                   ✓
PLAN.md   CLAUDE.md   CREDITS.md
```

## Commands

Tooling: `tsx` (dev), `tsup`/esbuild (build), TypeScript strict, Node ≥ 20.

| Command | Purpose |
|---|---|
| `npm run dev`        | run from source via tsx (interactive TUI) |
| `npm run dev:watch`  | same, reloading on file changes |
| `npm run build`      | bundle to `dist/` (tsup) |
| `npm start`          | run the built binary (`node dist/index.js`) |
| `npm run typecheck`  | `tsc --noEmit` |

Headless check: `CTA_SMOKE=1 npm start` runs a bounded number of frames and
exits `0` — used to verify the loop without a TTY.

## Rendering model & terminal gotchas

This is the project's hard-won, easy-to-get-wrong core. Read before touching
anything under `src/render/` or `src/ui/`.

- **Alternate screen buffer.** Enter on start (`\x1b[?1049h`), leave on exit
  (`\x1b[?1049l`). The user's scrollback must be untouched when CTA quits.
- **Always restore the terminal** on *every* exit path — normal quit, `SIGINT`,
  `SIGTERM`, uncaught exception, `process.on('exit')`. Restore **must** reset SGR
  attributes and the G0 charset (`\x1b[0m\x1b(B`) in addition to autowrap
  (`\x1b[?7h`), cursor (`\x1b[?25h`), raw mode, and the alt screen
  (`\x1b[?1049l`). **Skipping the SGR+charset reset bleeds the last frame's color
  and garbles glyphs into the user's shell** — looks like a corrupted terminal
  (hit in Phase 1; fixed in [src/terminal.ts](src/terminal.ts)). A half-restored
  terminal is the #1 way to ruin the experience.
- **Raw mode** for input (`process.stdin.setRawMode(true)`); restore on exit.
- **NEVER `console.log` while in the alt screen / raw mode.** It corrupts the
  frame. Route all diagnostics to a debug file (e.g. `CTA_DEBUG=1` → append to a
  logfile) or an in-TUI log pane. This will bite anyone who forgets.
- **Hide the cursor** during animation (`\x1b[?25l`).
- **Diff, don't repaint.** Compare the new framebuffer to the previous one and
  emit only changed cells, positioned with `\x1b[<row>;<col>H`. Full-screen
  clears every frame = flicker. Build **one string per frame** and write it in a
  single `stdout.write`.
- **Truecolor** fg `\x1b[38;2;r;g;bm`, bg `\x1b[48;2;r;g;bm`. Detect via
  `COLORTERM` (`truecolor`/`24bit`); fall back to 256-color (`\x1b[38;5;Nm`).
- **Resize:** listen on `process.stdout.on('resize')`, rebuild the framebuffer
  to the new `columns`/`rows`, force a full redraw.
- **Frame loop:** fixed timestep; cap to ~30–60fps so we don't peg a CPU.
  Decouple simulation update from render where it matters.
- **Backpressure:** `stdout.write` returns `false` when the OS buffer is full;
  writing the next frame anyway can truncate a frame mid-escape and garble the
  screen. Wait for `'drain'` (with a timeout fallback) before the next frame.
- **Self-heal:** force a full *no-clear* repaint every ~60 frames so transient
  corruption can't linger in a sparse scene. (`markDirty()` on the renderer.)
- **Only emit printable ASCII + well-formed escapes.** Sanitize every glyph to a
  printable char before writing — a single control/C1 byte desyncs the parser
  and turns everything after it into "creepy text". This matters most in Phase 3
  when we render *model output*: never pass arbitrary text straight to stdout.

## Assistant state machine

The visual contract. States and what each should *feel* like:

| State | Trigger (intent) | Visual intent |
|---|---|---|
| `idle`        | nothing happening / awaiting input | calm, slow drift |
| `thinking`    | model is reasoning, pre-output | tightening, building energy |
| `responding`  | assistant is emitting text | flowing, lively |
| `tool-running`| a tool (bash/edit/read) is executing | focused, mechanical |
| `error`       | refusal / failure | stalled / desaturated |

`state/driver.ts` maps each to concrete effect params. Transitions are driven by
the agent event stream (Phase 3+); the input layer may also set states locally
(e.g. while the user is typing). Keep the *enum* and the *driver* the single
source of truth — effects read params, they don't decide state.

## Claude Agent SDK integration (Phase 3+)

Verified facts (confirm specifics against the installed SDK when we get there):

- **Package:** `@anthropic-ai/claude-agent-sdk`. Primary entry is an async
  generator `query({ prompt, options })` you iterate for streamed messages.
- **Runtime model:** the SDK **spawns the `claude` CLI binary as a subprocess**
  and talks to it over stdio. The CLI binary ships as an optional dependency.
- **Auth:** supported path is the **`ANTHROPIC_API_KEY`** env var (per-token
  billing). Anthropic's docs say SDK-built apps should **not** rely on
  Claude.ai/subscription login. The subscription path (riding the logged-in
  CLI) is a personal-use gray area — see PLAN.md Decision #1. For dev, set
  `ANTHROPIC_API_KEY`.
- **Tools:** enable built-ins via `allowedTools: ["Read","Write","Edit","Bash",
  "Glob","Grep"]`. Gate them with a `canUseTool(name, input)` callback returning
  `{behavior:"allow"}` / `{behavior:"deny", message}`, and/or `permissionMode`
  (`default` | `acceptEdits` | `plan` | `bypassPermissions`). Our TUI renders the
  callback as an approval modal.
- **⚠️ `canUseTool` REQUIRES streaming-input mode** — `prompt` must be an
  `AsyncIterable<SDKUserMessage>`, **not a string**. With a string prompt, every
  tool that routes through `canUseTool` (Write/Edit/Bash) throws an
  "environment-level error" while auto-approved tools still work. So
  [src/agent/client.ts](src/agent/client.ts) yields the user message from an async
  generator and holds the input open until the turn's `result`. Do **not** revert
  to a string prompt. (Likewise `setModel`/`setPermissionMode` need streaming input.)
- **Event → state mapping (implemented in [src/agent/events.ts](src/agent/events.ts)):**
  the stream is `AsyncGenerator<SDKMessage>`; discriminate on `msg.type` —
  `system`/`subtype:'init'` → thinking (carries `model`, `cwd`, `apiKeySource`,
  `tools`), `assistant` (read `msg.message.content[]` blocks: `text` →
  responding, `tool_use` → tool, `thinking` → thinking), `user` (tool_result) →
  thinking, `result`/`subtype:'success'` → idle (`.result` is the final text) /
  error subtypes → error. Content blocks are typed loosely on purpose (the beta
  block union is large). Still **confirm against a live run via `CTA_DEBUG`** —
  shapes weren't runnable in the build env.
- **MCP** (later): configured via `options.mcpServers` (`{ command, args, env }`
  or `{ type:"http"|"sse", url, headers }`); tools surface as `mcp__<server>__*`.

## Claude API / model facts

Mostly handled by the Agent SDK, but if any code touches the raw Anthropic API:

- **Default model: `claude-opus-4-8`.** Others: `claude-sonnet-4-6` (balanced),
  `claude-haiku-4-5` (fast/cheap). These IDs are **current and real** even if
  they look unfamiliar — do **not** "correct" them to older names.
- Opus/Sonnet 4.x use **adaptive thinking** (`thinking:{type:"adaptive"}`); the
  old `budget_tokens` and `temperature`/`top_p` are removed (400 on 4.7/4.8).
- Control depth with `output_config:{effort: "low|medium|high|xhigh|max"}`
  (`xhigh` is the Claude Code default for coding/agentic work).
- For anything non-trivial about the API/SDK, invoke the `claude-api` skill or
  consult docs.claude.com rather than guessing.

## Conventions

- **TypeScript strict.** Prefer the SDK's exported types over re-declaring them.
- **Effects are pure-ish:** receive `(dt, state, framebuffer)`, draw, return
  nothing. No reaching into global state or the renderer's internals.
- **The renderer is the only thing that writes to stdout.** Everything else
  draws into a framebuffer. (The agent's text output is composited through the
  transcript pane, not printed directly.)
- Match the style of surrounding code; keep dependencies minimal — the render
  loop is hand-rolled on purpose.

## Reference resources

- **[PLAN.md](PLAN.md)** — the phased build plan and the source of truth for
  what to build next and in what order.
- **AsciiCreativeCoding** (`https://github.com/prtamil/AsciiCreativeCoding`) —
  MIT-licensed C/ncurses collection of 337 creative-coding demos. **Use as a
  reference for effect *math*, not as a dependency** (different language, and it
  uses ncurses — the opposite of our hand-rolled renderer). Port algorithms into
  `src/effects/`, rewrite draw calls against our framebuffer, and credit the
  author in `CREDITS.md`.

## Don't

- Don't `console.log` / print to stdout while the TUI is active.
- Don't leave the terminal dirty on exit — restore alt-screen, raw mode, cursor,
  autowrap, **SGR attributes, and the G0 charset** (`\x1b[0m\x1b(B`).
- Don't add a curses-style TUI framework — the from-scratch renderer *is* the
  project.
- Don't link or shell out to AsciiCreativeCoding binaries — port the math.
- Don't hard-code Agent SDK event names from memory — verify against the stream.
