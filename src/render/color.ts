/**
 * Color: packed 24-bit RGB integers, HSV→RGB, and SGR encoders for truecolor
 * with a 256-color fallback. A color is `0xRRGGBB`; `DEFAULT_COLOR` (-1) means
 * "use the terminal's default" and encodes to SGR 39/49.
 */

export const DEFAULT_COLOR = -1

export type ColorMode = 'truecolor' | 'ansi256'

/** Encodes a packed color into SGR parameter fragments (no `\x1b[`/`m`). */
export interface SgrEncoder {
  fg(color: number): string
  bg(color: number): string
}

export function rgb(r: number, g: number, b: number): number {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
}

/** h in degrees (any range), s and v in 0..1 → packed RGB. */
export function hsv(h: number, s: number, v: number): number {
  const hp = ((((h % 360) + 360) % 360) / 60)
  const c = v * s
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) {
    r = c
    g = x
  } else if (hp < 2) {
    r = x
    g = c
  } else if (hp < 3) {
    g = c
    b = x
  } else if (hp < 4) {
    g = x
    b = c
  } else if (hp < 5) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  const m = v - c
  return rgb(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  )
}

/** Map a packed RGB color to the nearest xterm-256 palette index. */
function to256(color: number): number {
  const r = (color >> 16) & 255
  const g = (color >> 8) & 255
  const b = color & 255
  if (r === g && g === b) {
    if (r < 8) return 16
    if (r > 248) return 231
    return Math.round(((r - 8) / 247) * 24) + 232
  }
  const ri = Math.round((r / 255) * 5)
  const gi = Math.round((g / 255) * 5)
  const bi = Math.round((b / 255) * 5)
  return 16 + 36 * ri + 6 * gi + bi
}

const truecolorEncoder: SgrEncoder = {
  fg(c) {
    return c < 0 ? '39' : `38;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}`
  },
  bg(c) {
    return c < 0 ? '49' : `48;2;${(c >> 16) & 255};${(c >> 8) & 255};${c & 255}`
  },
}

const ansi256Encoder: SgrEncoder = {
  fg(c) {
    return c < 0 ? '39' : `38;5;${to256(c)}`
  },
  bg(c) {
    return c < 0 ? '49' : `48;5;${to256(c)}`
  },
}

export function detectColorMode(): ColorMode {
  const force = process.env['CTA_COLOR']
  if (force === '256' || force === 'ansi256') return 'ansi256'
  if (force === 'truecolor' || force === '24bit') return 'truecolor'
  const colorterm = process.env['COLORTERM']
  if (colorterm && /truecolor|24bit/i.test(colorterm)) return 'truecolor'
  // Default: assume truecolor (most modern terminals); CTA_COLOR=256 forces fallback.
  return 'truecolor'
}

export function selectEncoder(mode: ColorMode): SgrEncoder {
  return mode === 'ansi256' ? ansi256Encoder : truecolorEncoder
}
