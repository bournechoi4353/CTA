import { rgb } from '../render/color'

/** Named colors for the UI chrome and markdown. Phase 6 will make this swappable. */
export const theme = {
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
  asciiBorders: false,
}

