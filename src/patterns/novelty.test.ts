import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/defaults'
import { hamsterCycles, inBananas, lineup, panToCentre } from './novelty'
import { layerOffset, layerWidths, seaBands } from './scenes'
import { assignFaults, applyFault, ALL_FAULTS, flickerLevel, moduleRect, noiseState, type Pixels } from './broken'
import { imagePlacement } from './image'
import { LINEUP_ORDER, SPECIES } from './art/dinosaurs'
import { loopTiming } from './loop'

describe('banana arithmetic', () => {
  it('measures in 190 mm bananas', () => {
    expect(inBananas(1900)).toBe(10)
  })
})

describe('the dinosaur line-up', () => {
  const opts = DEFAULT_SETTINGS.dinosaurs

  it('stands everything in order with the gap between, and nothing overlapping', () => {
    const items = lineup(opts)
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!
      expect(items[i]!.xM).toBeCloseTo(prev.xM + prev.widthM + opts.gapM, 9)
    }
    expect(items.map((i) => i.kind)).toEqual([
      'banana',
      'compsognathus',
      'velociraptor',
      'human',
      'ankylosaurus',
      'triceratops',
      'stegosaurus',
      'tyrannosaurus',
      'brachiosaurus',
    ])
  })

  it('reports each animal at its real size', () => {
    for (const it of lineup(opts)) {
      if (it.kind in SPECIES) {
        const sp = SPECIES[it.kind as keyof typeof SPECIES]
        expect(Math.abs(it.heightM / sp.heightM - 1)).toBeLessThan(0.06)
      }
    }
  })

  it('pans so the chosen animal is centred on the surface', () => {
    const items = lineup(opts)
    const pan = panToCentre(items, 'tyrannosaurus', 8)
    const rex = items.find((i) => i.kind === 'tyrannosaurus')!
    expect(rex.xM - pan + rex.widthM / 2).toBeCloseTo(4, 9)
  })

  it('stands the person at the front when there is no raptor to stand next to', () => {
    const kinds = lineup({ ...opts, species: ['tyrannosaurus'] }).map((i) => i.kind)
    expect(kinds).toEqual(['banana', 'human', 'tyrannosaurus'])
    expect(LINEUP_ORDER).toContain('tyrannosaurus')
  })
})

describe('moving patterns loop with no seam', () => {
  it('hamsters do whole dance cycles per loop', () => {
    expect(hamsterCycles(120, 10)).toBe(10)
    expect(Number.isInteger(hamsterCycles(137, 10.01))).toBe(true)
  })

  it('the sea at the end of the loop is the sea at the start', () => {
    const T = loopTiming({ seconds: 10, fps: '29.97' }).seconds
    const ocean = DEFAULT_SETTINGS.ocean
    const world = { widthPx: 1920, heightPx: 1080 }
    const a = seaBands(ocean.seed, ocean, world, 0, 1920, 0, T, 8)
    const b = seaBands(ocean.seed, ocean, world, 0, 1920, T, T, 8)
    expect(b).toHaveLength(a.length)
    a.forEach((band, i) => band.pts.forEach((p, j) => expect(b[i]!.pts[j]![1]).toBeCloseTo(p[1], 6)))
  })

  it('and it does move in between', () => {
    const ocean = DEFAULT_SETTINGS.ocean
    const world = { widthPx: 1920, heightPx: 1080 }
    const a = seaBands(ocean.seed, ocean, world, 0, 1920, 0, 10, 8)
    const b = seaBands(ocean.seed, ocean, world, 0, 1920, 0.5, 10, 8)
    expect(a[5]!.pts[10]![1]).not.toBeCloseTo(b[5]!.pts[10]![1], 3)
  })

  it('every scrolling layer moves a whole number of its periods per loop', () => {
    for (const speed of [1, 3, 7.5, 20]) {
      for (const w of layerWidths(speed)) {
        expect(Number.isInteger(w)).toBe(true)
        expect(w).toBeGreaterThanOrEqual(1)
        expect(layerOffset(w, 1920, 10, 10)).toBeCloseTo(0, 6)
      }
    }
  })

  it('nearer layers scroll at least as fast as further ones', () => {
    const w = layerWidths(3)
    for (let i = 1; i < w.length; i++) expect(w[i]!).toBeGreaterThanOrEqual(w[i - 1]!)
  })

  it('flicker and noise repeat with the loop', () => {
    const plan = { fault: 'flicker' as const, a: 0.3, b: 0.6, c: 0.2 }
    expect(flickerLevel(0, 10, plan)).toBe(flickerLevel(10, 10, plan))
    expect(noiseState(0, 10, 5)).toBe(noiseState(10, 10, 5))
  })
})

