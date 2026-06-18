import { theme } from './theme'
import type { Span } from './spans'

// A language-agnostic keyword set (covers JS/TS, Python, Rust, Go, C-likes).
const KEYWORDS = new Set([
  'function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case',
  'default', 'break', 'continue', 'import', 'export', 'from', 'as', 'class', 'extends', 'implements',
  'interface', 'type', 'enum', 'new', 'this', 'super', 'async', 'await', 'yield', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'def', 'lambda', 'pass',
  'elif', 'with', 'global', 'nonlocal', 'fn', 'pub', 'mut', 'impl', 'struct', 'trait', 'match', 'use',
  'mod', 'crate', 'self', 'where', 'move', 'ref', 'func', 'package', 'go', 'defer', 'chan', 'range',
  'public', 'private', 'protected', 'static', 'final', 'abstract', 'int', 'string', 'bool', 'float',
  'double', 'char', 'long', 'true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil',
])

// One regex pass: comment | string | number | word | other.
const TOKEN =
  /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(\b\d[\d_.xXa-fA-F]*\b)|([A-Za-z_$][\w$]*)|([\s\S])/g

/** Tokenize a single code line into colored spans (all on `bg`). */
export function highlightCode(text: string, bg: number): Span[] {
  const spans: Span[] = []
  let m: RegExpExecArray | null
  TOKEN.lastIndex = 0
  while ((m = TOKEN.exec(text)) !== null) {
    if (m[1] !== undefined) spans.push({ text: m[1], fg: theme.codeComment, bg })
    else if (m[2] !== undefined) spans.push({ text: m[2], fg: theme.codeString, bg })
    else if (m[3] !== undefined) spans.push({ text: m[3], fg: theme.codeNumber, bg })
    else if (m[4] !== undefined) spans.push({ text: m[4], fg: KEYWORDS.has(m[4]) ? theme.codeKeyword : theme.code, bg })
    else spans.push({ text: m[0], fg: theme.code, bg })
  }
  return spans.length > 0 ? spans : [{ text, fg: theme.code, bg }]
}
