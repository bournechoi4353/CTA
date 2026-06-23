import { appendFileSync } from 'node:fs'

// Opt-in debug log. Set SIGIL_DEBUG=/path/to/file to capture raw agent messages
// and CLI stderr — used to verify the SDK's actual event shapes on first real
// run (the TS SDK doesn't publish a complete event enum), without ever writing
// to the TUI screen.
const LOG_PATH = process.env['SIGIL_DEBUG']

export function debugLog(label: string, data?: unknown): void {
  if (!LOG_PATH) return
  try {
    const stamp = new Date().toISOString()
    const suffix = data === undefined ? '' : ` ${safeJson(data)}`
    appendFileSync(LOG_PATH, `[${stamp}] ${label}${suffix}\n`)
  } catch {
    // Logging must never break the app.
  }
}

function safeJson(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value)
  } catch {
    return String(value)
  }
}
