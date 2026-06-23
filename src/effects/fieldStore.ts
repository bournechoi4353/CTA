import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * Per-project art-field persistence, so a repo's signature visualizer is *born*
 * once and then continues across launches: ~/.sigil/fields.json
 *   { "<cwd>": { seed, hue, age, born } }
 *
 * `seed`/`hue` are pinned on first launch (the field's identity stays stable even
 * if the repo's git state later changes); `age` accumulates lifetime seconds so
 * the field resumes its evolution instead of resetting to frame zero.
 */
export interface StoredField {
  seed: number
  hue: number
  age: number // accumulated field lifetime (seconds) across all sessions
  born: number // ms epoch of the field's first launch in this repo
}

const DIR = join(homedir(), '.sigil')
const FILE = join(DIR, 'fields.json')

type Store = Record<string, StoredField>

function read(): Store {
  try {
    const parsed: unknown = JSON.parse(readFileSync(FILE, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

export function loadField(cwd: string): StoredField | null {
  const v = read()[cwd]
  return v && typeof v.seed === 'number' && typeof v.age === 'number' ? v : null
}

export function saveField(cwd: string, field: StoredField): void {
  try {
    const store = read()
    store[cwd] = field
    mkdirSync(DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(store))
  } catch {
    // Persistence is best-effort; never break the app over it.
  }
}
