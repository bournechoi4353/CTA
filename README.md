# CTA

*A Claude Code–style coding assistant, purpose-built.*

CTA is a terminal-resident coding assistant. It pairs Claude, running on the
[Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript), with a
from-scratch ANSI render loop, giving the application a reactive visual presence —
not a mascot, but a band of generative art at the center of the screen. The art
drifts while Claude is idle, tightens during reasoning, and ripples in color as
each tool executes. The user types, the visualization responds, and Claude replies.

The project was motivated by a simple observation: most coding tools present as a
plain text box. CTA is an attempt to make the interface itself convey activity —
to make the time spent waiting both informative and worth observing.

```
 ╭─ ✦ CTA · claude-opus-4-8 · plan · ~/code/thing ─────────────────╮
 │                                                                 │
 │        · · ∙ ∙ ╱ ╱ ╱ ─ ─ ╲ ╲ ∙ ∙ · ·    (the art band)         │
 │      ∙ ╱ ╱ ─ ─ ─ ╲ ╲ ╲ ╲ ─ ─ ╱ ╱ ∙                              │
 │                                                                 │
 ╰─────────────────────────────────────────────────────────────────╯
 ╭─ conversation ──────────────────────────────────────────────────╮
 │ › what does parseConfig do?                                     │
 │ It reads ~/.cta/config.json and merges it with defaults…        │
 ╰─────────────────────────────────────────────────────────────────╯
 ╭─────────────────────────────────────────────────────────────────╮
 │ › _                                                             │
 ╰─────────────────────────────────────────────────────────────────╯
 ▸ plan (shift+tab to cycle) · idle · opus · 1.2k tok · $0.01
```

## Capabilities

- **Code editing and command execution.** The standard toolset — `Read`, `Write`,
  `Edit`, `Bash`, `Glob`, and `Grep` — is available, gated behind an approval
  modal so that no file or shell operation proceeds without explicit confirmation.
- **Visualization driven by actual work.** Each tool invocation emits a hue-coded
  ripple across the field (Read in cyan, Edit in green, Bash in orange, and so on);
  errors introduce a glitch, and keystrokes propagate ripples upward from the
  input line. The configured effort level scales the motion — `low` produces a
  calm drift, `max` an intense one.
- **Five visualizers and four themes.** The available scenes are a flow field, a
  rotating ASCII torus, Matrix-style rain, plasma, and a starfield, selectable via
  `/scene`. Chrome appearance is reconfigurable with `/theme`
  (`nova`, `matrix`, `amber`, or `mono`). Selections persist to
  `~/.cta/config.json`.
- **A complete terminal application.** Features include markdown rendering,
  syntax-highlighted code blocks, red/green diffs on file edits, a scrollable
  transcript (PgUp/PgDn, Home/End), input history, slash commands, and per-project
  session resume.

## Getting started

CTA requires **Node ≥ 20**, plus either an `ANTHROPIC_API_KEY` or a logged-in
`claude` subscription (run `claude` once to log in).

```bash
git clone <this-repo> cta && cd cta
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev          # run directly from source
```

Alternatively, build the binary:

```bash
npm run build
npm start            # node dist/index.js
```

Or install it as a global `cta` command (the build runs automatically on link):

```bash
npm install && npm link
cta                          # run in any repo
cta "explain this codebase"  # pre-fill the first prompt
cta --help
```

The assistant is then ready for use: request an explanation of a function, a
refactor, or a test run. Write operations and shell commands trigger an approval
prompt; pressing `shift+tab` cycles through the permission modes for users who
prefer fewer interruptions.

## Keys and commands

| | |
|---|---|
| `shift+tab` | cycle permission mode (ask → auto-edits → bypass → plan) |
| `Esc` | cancel the active turn |
| `↑` / `↓` | input history |
| `PgUp` / `PgDn` · `Home` / `End` | scroll the transcript |
| `/scene [name]` | switch the visualizer |
| `/theme [nova\|matrix\|amber\|mono]` | re-skin the chrome |
| `/effort [low\|medium\|high\|xhigh\|max]` | adjust reasoning depth |
| `/borders` | toggle rounded ↔ ASCII boxes |
| `/resume` · `/new` · `/clear` | session handling |
| `/help` · `/quit` | help and exit |

## Architecture

The system is organized into three deliberately decoupled components:

```
 input → agent (Claude) → state machine → effects → renderer → stdout
```

- The **renderer** owns the screen: a double-buffered cell grid, diffed each frame
  and flushed as a single ANSI string. It has no knowledge of Claude.
- The **effects** are pure-ish draw routines of the form
  `(dt, state, framebuffer) → draws`.
- The **state machine** defines the contract between agent and display: each
  assistant state (`idle`, `thinking`, `responding`, `tool-running`, `error`)
  maps to a set of visual parameters (palette, density, speed, turbulence).
- The **agent** layer integrates the SDK; its streamed events drive state
  transitions, and its tool calls pass through a permission gate.

This separation is intentional. The renderer and effects were built and tested
without any AI involvement, and the agent layer was integrated subsequently. No
curses library is used; the hand-rolled renderer is the core of the project.

Before modifying anything under `src/render/` or `src/ui/`, consult the
"Rendering model & terminal gotchas" section of [CLAUDE.md](CLAUDE.md).
Terminal restoration on exit, in particular, is invisible when correct and
disruptive to the user's shell when not.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | run from source (tsx) |
| `npm run dev:watch` | run from source, reloading on change |
| `npm run build` | bundle to `dist/` (tsup) |
| `npm start` | run the built binary |
| `npm run typecheck` | `tsc --noEmit` |

`CTA_SMOKE=1 npm start` runs a bounded number of frames headlessly and then exits,
which is useful for verifying the loop without a TTY. `CTA_DEBUG=/tmp/cta.log`
logs raw SDK messages to that file rather than corrupting the screen.

## Status

Phases 0–8 are complete, including packaging (a global `cta` command); see
[PLAN.md](PLAN.md) for the full roadmap. The application is functional and in
daily use.

## Credits

The effect mathematics is ported — not linked — from
[AsciiCreativeCoding](https://github.com/prtamil/AsciiCreativeCoding) by
Tamilselvan R, under the MIT license. See [CREDITS.md](CREDITS.md).
