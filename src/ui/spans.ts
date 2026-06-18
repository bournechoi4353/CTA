/** A colored run of text within a line. */
export interface Span {
  text: string
  fg: number
  bg: number
}

/** A full rendered line: an ordered list of colored spans. */
export interface StyledLine {
  spans: Span[]
}

/** Word-wrap a sequence of colored spans to `width`, preserving each run's color. */
export function wrapSpans(spans: Span[], width: number): StyledLine[] {
  const w = Math.max(1, width)
  const out: StyledLine[] = []
  const fallback = spans[0] ?? { text: '', fg: 0, bg: 0 }

  let line: Span[] = []
  let len = 0
  const flush = (): void => {
    out.push({ spans: line.length > 0 ? line : [{ text: '', fg: fallback.fg, bg: fallback.bg }] })
    line = []
    len = 0
  }

  // Expand spans into word/whitespace tokens that each carry their color.
  const words: Span[] = []
  for (const sp of spans) {
    for (const part of sp.text.split(/(\s+)/)) {
      if (part.length > 0) words.push({ text: part, fg: sp.fg, bg: sp.bg })
    }
  }

  for (const word of words) {
    const isSpace = word.text.trim().length === 0
    if (isSpace) {
      if (len === 0) continue // drop leading space on a line
      if (len + word.text.length <= w) {
        line.push(word)
        len += word.text.length
      } else {
        flush()
      }
      continue
    }
    if (word.text.length > w) {
      if (len > 0) flush()
      let t = word.text
      while (t.length > w) {
        out.push({ spans: [{ text: t.slice(0, w), fg: word.fg, bg: word.bg }] })
        t = t.slice(w)
      }
      if (t.length > 0) {
        line.push({ text: t, fg: word.fg, bg: word.bg })
        len = t.length
      }
      continue
    }
    if (len + word.text.length > w) flush()
    line.push(word)
    len += word.text.length
  }
  if (line.length > 0) flush()
  if (out.length === 0) out.push({ spans: [{ text: '', fg: fallback.fg, bg: fallback.bg }] })
  return out
}
