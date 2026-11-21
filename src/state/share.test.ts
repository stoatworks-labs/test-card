import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Output, PatternSettings } from '../types'
import { parsePixelPeekerInterchange } from '../import/pixelpeeker'
import { DEFAULT_SETTINGS } from './defaults'
import { diff, merge, mergeKnown } from './merge'
import { decodeShare, encodeShare, shareToken, shareUrl, ShareLinkError, usesPicture } from './share'
import type { Setup } from './store'

const FIX = join(__dirname, '../../test/fixtures')

const output = (over: Partial<Output> = {}): Output => ({
  id: 'manual-1',
  name: 'Centre LED',
  widthPx: 1920,
  heightPx: 1080,
  rasterSource: 'manual',
  source: 'manual',
  regions: [],
  notes: [],
  enabled: true,
  ...over,
})

const setup = (over: Partial<Setup> = {}): Setup => ({
  outputs: [output()],
  settings: DEFAULT_SETTINGS,
  projectName: 'test-card',
  mode: 'per-output',
  ...over,
})

/** A raw token, made the way encodeShare makes one, from any JSON at all. */
async function tokenOf(value: unknown): Promise<string> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('merge, mergeKnown and diff', () => {
  it('diff is the smallest patch merge turns back into the value', () => {
    const changed = merge(DEFAULT_SETTINGS, {
      kind: 'grid',
      grid: { spacingPx: 64, colour: '#ff0000' },
      alignment: { safeAreas: [5] },
      idle: { looks: { pipes: { speed: 0.9 } } },
    })
    const d = diff(DEFAULT_SETTINGS, changed)
    expect(d).toEqual({
      kind: 'grid',
      grid: { spacingPx: 64, colour: '#ff0000' },
      alignment: { safeAreas: [5] },
      idle: { looks: { pipes: { speed: 0.9 } } },
    })
    expect(merge(DEFAULT_SETTINGS, d!)).toEqual(changed)
  })

  it('diff of equal values is undefined, and arrays go whole', () => {
    expect(diff(DEFAULT_SETTINGS, structuredClone(DEFAULT_SETTINGS))).toBeUndefined()
    const fewer = merge(DEFAULT_SETTINGS, { dinosaurs: { species: ['tyrannosaurus'] } })
    expect(diff(DEFAULT_SETTINGS, fewer)).toEqual({ dinosaurs: { species: ['tyrannosaurus'] } })
  })

  it('mergeKnown takes only known keys, of the right sort', () => {
    const got = mergeKnown(DEFAULT_SETTINGS, {
      grid: { spacingPx: 'lots', lineWidthPx: 4, fromTheFuture: true },
      solid: { levelPct: Number.NaN },
      alignment: { safeAreas: 'none' },
      newPattern: { x: 1 },
      overlay: 'off',
    })
    expect(got.grid.spacingPx).toBe(DEFAULT_SETTINGS.grid.spacingPx)
    expect(got.grid.lineWidthPx).toBe(4)
    expect('fromTheFuture' in got.grid).toBe(false)
    expect(got.solid.levelPct).toBe(DEFAULT_SETTINGS.solid.levelPct)
    expect(got.alignment.safeAreas).toEqual(DEFAULT_SETTINGS.alignment.safeAreas)
    expect('newPattern' in got).toBe(false)
    expect(got.overlay).toEqual(DEFAULT_SETTINGS.overlay)
  })
})

