import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

// Persisted UI preferences: ~/.cta/config.json
export interface CtaConfig {
  theme?: string
  scene?: string
  effort?: string
  asciiBorders?: boolean
  permissionMode?: string
  layout?: string // 'bleed' (borderless) | 'panel' (boxed)
}

const DIR = join(homedir(), '.cta')
const FILE = join(DIR, 'config.json')

export function loadConfig(): CtaConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(FILE, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as CtaConfig) : {}
  } catch {
    return {}
  }
}

export function saveConfig(config: CtaConfig): void {
  try {
    mkdirSync(DIR, { recursive: true })
    writeFileSync(FILE, JSON.stringify(config, null, 2))
  } catch {
    // best-effort
  }
}
