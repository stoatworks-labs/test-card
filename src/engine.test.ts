import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import * as engine from './engine'

const here = dirname(fileURLToPath(import.meta.url))

/** Every module `engine.ts` reaches, by walking its relative imports. */
function importGraph(entry: string): { files: string[]; packages: string[] } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const visit = (file: string) => {
    if (files.has(file)) return
    files.add(file)
    const src = readFileSync(file, 'utf8')
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      const spec = m[1] ?? ''
      if (!spec.startsWith('.')) { packages.add(spec); continue }
      visit(resolve(dirname(file), spec.endsWith('.ts') ? spec : `${spec}.ts`))
    }
  }
  visit(entry)
  return { files: [...files].map((f) => f.slice(here.length + 1)), packages: [...packages] }
}

describe('the embeddable engine', () => {
  it('reaches nothing of the app: no React, no store, no UI', () => {
    const { files, packages } = importGraph(resolve(here, 'engine.ts'))
    expect(packages).toEqual([])
    expect(files.filter((f) => f.startsWith('ui/'))).toEqual([])
    expect(files.filter((f) => f.startsWith('state/') && f !== 'state/defaults.ts')).toEqual([])
    expect(files.filter((f) => f.startsWith('import/'))).toEqual([])
  })

  it('exports what an embedder draws with', () => {
    for (const name of ['renderOutputTo', 'renderCompositionTo', 'paintPattern', 'canvasLimitProblem', 'stillTime', 'isAnimated', 'isScaleAware', 'overlayLines', 'setPatternImage']) {
      expect(typeof (engine as Record<string, unknown>)[name], name).toBe('function')
    }
    expect(engine.DEFAULT_SETTINGS.kind).toBe('smpte-rp219')
    expect(Object.keys(engine.PATTERN_LABELS)).toContain('broken-wall')
    expect(engine.MAX_SIDE_PX).toBe(16384)
    expect(engine.ALL_FAULTS.length).toBe(Object.keys(engine.FAULT_LABELS).length)
    expect(engine.LINEUP_ORDER.every((id) => id in engine.SPECIES)).toBe(true)
  })
})