describe('share links', () => {
  it('round-trip a setup exactly', async () => {
    const settings: PatternSettings = merge(DEFAULT_SETTINGS, {
      kind: 'dinosaurs',
      levels: 'legal',
      scale: { pitchMm: 3.9, floorMm: 1200 },
      dinosaurs: { species: ['brachiosaurus', 'compsognathus'], panM: -2.25 },
      overlay: { customText: 'Main stage — day 2 ✓', position: 'centre' },
      idle: { text: 'Back soon', looks: { maze: { fog: 0.125 } } },
    })
    const s = setup({
      outputs: [
        output({ pitchMm: 2.6, pitchSource: 'manual', compositionRect: { x: 0, y: 0, width: 1920, height: 1080 } }),
        output({ id: 'manual-2', name: 'Stage right', widthPx: 1080, heightPx: 1920, enabled: false, notes: ['rotated'] }),
      ],
      settings,
      projectName: 'Main stage',
      composition: { widthPx: 3000, heightPx: 1920 },
      mode: 'composition',
    })
    const shared = await decodeShare(await encodeShare(s, ['One raster was inferred from its slices.']))
    expect(shared.setup).toEqual(s)
    expect(shared.warnings).toEqual(['One raster was inferred from its slices.'])
  })

  it('keep a link to plain bars short', async () => {
    const token = await encodeShare(setup())
    expect(token.length).toBeLessThan(200)
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    const empty = await encodeShare(setup({ outputs: [] }))
    expect((await decodeShare(empty)).setup).toEqual(setup({ outputs: [] }))
  })

  it('carry a real Pixel Peeker cabinet map whole', async () => {
    const imported = parsePixelPeekerInterchange(JSON.parse(readFileSync(join(FIX, 'pixel-peeker-interchange.json'), 'utf8')))
    const cabinets = imported.outputs.reduce((n, o) => n + o.regions.length, 0)
    expect(cabinets).toBeGreaterThan(50)
    const s = setup({
      outputs: imported.outputs,
      projectName: imported.projectName,
      composition: imported.composition,
      settings: merge(DEFAULT_SETTINGS, { kind: 'led-tiles', led: { source: 'cabinets', colourByGroup: true } }),
    })
    const token = await encodeShare(s, imported.warnings)
    const shared = await decodeShare(token)
    expect(shared.setup).toEqual(s)
    expect(shared.warnings).toEqual(imported.warnings)
    // Long, but a long way inside what a browser takes in a URL.
    expect(token.length).toBeLessThan(64 * 1024)
  })

  it('put the token in the fragment, and read it back out', async () => {
    const token = await encodeShare(setup())
    const url = shareUrl('https://test-card.example/?live=abc#old', token)
    expect(url).toBe(`https://test-card.example/#share=${token}`)
    expect(shareToken(new URL(url).hash)).toBe(token)
    expect(shareToken('')).toBeNull()
    expect(shareToken('#something-else')).toBeNull()
    expect(shareToken('#share=')).toBeNull()
  })

  it('refuse a damaged link with a reason', async () => {
    const token = await encodeShare(setup())
    await expect(decodeShare(token.slice(0, token.length - 12))).rejects.toThrow(ShareLinkError)
    await expect(decodeShare('not*a*token')).rejects.toThrow(/damaged/)
    await expect(decodeShare(await tokenOf([1, 2, 3]))).rejects.toThrow(/not a Test Card/)
    await expect(decodeShare(await tokenOf({ v: 2 }))).rejects.toThrow(/newer Test Card/)
    await expect(decodeShare(await tokenOf({ v: 1, o: [{ id: 'x', name: 'x' }] }))).rejects.toThrow(/outputs/)
    await expect(
      decodeShare(await tokenOf({ v: 1, o: [{ ...output(), widthPx: '1920' }] })),
    ).rejects.toThrow(/outputs/)
  })

  it('refuse a link that inflates past any real setup', async () => {
    // About 20 MB of spaces deflates to a few kilobytes.
    const bomb = await tokenOf({ v: 1, p: ' '.repeat(20 * 1024 * 1024) })
    expect(bomb.length).toBeLessThan(100_000)
    await expect(decodeShare(bomb)).rejects.toThrow(/more than a setup/)
  })

  it('fall back to the defaults for what it cannot use', async () => {
    const shared = await decodeShare(
      await tokenOf({ v: 1, s: { kind: 'toString', broken: { base: 'broken-wall' } }, m: 'composition', p: 42 }),
    )
    expect(shared.setup.settings.kind).toBe(DEFAULT_SETTINGS.kind)
    expect(shared.setup.settings.broken.base).toBe(DEFAULT_SETTINGS.broken.base)
    // No composition size, so not composition mode.
    expect(shared.setup.mode).toBe('per-output')
    expect(shared.setup.projectName).toBe('test-card')
  })
})

describe('usesPicture', () => {
  it('knows which patterns show the loaded picture', () => {
    const s = (patch: Parameters<typeof merge<PatternSettings>>[1]) => merge(DEFAULT_SETTINGS, patch)
    expect(usesPicture(DEFAULT_SETTINGS)).toBe(false)
    expect(usesPicture(s({ kind: 'image' }))).toBe(true)
    expect(usesPicture(s({ kind: 'classic-card' }))).toBe(false)
    expect(usesPicture(s({ kind: 'classic-card', centre: { content: 'image' } }))).toBe(true)
    expect(usesPicture(s({ kind: 'av-sync', centre: { content: 'image' } }))).toBe(true)
    expect(usesPicture(s({ kind: 'grid', centre: { content: 'image' } }))).toBe(false)
    expect(usesPicture(s({ kind: 'broken-wall', broken: { base: 'image' } }))).toBe(true)
  })
})
