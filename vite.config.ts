/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
