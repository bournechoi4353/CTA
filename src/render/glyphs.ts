/** Brightness → glyph ramps. Index 0 is darkest/emptiest, last is brightest. */

export const RAMP = ' .:-=+*#%@'

/** Pre-encode a ramp string as codepoints for the hot path (avoids per-cell `codePointAt`). */
export function rampCodepoints(ramp: string = RAMP): Uint32Array {
  const chars = [...ramp]
  const out = new Uint32Array(chars.length)
  for (let i = 0; i < chars.length; i++) {
    out[i] = chars[i]!.codePointAt(0) ?? 0x20
  }
  return out
}

/** Map an intensity in 0..1 to a ramp index, clamped to [0, length-1]. */
export function glyphIndex(t: number, length: number): number {
  if (t <= 0) return 0
  if (t >= 1) return length - 1
  const idx = Math.floor(t * length)
  return idx < length ? idx : length - 1
}
