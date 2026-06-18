import type { Turn } from '../agent/conversation'
import { theme } from './theme'
import { toDisplay } from './text'
import { wrapSpans, type StyledLine } from './spans'
import { renderMarkdown } from './markdown'

/**
 * Flatten the conversation into styled lines: assistant turns are markdown-
 * rendered; user/system turns are plain, colored, and labelled. Returns the full
 * list (the app slices it for the scroll window).
 */
export function buildTranscript(turns: readonly Turn[], width: number): StyledLine[] {
  const out: StyledLine[] = []
  for (const turn of turns) {
    if (turn.role === 'assistant') {
      for (const line of renderMarkdown(turn.text, width, theme.panelBg)) out.push(line)
    } else if (turn.role === 'user') {
      const spans = [
        { text: 'you  ', fg: theme.user, bg: theme.panelBg },
        { text: toDisplay(turn.text), fg: theme.user, bg: theme.panelBg },
      ]
      for (const line of wrapSpans(spans, width)) out.push(line)
    } else {
      const spans = [{ text: toDisplay(turn.text), fg: theme.system, bg: theme.panelBg }]
      for (const line of wrapSpans(spans, width)) out.push(line)
    }
  }
  return out
}
