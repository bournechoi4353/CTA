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

### Phase 7 — Packaging & polish · **S** · ✅ built
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

### Phase 9 — Shed the Claude-Code skin (make it unmistakably *yours*) · **M** · ✅ built (confirm live)

The layout currently reads as "Claude Code with a screensaver": the art is a band
sandwiched between rounded boxes, so the unique asset (the living field) looks like
decoration bolted onto a familiar skeleton. Phase 9 inverts that — the art stops
being a panel and becomes the **substrate everything floats on**, and it becomes
**literally yours** (seeded from your repo, persistent across sessions) instead of an
interchangeable scene. These two are independent and can land in either order.

**9a — Borderless bleed layout** · ✅ built (confirm live) — killed the box-in-box
chrome (the single biggest "Claude Code" tell). The art now fills the **entire
screen**; the header, transcript, input, and status line are composited *over* the
field as luminous text on content-width **frosted ribbons** (a themed `scrimBg` laid
behind text that blanks the art glyphs there so it stays legible, while the field
bleeds through every gap and out to every edge), like subtitles over video — not
panels. A short conversation bottom-anchors above the input so the open art owns the
top. Implemented as a `composeUiBleed()` branch + scrim helpers in
[src/app.ts](src/app.ts), a themeable `scrimBg` + `bleed` flag in
[src/ui/theme.ts](src/ui/theme.ts), and a `bg`-parameterised
[transcript](src/ui/transcript.ts); **bleed is the new default**, persisted to
[config](src/configStore.ts). The escape hatch is **`/layout panel`** (restores the
boxed look; `/layout bleed` to return). ASCII-safety + diff-don't-repaint invariants
hold.
- **Done when:** ✅ no bordered boxes remain; ✅ the art reaches every edge; ✅ chat +
  input float over it and stay readable while the field animates underneath; ✅ a
  `/layout` escape hatch restores the panelled look.
- *Verified headless* (`CTA_SMOKE=1`, both layouts): exit 0, **0 stray control bytes**,
  decoded frames show clean text ribbons over full-bleed art (bleed) and the unchanged
  boxed layout (panel). Live-only: real-agent feel — diffs/code-blocks on frosted
  ribbons, scroll, ripples over the open art band.

**9b — Persistent, repo-seeded signature field** · ✅ built (confirm live) — the
signature field is now **seeded from the repo** (FNV-1a hash of the cwd path + git
`--show-toplevel`/`HEAD`, in [src/identity.ts](src/identity.ts)) and **persists across
sessions** ([src/effects/fieldStore.ts](src/effects/fieldStore.ts) →
`~/.cta/fields.json`, mirroring sessionStore). The seed drives per-repo field
**topology** (scale, phase offsets, axis freqs, handedness) + particle spawn in
[flowField.ts](src/effects/flowField.ts), plus a **bounded ±75° hue rotation** (also
applied in torus/matrix) that tints each repo distinctly while preserving the driver's
state-hue semantics. The field is **born** on first launch then its seed/hue are
**pinned** (stable across later commits); an accumulating `age` offsets animation time
so a relaunch **continues** the field instead of resetting it. New `ArtIdentity` rides
on `FrameInfo`. A `/field` command shows seed/hue/age (`/field new` rerolls). *(Git
commit-count + time-of-day were dropped from the seed to keep determinism crisp —
candidate "mood" layers later; the per-edit "lasting mark" remains a stretch.)*
- **Done when:** ✅ deterministic per-repo (same repo → identical field; repoA-vs-repoA
  renders 0% different); ✅ two repos look distinct (repoA-vs-repoB renders ~77%
  different, distinct hues); ✅ relaunching continues the saved field (age grows, seed
  pinned).
- *Verified*: a render-level harness (determinism / distinctness / age-continuity) +
  end-to-end persistence smoke (two runs grow `age` with seed pinned; a second repo
  gets a distinct entry); typecheck + build clean; headless smoke exit 0, **0 stray
  control bytes**. Live-only: eyeballing that two real repos *feel* distinct and that a
  resumed field reads as "the same organism, moved on."

---

## Dependency chain

```
P0 ─▶ P1 ─▶ P2 ─▶ P3 ─▶ P4 ─▶ P5 ─▶ P6 ─▶ P7 ─▶ P8 ─▶ P9
                   ▲                              ┌─ 9a (layout)  ┐ independent,
            Decision #1 (auth) needed here        └─ 9b (seed)    ┘ either order
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
