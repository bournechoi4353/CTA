# CTA — Build Plan

> **CTA — "Claude Code, but mine."** A terminal coding assistant on the Claude
> Agent SDK, with the user's own living terminal art (a state-reactive flow-field
> visualizer) as the personality and UI centerpiece, dressed in a Claude-Code-style
> bordered layout (rounded boxes, welcome header, input box, status line) — and
> deliberately **no mascot**. *(Working name — "Claude Terminal Assistant".)*

## Decisions locked

| Decision        | Choice                                                                 |
| --------------- | --------------------------------------------------------------------- |
| Art role        | **Reactive visualizer** — the assistant's ambient "face", state-driven |
| Purpose         | **Coding companion** — reads/edits code, runs commands, in your repos  |
| Art source      | **From scratch** — our own ANSI render loop + effects                  |
| Stack           | **TypeScript / Node** — Agent SDK is first-class here                  |

## Decisions still open (don't block the start)

1. **Auth model** *(gates Phase 3, not before)* — supported path is an
   `ANTHROPIC_API_KEY` (per-token). "Runs on my subscription" is the gray-area
   CLI-subprocess path; works for personal use, not officially supported. Pick by Phase 3.
2. **Truecolor floor** — assume 24-bit color (modern terminals) with a 256-color
   fallback, or require truecolor? Default: assume truecolor, degrade gracefully.

## Principles

- **Vertical slice first.** Get "you type → art reacts → Claude answers" working
  end-to-end early (Phase 3), then deepen. No long horizontal build.
- **Every phase ends in something demoable.** A gate you can look at and judge.
- **The render engine is the hard part**, not the AI wiring. Budget accordingly.
- **You steer at each gate.** I build a phase, we look, we adjust, next phase.

---

## Timeline

Effort is T-shirt size (scope/complexity), not calendar time — I'm doing the
building, so wall-clock per phase is short. The **order** and the **"done when"**
gates are the real content.

### Phase 0 — Scaffold & TUI bootstrap · **S** · ✅ done
Repo setup: TypeScript, build (tsup/esbuild), `bin` entry, raw-mode terminal,
alternate screen buffer, clean teardown on exit/Ctrl-C, a fixed-timestep loop.
- **Done when:** `npm run dev` opens a full-screen alt buffer, draws a live FPS
  counter at ~30fps, reads keystrokes, and restores the terminal cleanly on quit.

### Phase 1 — Render engine (the from-scratch core) · **L** · ✅ done
Double-buffered framebuffer of truecolor cells; diff the previous frame and emit
only changed cells (no full repaints → no flicker); cursor/escape management;
resize handling; 256-color fallback.
- **Done when:** a stress scene (moving gradient / starfield) holds a stable
  30–60fps with zero flicker and survives terminal resize.

### Phase 2 — First reactive effect + state model · **M** · ✅ done
One signature effect — **flow-field particles** (port the math from the
**AsciiCreativeCoding** reference — see *Reference resources*) — plus the
assistant **state
machine** (`idle · thinking · tool-running · responding · error`) and a driver
that maps each state to effect params (palette, density, speed, turbulence).
Driven by *faked* state transitions for now (press keys to switch states).
- **Done when:** the field visibly morphs between idle / thinking / responding
  as you fake the states.

### Phase 3 — Agent integration · **M** · 🚀 ✅ done (live-confirmed)
Wire `@anthropic-ai/claude-agent-sdk`'s `query()` loop. Map its streamed
messages to real state transitions (init→idle, assistant text→responding,
tool_use→tool-running, result→idle). Minimal transcript pane + input line.
**Requires Decision #1 (auth).**
- **Done when:** you type a question, the art reacts *live* as Claude thinks and
  responds, and the answer prints. First true end-to-end slice.

### Phase 4 — Coding tools + permission gate · **M** · ✅ built (confirm live)
Enable `Read / Write / Edit / Bash / Grep / Glob`. Render a `canUseTool`
approval modal in the TUI; give tool execution its own distinct visual state.
- **Done when:** "what does this function do?" / "refactor X" works in a real
  repo, with approval prompts for writes and shell commands.

### Phase 5 — Compositor & UX · **L** · ✅ built (confirm live)
Real layout: visualizer + scrollable transcript + input, plus a status line
(model · cwd · token/cost · current state). Markdown + code-block rendering.
Slash commands, keybindings, session resume.
- **Done when:** it feels like a tool you'd leave open all day.

### Phase 6 — Effects library & theming · **M** · ✅ built
Port the other scenes (torus raster, sparks, primitives) as alternate
visualizers / an idle screensaver — crib from the **AsciiCreativeCoding**
reference (see *Reference resources*). Palette + theme system. Config file.
- **Done when:** multiple selectable visual modes; pick your vibe.

### Phase 7 — Packaging & polish · **S**
Global `cta` command, config dir, README, graceful degradation on limited
terminals, error/reconnect handling.
- **Done when:** install it and run `cta` in any repo.

### Phase 8 — Make it less passive (the art should *do* something) · ✅ built

**8a — Event-reactive art** — the visualizer reads the live event stream: each
tool fires a colored **ripple** (Read=cyan, Edit=green, Bash=orange…), **effort**
scales motion (`low` = calm, `max` = storm), **errors glitch** the field, turn
events burst. The art becomes readable.

**8b — Coding cockpit: diffs + syntax** — when the agent edits, render the live
`- old / + new` **diff** in the transcript; **syntax-highlight** code blocks.

**8c — Keystroke ripples** — typing sends ripples up into the art — the biggest
"feels alive" touch. (Shares the fx channel with 8a.)

---

## Dependency chain

```
P0 ─▶ P1 ─▶ P2 ─▶ P3 ─▶ P4 ─▶ P5 ─▶ P6 ─▶ P7
                   ▲
            Decision #1 (auth) needed here
```

P0→P2 can start immediately — they're pure rendering and don't touch auth or the
SDK. The auth decision only needs to land before P3.

## Reference resources

### AsciiCreativeCoding — effect quarry for Phases 2 & 6
`https://github.com/prtamil/AsciiCreativeCoding` — 337 standalone terminal
creative-coding demos by Tamilselvan R (flow fields, flocking/boids, particle
systems, raymarchers, raster, fluid, matrix effects). **MIT licensed.**

- **Reference, not a dependency.** It's C + ncurses; we're TypeScript + our own
  ANSI renderer. Port the *math* (it's just float arithmetic); rewrite the draw
  calls against our framebuffer. Do **not** link it or shell out to the compiled
  binaries — that fights our renderer and state machine.
- **Attribution:** when we port an effect, keep the MIT notice — add an entry to
  `CREDITS.md` crediting Tamilselvan R + the repo URL.
- **Browsing:** `git clone`, then
  `gcc -std=c11 -O2 file.c -o demo -lncurses -lm` to run a demo locally and pick
  which effects CTA should ship.

## Stretch / later

- Conversation history persistence & resume across launches
- MCP servers (e.g. git, GitHub) wired into the agent
- Audio-reactive or git-activity-reactive visual modes
- Per-project themes
