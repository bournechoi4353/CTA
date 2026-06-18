export type InputAction = 'submit' | 'change' | 'none'

/**
 * A minimal single-line text editor over raw keypress data. Phase 3 supports
 * typing printable text, backspace, and Enter; arrow keys / history land later.
 */
export class InputLine {
  private buf = ''

  get value(): string {
    return this.buf
  }

  clear(): void {
    this.buf = ''
  }

  handle(key: string): InputAction {
    if (key === '\r' || key === '\n') return 'submit'
    if (key === '\x7f' || key === '\x08') {
      if (this.buf.length === 0) return 'none'
      this.buf = this.buf.slice(0, -1)
      return 'change'
    }
    // Ignore escape sequences (arrows, function keys) and other control input.
    if (key.startsWith('\x1b')) return 'none'
    const printable = sanitize(key)
    if (printable.length === 0) return 'none'
    this.buf += printable
    return 'change'
  }
}

// Keep only printable characters — never let a control byte into the buffer.
function sanitize(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (c >= 0x20 && c <= 0x7e) out += ch // ASCII printable only
  }
  return out
}
