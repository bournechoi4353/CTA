import { rgb } from '../render/color'

// Default palette ("nova"). `theme` is a live mutable object that every module
// reads from; applyTheme() reassigns its color fields in place, so a theme
// switch propagates everywhere without re-importing.
const BASE = {
  hudFg: rgb(235, 235, 245),
  hudBg: rgb(0, 0, 0),
  panelBg: rgb(12, 12, 18),
  accent: rgb(125, 205, 255),
  user: rgb(125, 205, 255),
  assistant: rgb(224, 224, 236),
  system: rgb(120, 120, 145),
  header: rgb(150, 210, 255),
  bullet: rgb(120, 200, 255),
  code: rgb(200, 222, 200),
  codeBg: rgb(24, 28, 32),
  inlineCode: rgb(236, 200, 150),
  bold: rgb(255, 255, 255),
  ok: rgb(120, 210, 150),
  warn: rgb(240, 180, 120),
  borderFg: rgb(78, 84, 104),
  borderTitle: rgb(150, 210, 255),
  placeholder: rgb(92, 92, 112),
}

export const theme = { ...BASE, asciiBorders: false }

type Palette = Partial<typeof BASE>

const THEMES: Record<string, Palette> = {
  nova: {},
  matrix: {
    accent: rgb(80, 230, 120), user: rgb(120, 240, 150), header: rgb(120, 240, 150),
    bullet: rgb(80, 220, 120), inlineCode: rgb(160, 255, 160), code: rgb(150, 235, 150),
    borderFg: rgb(40, 90, 55), borderTitle: rgb(120, 240, 150), warn: rgb(120, 240, 150),
    assistant: rgb(200, 235, 205), system: rgb(90, 140, 100), codeBg: rgb(10, 26, 14),
  },
  amber: {
    accent: rgb(240, 180, 90), user: rgb(245, 190, 110), header: rgb(245, 190, 110),
    bullet: rgb(240, 170, 80), inlineCode: rgb(250, 210, 150), code: rgb(235, 205, 150),
    borderFg: rgb(110, 80, 40), borderTitle: rgb(245, 190, 110), warn: rgb(245, 190, 110),
    assistant: rgb(236, 224, 205), system: rgb(150, 120, 85), codeBg: rgb(30, 22, 12),
  },
  mono: {
    accent: rgb(210, 210, 220), user: rgb(225, 225, 232), header: rgb(225, 225, 232),
    bullet: rgb(180, 180, 190), inlineCode: rgb(210, 210, 210), code: rgb(200, 200, 205),
    borderFg: rgb(80, 80, 90), borderTitle: rgb(210, 210, 220), warn: rgb(210, 210, 220),
    assistant: rgb(220, 220, 228), system: rgb(120, 120, 130), codeBg: rgb(22, 22, 26),
  },
}

export const THEME_NAMES = Object.keys(THEMES)

/** Switch the active chrome palette. Returns false for an unknown name. */
export function applyTheme(name: string): boolean {
  const palette = THEMES[name]
  if (!palette) return false
  Object.assign(theme, BASE, palette) // reset to base, then apply overrides
  return true
}

export function setBorders(ascii: boolean): void {
  theme.asciiBorders = ascii
}
