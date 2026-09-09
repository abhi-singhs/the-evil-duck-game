import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// The Node server runs the same rules as the browser. This build bundles the game core and the
// protocol into one dependency-free ESM file so `server/index.mjs` can import TypeScript logic
// without a loader, a second copy, or a runtime transpile step.
export default defineConfig({
  build: {
    target: 'node22',
    outDir: 'server/core',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/net/core.ts'),
      formats: ['es'],
      fileName: () => 'game-core.mjs',
    },
  },
})
