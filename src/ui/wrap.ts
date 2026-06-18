/** Word-wrap text to `width`, hard-breaking over-long words; preserves blank lines. */
export function wrapText(text: string, width: number): string[] {
  const w = Math.max(1, width)
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let cur = ''
    for (let word of words) {
      while (word.length > w) {
        if (cur.length > 0) {
          lines.push(cur)
          cur = ''
        }
        lines.push(word.slice(0, w))
        word = word.slice(w)
      }
      if (cur.length === 0) cur = word
      else if (cur.length + 1 + word.length <= w) cur += ` ${word}`
      else {
        lines.push(cur)
        cur = word
      }
    }
    if (cur.length > 0) lines.push(cur)
  }
  return lines
}
