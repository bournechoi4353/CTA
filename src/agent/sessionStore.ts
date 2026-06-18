import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

// Per-project last-session map, so `/resume` can continue a prior conversation
// across restarts: ~/.cta/sessions.json  { "<cwd>": "<sessionId>" }
const DIR = join(homedir(), '.cta')
const FILE = join(DIR, 'sessions.json')

type Store = Record<string, string>

function read(): Store {
  try {
    const parsed: unknown = JSON.parse(readFileSync(FILE, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

export function loadSession(cwd: string): string | null {
  const value = read()[cwd]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function saveSession(cwd: string, sessionId: string): void {
  try {
    const store = read()
    store[cwd] = sessionId
    mkdirSync(DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(store))
  } catch {
    // Persistence is best-effort; never break the app over it.
  }
}