describe('the broken wall', () => {
  const opts = { seed: 3, faultyPct: 25, faults: ALL_FAULTS }
  /** A cols x rows grid of 100 px tiles, starting at x0. */
  const grid = (cols: number, rows: number, x0 = 0) =>
    Array.from({ length: cols * rows }, (_, i) => ({ x: x0 + (i % cols) * 100, y: Math.floor(i / cols) * 100, width: 100, height: 100 }))

  it('breaks about the stated share of tiles, the same ones for the same seed', () => {
    const tiles = grid(40, 25)
    const a = assignFaults(tiles, opts, true)
    expect(a.size / tiles.length).toBeGreaterThan(0.2)
    expect(a.size / tiles.length).toBeLessThan(0.3)
    expect([...assignFaults(tiles, opts, true)]).toEqual([...a])
    expect(assignFaults(tiles, { ...opts, seed: 4 }, true)).not.toEqual(a)
  })

  it('uses every kind of fault on a wall of any size', () => {
    const plan = [...assignFaults(grid(40, 25), opts, true).values()].map((p) => p.fault)
    expect(new Set(plan).size).toBe(ALL_FAULTS.length)
  })

  it('agrees across a span: a tile is broken the same way on every output that shows it', () => {
    // Two 1920 px outputs side by side; the second starts at 1920 on the surface.
    const left = grid(20, 5)
    const right = grid(20, 5, -20)
    const onLeft = assignFaults(left, opts, true, { x: 0, y: 0 })
    const onRight = assignFaults(right, opts, true, { x: 1920, y: 0 })
    // The tile at surface x = 1900 is on both: index 19 on the left, 0 on the right.
    for (let row = 0; row < 5; row++) {
      expect(onRight.get(row * 20)?.fault).toBe(onLeft.get(row * 20 + 19)?.fault)
    }
  })

  it('breaks outputs that are not spanned differently from one another', () => {
    const tiles = grid(20, 12)
    expect([...assignFaults(tiles, opts, true, { x: 0, y: 0 }, 1)]).not.toEqual([...assignFaults(tiles, opts, true, { x: 0, y: 0 }, 2)])
  })

  it('leaves out a frozen tile on a still picture, where it would look healthy', () => {
    const plan = [...assignFaults(grid(20, 20), { ...opts, faultyPct: 100 }, false).values()]
    expect(plan.some((p) => p.fault === 'frozen')).toBe(false)
  })

  it('breaks nothing at 0%, or with no faults chosen', () => {
    expect(assignFaults(grid(10, 10), { ...opts, faultyPct: 0 }, true).size).toBe(0)
    expect(assignFaults(grid(10, 10), { ...opts, faults: [] }, true).size).toBe(0)
  })

  it('a swapped tile shows its neighbour', () => {
    const tiles = grid(10, 4)
    const plan = assignFaults(tiles, { ...opts, faults: ['swapped'], faultyPct: 60 }, true)
    expect(plan.size).toBeGreaterThan(0)
    for (const [i, p] of plan) {
      const t = tiles[i]!
      const n = tiles[p.partner!]!
      expect(Math.abs(n.x - t.x)).toBe(100)
      expect(n.y).toBe(t.y)
    }
  })

  function img(w: number, h: number): Pixels {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let i = 0; i < w * h; i++) data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4)
    return { data, width: w, height: h }
  }
  const at = (p: Pixels, x: number, y: number) => Array.from(p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 3))
  const ctx = { modulesX: 2, modulesY: 2, scale: 1 }
  const tile = { x: 2, y: 2, w: 4, h: 4 }

  it('a dead tile is black inside, untouched outside', () => {
    const src = img(8, 8)
    const px = img(8, 8)
    applyFault(px, src, tile, { fault: 'dead-tile', a: 0, b: 0, c: 0 }, ctx)
    expect(at(px, 3, 3)).toEqual([0, 0, 0])
    expect(at(px, 1, 1)).toEqual(at(src, 1, 1))
    expect(at(px, 6, 6)).toEqual(at(src, 6, 6))
  })

  it('a lost colour zeroes one channel and keeps the others', () => {
    const src = img(8, 8)
    const px = img(8, 8)
    applyFault(px, src, tile, { fault: 'missing-channel', a: 0, b: 0, c: 0 }, ctx)
    expect(at(px, 3, 3)).toEqual([0, at(src, 3, 3)[1], at(src, 3, 3)[2]])
  })

  it('a wrong colour order swaps red and blue', () => {
    const src = img(8, 8)
    const px = img(8, 8)
    applyFault(px, src, tile, { fault: 'colour-order', a: 0, b: 0.9, c: 0 }, ctx)
    const [r, g, b] = at(src, 4, 4)
    expect(at(px, 4, 4)).toEqual([b, g, r])
  })

  it('an upside-down module is that module turned 180°', () => {
    const src = img(8, 8)
    const px = img(8, 8)
    applyFault(px, src, tile, { fault: 'upside-down', a: 0, b: 0, c: 0 }, ctx)
    // Module 0 is the tile's top-left 2x2: (2,2)-(3,3).
    expect(at(px, 2, 2)).toEqual(at(src, 3, 3))
    expect(at(px, 3, 2)).toEqual(at(src, 2, 3))
    expect(at(px, 4, 2)).toEqual(at(src, 4, 2))
  })

  it('a swapped tile copies its partner exactly', () => {
    const src = img(8, 8)
    const px = img(8, 8)
    applyFault(px, src, { x: 0, y: 0, w: 4, h: 4 }, { fault: 'swapped', a: 0, b: 0, c: 0 }, { ...ctx, partnerRect: { x: 4, y: 4, w: 4, h: 4 } })
    expect(at(px, 0, 0)).toEqual(at(src, 4, 4))
    expect(at(px, 3, 3)).toEqual(at(src, 7, 7))
  })

  it('modules tile their cabinet with no gaps', () => {
    const t = { x: 10, y: 20, w: 105, h: 63 }
    let area = 0
    for (let i = 0; i < 6; i++) {
      const m = moduleRect(t, 3, 2, i)
      area += m.w * m.h
    }
    expect(area).toBe(t.w * t.h)
  })
})

