import { describe, expect, it } from 'vitest'
import { buildManifest, outputFileName, slug, tileFileName, zipFileName } from './export'
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

describe('moving and scale-aware exports', () => {
  it('names a loop by its frame rate and length, so the file says what it is', () => {
    const s = { ...DEFAULT_SETTINGS, kind: 'ocean' as const, animation: { ...DEFAULT_SETTINGS.animation, seconds: 10, fps: '29.97' as const } }
    expect(outputFileName(out('Main LED'), s, 'mp4')).toBe('main-led_ocean_1920x1080_29p97fps_10p01s.mp4')
    expect(zipFileName('Show', s, 'mp4')).toBe('show_ocean_loops.zip')
    expect(outputFileName(out('Main LED'), s)).toBe('main-led_ocean_1920x1080.png')
  })

  it('writes the loop and the colour encoding into the manifest', () => {
    const s = { ...DEFAULT_SETTINGS, kind: 'hamsters' as const }
    const m = buildManifest('Show', [out('A')], ['a.mp4'], s, 'mp4')
    expect(m).toContain('300 frames at 30 fps')
    expect(m).toContain('BT.709')
  })

  it('records each output’s pitch for a scale-aware pattern, and flags a guessed one', () => {
    const s = { ...DEFAULT_SETTINGS, kind: 'bananas' as const }
    const m = buildManifest('Show', [out('A', 1920, 1080, { pitchMm: 3.9, pitchSource: 'imported' }), out('B')], ['a.png', 'b.png'], s)
    expect(m).toContain('a.png, A, 1920x1080, declared, 0, 3.9, imported')
    expect(m).toContain('b.png, B, 1920x1080, declared, 0, 2.6, ASSUMED')
    expect(m).toMatch(/had no pixel pitch/)
  })
})

describe('video tiles', () => {
  const s = { ...DEFAULT_SETTINGS, kind: 'ocean' as const }
  const tile = { col: 1, row: 0, x: 3840, y: 0, width: 3840, height: 2160 }

  it('names a tile after its loop, then its place in the grid and the raster', () => {
    const loop = outputFileName(out('Main LED', 7680, 4320), s, 'mp4')
    expect(tileFileName(loop, tile)).toBe('main-led_ocean_7680x4320_30fps_10s_tile-r1c2_3840x2160+3840+0.mp4')
  })

  it('lists every tile and where it goes in the manifest', () => {
    const files = [
      { col: 0, row: 0, x: 0, y: 0, width: 3840, height: 2160, name: 'a_tile-r1c1.mp4' },
      { ...tile, name: 'a_tile-r1c2.mp4' },
    ]
    const m = buildManifest('Show', [out('A', 7680, 2160)], ['2 tiles listed below'], s, 'mp4', [
      { label: 'A', width: 7680, height: 2160, cols: 2, rows: 1, files },
    ])
    expect(m).toContain('2 tiles listed below, A, 7680x2160')
    expect(m).toContain('VIDEO TILES')
    expect(m).toContain('A, 7680x2160, as 2x1 tiles')
    expect(m).toContain('a_tile-r1c1.mp4, 0, 0, 3840, 2160')
    expect(m).toContain('a_tile-r1c2.mp4, 3840, 0, 3840, 2160')
  })

  it('leaves out the output table for a tiled composition, which has no outputs of its own', () => {
    const m = buildManifest('Show', [], [], s, 'mp4', [
      { label: 'Composition', width: 7680, height: 2160, cols: 2, rows: 1, files: [{ ...tile, name: 'c.mp4' }] },
    ])
    expect(m).not.toContain('file, output, raster')
    expect(m).toContain('Composition, 7680x2160, as 2x1 tiles')
  })
})
