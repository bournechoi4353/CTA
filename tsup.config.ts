import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // It's an app, not a library — no .d.ts, no source maps in the bundle.
  dts: false,
  sourcemap: false,
  minify: false,
})
