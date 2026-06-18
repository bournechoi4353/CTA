// Common Unicode punctuation → ASCII, so typical model output stays readable.
const TRANSLIT: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  '“': '"', '”': '"', '„': '"',
  '«': '"', '»': '"',
  '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '...', ' ': ' ', '·': '-', '•': '*',
  '→': '->', '←': '<-',
}

/**
 * Make arbitrary text safe for our fixed 1-cell-per-codepoint grid: keep ASCII
 * and newlines, transliterate common Unicode punctuation, and replace anything
 * else (wide CJK/emoji, combining marks, other control bytes) with '?'. Without
 * this, wide characters in model output desync column positions and well-formed
 * non-ASCII bytes break the renderer's provable-ASCII guarantee. (Proper
 * width-aware rendering is a later phase.)
 */
export function toDisplay(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 0x0a || c === 0x0d) {
      out += '\n'
      continue
    }
    if (c === 0x09) {
      out += '  '
      continue
    }
    if (c >= 0x20 && c <= 0x7e) {
      out += ch
      continue
    }
    const replacement = TRANSLIT[ch]
    if (replacement !== undefined) {
      out += replacement
      continue
    }
    if (c < 0x20) continue
    out += '?'
  }
  return out
}