describe('fitting an image', () => {
  it('contains: the whole image, letterboxed, centred', () => {
    expect(imagePlacement(1000, 1000, 1920, 1080, 'contain', 'centre', 'centre')).toEqual({ dx: 420, dy: 0, dw: 1080, dh: 1080 })
  })

  it('covers: fills the raster and crops, anchored where asked', () => {
    const p = imagePlacement(1000, 1000, 1920, 1080, 'cover', 'centre', 'top')
    expect(p).toEqual({ dx: 0, dy: 0, dw: 1920, dh: 1920 })
    expect(imagePlacement(1000, 1000, 1920, 1080, 'cover', 'centre', 'bottom').dy).toBe(1080 - 1920)
  })

  it('stretches to exactly the raster', () => {
    expect(imagePlacement(640, 480, 1920, 1080, 'stretch', 'left', 'top')).toEqual({ dx: 0, dy: 0, dw: 1920, dh: 1080 })
  })

  it('native is 1:1 on whole pixels, so nothing is resampled', () => {
    const p = imagePlacement(641, 481, 1920, 1080, 'native', 'centre', 'centre')
    expect([p.dw, p.dh]).toEqual([641, 481])
    expect(Number.isInteger(p.dx) && Number.isInteger(p.dy)).toBe(true)
  })

  it('tiles from a whole-pixel anchor, so the repeat lands on pixel boundaries', () => {
    const p = imagePlacement(500, 400, 1920, 1081, 'tile', 'centre', 'centre')
    expect(Number.isInteger(p.dx) && Number.isInteger(p.dy)).toBe(true)
    expect([p.dw, p.dh]).toEqual([500, 400])
  })
})
