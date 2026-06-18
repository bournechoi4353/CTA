import { theme } from './theme'
import { toDisplay } from './text'
import { wrapText } from './wrap'
import { wrapSpans, type Span, type StyledLine } from './spans'
import { highlightCode } from './syntax'

/**
 * A pragmatic markdown renderer → styled lines. Handles fenced code blocks
 * (distinct background, no wrap), headers, bullets, and inline `code` / **bold**.
 * Not a full CommonMark implementation — just enough to make assistant answers
 * about code readable. All text is sanitized to safe single-width ASCII.
 */
export function renderMarkdown(text: string, width: number, bg: number): StyledLine[] {
  const out: StyledLine[] = []
  let inCode = false

  for (const raw of toDisplay(text).split('\n')) {
    if (/^\s*```/.test(raw)) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      const body = raw.length > width - 1 ? raw.slice(0, width - 1) : raw
      out.push({ spans: highlightCode(` ${body}`, theme.codeBg) })
      continue
    }

    const header = /^(#{1,6})\s+(.*)$/.exec(raw)
    if (header) {
      for (const w of wrapText(header[2] ?? '', width)) out.push({ spans: [{ text: w, fg: theme.header, bg }] })
      continue
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(raw)
    if (bullet) {
      const indent = bullet[1] ?? ''
      const inner = inlineSpans(bullet[2] ?? '', theme.assistant, bg)
      const wrapped = wrapSpans(inner, Math.max(1, width - indent.length - 2))
      wrapped.forEach((wl, i) => {
        const prefix: Span = { text: i === 0 ? `${indent}- ` : `${indent}  `, fg: theme.bullet, bg }
        out.push({ spans: [prefix, ...wl.spans] })
      })
      continue
    }

    if (raw.trim().length === 0) {
      out.push({ spans: [{ text: '', fg: theme.assistant, bg }] })
      continue
    }
    for (const wl of wrapSpans(inlineSpans(raw, theme.assistant, bg), width)) out.push(wl)
  }
  return out
}

// Split a line into spans for inline `code` and **bold**.
function inlineSpans(text: string, fg: number, bg: number): Span[] {
  const spans: Span[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), fg, bg })
    if (m[1] !== undefined) spans.push({ text: m[1].slice(1, -1), fg: theme.inlineCode, bg: theme.codeBg })
    else if (m[2] !== undefined) spans.push({ text: m[2].slice(2, -2), fg: theme.bold, bg })
    last = re.lastIndex
  }
  if (last < text.length) spans.push({ text: text.slice(last), fg, bg })
  return spans.length > 0 ? spans : [{ text, fg, bg }]
}
