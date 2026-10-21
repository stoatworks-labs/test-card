import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/defaults'
import { _internals } from '../state/store'
import { canvasRange, makeEnv, spanPlace, spansSurface, stillTime } from './render'
import { isAnimated, isScaleAware } from './env'
import type { Output, PatternSettings } from '../types'

const S = DEFAULT_SETTINGS
const with_ = (patch: Partial<PatternSettings>): PatternSettings => ({ ...S, ...patch })

function output(patch: Partial<Output> = {}): Output {
  return {
    id: 'a',
    name: 'Left',
    widthPx: 1920,
    heightPx: 1080,
    rasterSource: 'computed',
    source: 'pixel-peeker',
    regions: [],
    notes: [],
    enabled: true,
    ...patch,
  }
}

describe('which patterns do what', () => {
  it('knows the moving ones', () => {
    for (const kind of ['hamsters', 'ocean', 'dino-scroll', 'volcano', 'pumpkins', 'spooky-forest', 'haunted-house'] as const) {
      expect(isAnimated(with_({ kind }))).toBe(true)
    }
    for (const kind of ['smpte-rp219', 'rulers', 'bananas', 'dinosaurs', 'image'] as const) expect(isAnimated(with_({ kind }))).toBe(false)
  })

  it('a pumpkin patch moves only if it has candles to flicker or faces to pull', () => {
    const p = S.pumpkins
    expect(isAnimated(with_({ kind: 'pumpkins', pumpkins: { ...p, flicker: false } }))).toBe(true)
    expect(isAnimated(with_({ kind: 'pumpkins', pumpkins: { ...p, flicker: false, expressions: false } }))).toBe(false)
    expect(isAnimated(with_({ kind: 'pumpkins', pumpkins: { ...p, faces: [] } }))).toBe(false)
    const still = { ...S.broken, base: 'pumpkins' as const, faults: ['dead-tile' as const] }
    expect(isAnimated(with_({ kind: 'broken-wall', broken: still }))).toBe(true)
    expect(isAnimated(with_({ kind: 'broken-wall', broken: still, pumpkins: { ...p, faces: [] } }))).toBe(false)
  })

  it('a broken wall moves if its picture does, or if it flickers', () => {
    const still = { ...S.broken, base: 'grid' as const, faults: ['dead-tile' as const] }
    expect(isAnimated(with_({ kind: 'broken-wall', broken: still }))).toBe(false)
    expect(isAnimated(with_({ kind: 'broken-wall', broken: { ...still, faults: ['flicker'] } }))).toBe(true)
    expect(isAnimated(with_({ kind: 'broken-wall', broken: { ...still, base: 'ocean' } }))).toBe(true)
  })

  it('knows the ones drawn at real size', () => {
    expect(isScaleAware(with_({ kind: 'bananas' }))).toBe(true)
    expect(isScaleAware(with_({ kind: 'broken-wall', broken: { ...S.broken, base: 'rulers' } }))).toBe(true)
    expect(isScaleAware(with_({ kind: 'grid' }))).toBe(false)
  })

  it('never spans the measurement patterns across outputs', () => {
    expect(spansSurface(with_({ kind: 'smpte-rp219' }))).toBe(false)
    expect(spansSurface(with_({ kind: 'grid' }))).toBe(false)
    expect(spansSurface(with_({ kind: 'ocean' }))).toBe(true)
    expect(spansSurface(with_({ kind: 'ocean', scale: { ...S.scale, span: false } }))).toBe(false)
  })

  it('tells the encoder artwork is full range, whatever the level setting', () => {
    expect(canvasRange(with_({ kind: 'ocean', levels: 'legal' }))).toBe('full')
    expect(canvasRange(with_({ kind: 'ebu-bars', levels: 'legal' }))).toBe('legal')
    expect(canvasRange(with_({ kind: 'broken-wall', levels: 'legal', broken: { ...S.broken, base: 'smpte-rp219' } }))).toBe('legal')
  })

  it('a still of a moving pattern is taken at the chosen moment, inside the loop', () => {
    const s = with_({ kind: 'ocean', animation: { ...S.animation, seconds: 10, stillAtSeconds: 12 } })
    expect(stillTime(s)).toEqual({ t: 2, loopSeconds: 10 })
    expect(stillTime(with_({ kind: 'grid' })).t).toBe(0)
  })
})

