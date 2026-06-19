import { execFileSync } from 'node:child_process'

/**
 * A repo's *derived* identity: the deterministic part of its art fingerprint,
 * computed fresh from the working directory + git state. The evolving part (age)
 * lives in the per-repo field store. Derived once at first launch, then pinned
 * (see fieldStore) so the field stays stable even as the repo's commits move on.
 */
export interface RepoIdentity {
  /** 32-bit seed driving field topology + particle spawn. */
  seed: number
  /** Bounded palette rotation in degrees (−75..+75). */
  hue: number
}

/** FNV-1a 32-bit string hash — small, stable, good enough for a visual seed. */
function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A stable git signal for this checkout: repo root + HEAD sha. Fast (`rev-parse`,
 * not a commit count) and best-effort — returns '' when git is missing or the
 * dir isn't a repo, so a plain folder still gets a path-derived identity.
 */
function gitSignature(cwd: string): string {
  const run = (args: string[]): string => {
    try {
      return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 600 })
        .toString()
        .trim()
    } catch {
      return ''
    }
  }
  const root = run(['rev-parse', '--show-toplevel'])
  if (!root) return ''
  return `${root}@${run(['rev-parse', 'HEAD'])}`
}

/**
 * Deterministic per-repo identity from the absolute cwd + git state. Same repo →
 * same seed/hue every time; different repos → different fingerprints. `salt` lets
 * `/field new` opt into a fresh look without changing the inputs.
 *
 * Hue is bounded to ±75° so it tints each repo distinctly while preserving the
 * driver's state-hue *semantics* (cool idle … warm responding rotate together).
 */
export function deriveIdentity(cwd: string, salt = ''): RepoIdentity {
  const seed = hashStr(`${cwd}|${gitSignature(cwd)}|${salt}`)
  const hue = (seed % 151) - 75
  return { seed, hue }
}
