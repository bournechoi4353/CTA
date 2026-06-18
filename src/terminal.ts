/**
 * Low-level terminal control: alternate screen, raw-mode input, cursor
 * visibility, autowrap, resize events, and — most importantly — guaranteed
 * restoration of the terminal on every exit path (clean quit, signals, crashes).
 *
 * The renderer builds on this. Nothing else in the app should emit the raw
 * escape codes for screen setup or touch raw mode directly.
 */

const ALT_SCREEN_ENTER = '\x1b[?1049h'
const ALT_SCREEN_LEAVE = '\x1b[?1049l'
const CURSOR_HIDE = '\x1b[?25l'
const CURSOR_SHOW = '\x1b[?25h'
// Autowrap off: writing the bottom-right cell must not wrap/scroll the screen.
// The renderer positions every cell explicitly, so we never rely on wrapping.
const AUTOWRAP_OFF = '\x1b[?7l'
const AUTOWRAP_ON = '\x1b[?7h'
// Full rendition reset: clear all SGR attributes (\x1b[0m) AND restore the G0
// character set to US-ASCII (\x1b(B). Without this, the last frame's color and
// charset state bleed into the user's shell on exit — a corrupted terminal.
const RESET = '\x1b[0m\x1b(B'

export interface TerminalSize {
  cols: number
  rows: number
}

export class Terminal {
  private readonly out = process.stdout
  private readonly in = process.stdin
  private active = false
  private rawApplied = false
  private hooksInstalled = false
  private readonly resizeListeners = new Set<(size: TerminalSize) => void>()

  /** True when stdout is a real terminal we can drive. */
  get isInteractive(): boolean {
    return Boolean(this.out.isTTY)
  }

  size(): TerminalSize {
    return { cols: this.out.columns ?? 80, rows: this.out.rows ?? 24 }
  }

  /** Enter the alternate screen and put input into raw mode (TTY only). */
  enter(): void {
    if (this.active) return
    this.active = true

    if (this.out.isTTY) {
      this.out.write(ALT_SCREEN_ENTER + RESET + CURSOR_HIDE + AUTOWRAP_OFF)
      this.out.on('resize', this.handleResize)
    }
    if (this.in.isTTY) {
      this.in.setRawMode(true)
      this.rawApplied = true
    }
    this.in.resume()
    this.in.setEncoding('utf8')

    this.installExitHooks()
  }

  /** Restore the terminal. Idempotent and safe to call from exit handlers. */
  leave(): void {
    if (!this.active) return
    this.active = false

    if (this.rawApplied && this.in.isTTY) {
      this.in.setRawMode(false)
      this.rawApplied = false
    }
    if (this.out.isTTY) {
      this.out.off('resize', this.handleResize)
      // Reset rendition inside the alt screen, restore modes, leave the alt
      // screen, then reset again on the main screen — belt and suspenders.
      this.out.write(RESET + AUTOWRAP_ON + CURSOR_SHOW + ALT_SCREEN_LEAVE + RESET)
    }
    this.in.pause()
  }

  /** Write pre-composed output (escape codes + text) to the screen. */
  write(data: string): void {
    this.out.write(data)
  }

  /** Subscribe to decoded keypress data. Returns an unsubscribe function. */
  onKey(listener: (key: string) => void): () => void {
    const handler = (data: string) => listener(data)
    this.in.on('data', handler)
    return () => {
      this.in.off('data', handler)
    }
  }

  /** Subscribe to resize events. Returns an unsubscribe function. */
  onResized(listener: (size: TerminalSize) => void): () => void {
    this.resizeListeners.add(listener)
    return () => {
      this.resizeListeners.delete(listener)
    }
  }

  private readonly handleResize = (): void => {
    const size = this.size()
    for (const listener of this.resizeListeners) listener(size)
  }

  private installExitHooks(): void {
    if (this.hooksInstalled) return
    this.hooksInstalled = true

    const restore = (): void => this.leave()

    process.on('exit', restore)
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
      process.on(signal, () => {
        restore()
        process.exit(0)
      })
    }
    process.on('uncaughtException', (err) => {
      restore()
      // Now that the alt screen is gone, the error is actually visible.
      console.error(err)
      process.exit(1)
    })
  }
}