describe('the paint environment', () => {
  const composition = { widthPx: 3840, heightPx: 1080 }
  const right = output({ id: 'b', name: 'Right', pitchMm: 2.5, compositionRect: { x: 1920, y: 0, width: 1920, height: 1080 } })

  it('places a spanned output in the composition, at its pitch', () => {
    const env = makeEnv(right, with_({ kind: 'ocean' }), 1920, 1080, { rect: right.compositionRect!, composition }, 3)
    expect(env.view).toEqual({ x: 1920, y: 0 })
    expect(env.world).toEqual(composition)
    expect(env.mmPerPx).toBe(2.5)
    expect(env.pitchAssumed).toBe(false)
    expect(env.t).toBe(3)
  })

  it('converts the pitch when a composition region is scaled onto the raster', () => {
    // A 1920 px output fed from a 960 px region: one region pixel is two LEDs.
    const env = makeEnv(right, with_({ kind: 'rulers' }), 960, 540, { rect: { x: 0, y: 0, width: 960, height: 540 }, composition }, 0)
    expect(env.mmPerPx).toBe(5)
  })

  it('uses the fallback pitch, and says so, for an output with none', () => {
    const env = makeEnv(output(), with_({ kind: 'bananas' }), 1920, 1080, null, 0)
    expect(env.mmPerPx).toBe(S.scale.pitchMm)
    expect(env.pitchAssumed).toBe(true)
  })

  it('starts each output’s uniform tiles at its own origin, where its cabinets start', () => {
    const s = with_({ kind: 'hamsters', led: { ...S.led, tileWidthPx: 500, tileHeightPx: 500 } })
    const env = makeEnv(right, s, 1920, 1080, { rect: right.compositionRect!, composition }, 0)
    expect(env.tiles[0]).toMatchObject({ x: 0, y: 0, width: 500, height: 500 })
  })

  it('does not span an output its region would stretch, and draws it as its own world', () => {
    const squashed = output({ compositionRect: { x: 0, y: 0, width: 1920, height: 1000 } })
    expect(spanPlace(squashed, with_({ kind: 'ocean' }), squashed.compositionRect, composition)).toBeNull()
    expect(spanPlace(right, with_({ kind: 'ocean' }), right.compositionRect, composition)).not.toBeNull()
  })

  it('keys a spanned output’s faults to the surface, and a lone output’s to itself', () => {
    expect(makeEnv(right, with_({ kind: 'broken-wall' }), 1920, 1080, { rect: right.compositionRect!, composition }, 0).localKey).toBe(0)
    expect(makeEnv(right, with_({ kind: 'broken-wall' }), 1920, 1080, null, 0).localKey).not.toBe(0)
  })
})

describe('absurd tile sizes', () => {
  it('a per-tile pattern refuses millions of 1 px tiles instead of hanging the tab', () => {
    const s = with_({ kind: 'hamsters', led: { ...S.led, tileWidthPx: 1, tileHeightPx: 1 } })
    const env = makeEnv(output(), s, 1920, 1080, null, 0)
    expect(env.tiles).toHaveLength(0)
    expect(env.tooManyTiles).toBeGreaterThan(2_000_000)
  })

  it('leaves an ordinary wall alone', () => {
    const env = makeEnv(output(), with_({ kind: 'hamsters' }), 1920, 1080, null, 0)
    expect(env.tooManyTiles).toBeUndefined()
    expect(env.tiles.length).toBeGreaterThan(50)
  })
})

describe('saved state from before these patterns', () => {
  it('gains every new option instead of rendering with it undefined', () => {
    const old = { ...S } as Record<string, unknown>
    for (const k of ['scale', 'animation', 'rulers', 'bananas', 'dinosaurs', 'hamsters', 'pumpkins', 'ocean', 'scene', 'broken', 'image']) delete old[k]
    const merged = _internals.merge(S, old as Partial<PatternSettings>)
    expect(merged.dinosaurs.species).toEqual(S.dinosaurs.species)
    expect(merged.broken.faults).toEqual(S.broken.faults)
    expect(merged.animation.fps).toBe('30')
    expect(merged.pumpkins.faces).toEqual(S.pumpkins.faces)
  })
})
