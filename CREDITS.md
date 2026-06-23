# Credits

sigil's terminal-art aesthetic and its catalog of effects are inspired by:

## AsciiCreativeCoding

- **Author:** Tamilselvan R
- **Repo:** https://github.com/prtamil/AsciiCreativeCoding
- **License:** MIT

A collection of 337 terminal creative-coding demos (flow fields, flocking,
particle systems, raymarchers, raster, fluid, matrix effects) written in
C/ncurses. We use it as a **reference for effect techniques** — algorithms are
re-implemented in TypeScript against our own renderer, not copied.

The Phase 2 flow-field effect ([src/effects/flowField.ts](src/effects/flowField.ts))
is an original implementation of the flow-field-particles technique that the
reference showcases. If a future effect is a direct port of a specific demo's
math, its source file will say so explicitly.

> MIT requires preserving the copyright notice when substantial portions of the
> code are reused. sigil's effects are original implementations informed by the
> reference; this credit is given as a courtesy and to point users to the source.
