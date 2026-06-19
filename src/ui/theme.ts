import { rgb } from '../render/color'

// Default palette ("nova"). `theme` is a live mutable object that every module
// reads from; applyTheme() reassigns its color fields in place, so a theme
// switch propagates everywhere without re-importing.
const BASE = {
  hudFg: rgb(235, 235, 245),
  hudBg: rgb(0, 0, 0),
  panelBg: rgb(12, 12, 18),
  // Frosted-ribbon background for the borderless "bleed" layout: a subtle dark
  // surface laid behind floating text so it stays legible over the live art,
  // while the field bleeds through every gap around it.
  scrimBg: rgb(16, 18, 28),
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
  codeKeyword: rgb(150, 180, 255),
  codeString: rgb(170, 220, 150),
  codeComment: rgb(110, 120, 135),
  codeNumber: rgb(230, 185, 130),
  diffAdd: rgb(120, 210, 150),
  diffDel: rgb(232, 130, 130),
}

// `bleed` selects the borderless full-bleed layout (art is the substrate, text
// floats on frosted ribbons); false restores the panelled/boxed look. Kept off
// BASE so applyTheme() (which resets BASE fields) preserves the layout choice,
// same as asciiBorders.
export const theme = { ...BASE, asciiBorders: false, bleed: true }

type Palette = Partial<typeof BASE>

const THEMES: Record<string, Palette> = {
  nova: {},
  matrix: {
    accent: rgb(80, 230, 120), user: rgb(120, 240, 150), header: rgb(120, 240, 150),
    bullet: rgb(80, 220, 120), inlineCode: rgb(160, 255, 160), code: rgb(150, 235, 150),
    borderFg: rgb(40, 90, 55), borderTitle: rgb(120, 240, 150), warn: rgb(120, 240, 150),
    assistant: rgb(200, 235, 205), system: rgb(90, 140, 100), codeBg: rgb(10, 26, 14),
    scrimBg: rgb(8, 22, 13),
  },
  amber: {
    accent: rgb(240, 180, 90), user: rgb(245, 190, 110), header: rgb(245, 190, 110),
    bullet: rgb(240, 170, 80), inlineCode: rgb(250, 210, 150), code: rgb(235, 205, 150),
    borderFg: rgb(110, 80, 40), borderTitle: rgb(245, 190, 110), warn: rgb(245, 190, 110),
    assistant: rgb(236, 224, 205), system: rgb(150, 120, 85), codeBg: rgb(30, 22, 12),
    scrimBg: rgb(28, 20, 11),
  },
  mono: {
    accent: rgb(210, 210, 220), user: rgb(225, 225, 232), header: rgb(225, 225, 232),
    bullet: rgb(180, 180, 190), inlineCode: rgb(210, 210, 210), code: rgb(200, 200, 205),
    borderFg: rgb(80, 80, 90), borderTitle: rgb(210, 210, 220), warn: rgb(210, 210, 220),
    assistant: rgb(220, 220, 228), system: rgb(120, 120, 130), codeBg: rgb(22, 22, 26),
    scrimBg: rgb(22, 22, 27),
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

/** Toggle the borderless full-bleed layout (true) vs the panelled/boxed one. */
export function setLayout(bleed: boolean): void {
  theme.bleed = bleed
}
