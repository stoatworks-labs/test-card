/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  // The About dialog shows the version the build actually produced. about-data.js
  // carries one baked at sync time as a fallback, and it goes stale the moment a
  // release is tagged; this is the one that is always right.
  define: { __APP_VERSION__: JSON.stringify(`v${pkg.version}`) },
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
  test: {
    // Node by default: the pattern maths, the ZIP writer and the importers are
    // all pure. Only the importer suite needs a DOM (for DOMParser) and it opts
    // in with its own `@vitest-environment jsdom` docblock, which keeps the
    // common case fast.
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
})
