import type { Role, Turn } from '../agent/conversation'
import { wrapText } from './wrap'

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
    const body = wrapText(turn.text, Math.max(1, width - label.length))
    body.forEach((line, i) => {
      out.push({ role: turn.role, text: (i === 0 ? label : indent) + line })
    })
  }
  return out.slice(Math.max(0, out.length - maxLines))
}
