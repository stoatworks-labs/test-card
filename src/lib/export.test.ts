import { describe, expect, it } from 'vitest'
import { buildManifest, outputFileName, slug, zipFileName } from './export'
import { DEFAULT_SETTINGS } from '../state/defaults'
import type { Output } from '../types'

function out(name: string, w = 1920, h = 1080, extra: Partial<Output> = {}): Output {
  return {
    id: name,
    name,
    widthPx: w,
    heightPx: h,
    rasterSource: 'declared',
    source: 'resolume',
    regions: [],
    notes: [],
    enabled: true,
    ...extra,
  }
}

describe('slug', () => {
  it('folds accents to their base letters rather than dropping them', () => {
    // Naive stripping turns "Bühne" into "bhne", which is unreadable in a
    // filename; decomposing first keeps the "u".
    expect(slug('Bühne Süd')).toBe('buhne-sud')
    expect(slug('Écran Café')).toBe('ecran-cafe')
  })

  it('collapses punctuation and runs of separators', () => {
    expect(slug('Screen  //  Left (Main)')).toBe('screen-left-main')
    expect(slug('---x---')).toBe('x')
  })

  it('never returns an empty string', () => {
    expect(slug('')).toBe('output')
    expect(slug('***')).toBe('output')
    expect(slug('日本語')).toBe('output')
  })
})

describe('file names', () => {
  it('carries the output, pattern and raster', () => {
    expect(outputFileName(out('Stage Left', 3840, 2160), DEFAULT_SETTINGS)).toBe(
      'stage-left_smpte_3840x2160.png',
    )
    expect(outputFileName(out('Wall'), { ...DEFAULT_SETTINGS, kind: 'led-tiles' })).toBe(
      'wall_tiles_1920x1080.png',
    )
  })

  it('names the zip after the project and pattern', () => {
    expect(zipFileName('Big Show 2026', { ...DEFAULT_SETTINGS, kind: 'grid' })).toBe(
      'big-show-2026_grid_patterns.zip',
    )
  })
})

describe('manifest', () => {
  const outputs = [out('A'), out('B', 1280, 720, { rasterSource: 'slice-bounds' })]
  const names = outputs.map((o) => outputFileName(o, DEFAULT_SETTINGS))

  it('lists every file against its output', () => {
    const text = buildManifest('Show', outputs, names, DEFAULT_SETTINGS)
    expect(text).toContain('a_smpte_1920x1080.png, A, 1920x1080, declared')
    expect(text).toContain('b_smpte_1280x720.png, B, 1280x720, slice-bounds')
  })

  it('records the level range, since it cannot be recovered from the PNG', () => {
    expect(buildManifest('Show', outputs, names, DEFAULT_SETTINGS)).toContain('full range (0-255)')
    expect(
      buildManifest('Show', outputs, names, { ...DEFAULT_SETTINGS, levels: 'legal' }),
    ).toContain('legal range (16-235)')
  })

  it('calls out inferred rasters at the bottom where they will be read', () => {
    const text = buildManifest('Show', outputs, names, DEFAULT_SETTINGS)
    expect(text).toMatch(/NOTE: the raster for these outputs was inferred/)
    expect(text).toContain('- B (1280x720)')
    expect(text).not.toContain('- A (')
  })

  it('omits the note entirely when nothing was inferred', () => {
    const clean = [out('A')]
    const text = buildManifest('Show', clean, ['a.png'], DEFAULT_SETTINGS)
    expect(text).not.toMatch(/NOTE:/)
  })

  it('quotes fields containing a comma', () => {
    const text = buildManifest('Show', [out('Left, Main')], ['x.png'], DEFAULT_SETTINGS)
    expect(text).toContain('"Left, Main"')
  })
})
