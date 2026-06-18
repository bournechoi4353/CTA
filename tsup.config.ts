import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  // Don't bundle the Agent SDK — it ships a native CLI binary and spawns it at
  // runtime; resolve it from node_modules instead.
  external: ['@anthropic-ai/claude-agent-sdk'],
  // It's an app, not a library — no .d.ts, no source maps in the bundle.
  dts: false,
  sourcemap: false,
  minify: false,
})
