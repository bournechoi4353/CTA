import type { Role, Turn } from '../agent/conversation'

export interface RenderedLine {
  role: Role
  text: string
}

const LABELS: Record<Role, string> = {
  user: 'you  ',
  assistant: '     ',
  system: '   ',
}

/**
 * Flatten the conversation into wrapped, labelled lines and return the last
 * `maxLines` (most recent at the bottom).
 */
export function transcriptLines(turns: readonly Turn[], width: number, maxLines: number): RenderedLine[] {
  const out: RenderedLine[] = []
  for (const turn of turns) {
    const label = LABELS[turn.role]
    const indent = ' '.repeat(label.length)
    const body = wrap(turn.text, Math.max(1, width - label.length))
    body.forEach((line, i) => {
      out.push({ role: turn.role, text: (i === 0 ? label : indent) + line })
    })
  }
  return out.slice(Math.max(0, out.length - maxLines))
}

/** Word-wrap, hard-breaking words longer than `width`. Preserves blank lines. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((w) => w.length > 0)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let cur = ''
    for (let word of words) {
      while (word.length > width) {
        if (cur.length > 0) {
          lines.push(cur)
          cur = ''
        }
        lines.push(word.slice(0, width))
        word = word.slice(width)
      }
      if (cur.length === 0) cur = word
      else if (cur.length + 1 + word.length <= width) cur += ` ${word}`
      else {
        lines.push(cur)
        cur = word
      }
    }
    if (cur.length > 0) lines.push(cur)
  }
  return lines
}
