import { describe, expect, it } from 'vitest'
import { BANANA_LENGTH_MM, bananaBunch, bananaLengthMm, BUNCH_SIZE } from './bananas'
import { HUMAN_HEIGHT_M, human, LINEUP_ORDER, measuredLength, poseDinosaur, shapesBounds, SPECIES } from './dinosaurs'
import { DANCES, FRAMES, hamsterFrame, PALETTE, SPRITE_SIZE } from './hamster'
import { makeRidge } from './scenery'
import { bounds, mapShapes } from './shapes'

/**
 * The art is held to the sizes it claims. A "life-size" pattern whose
 * Tyrannosaurus is 14 m long, or whose banana is a cucumber, is the confidently
 * wrong kind of test pattern this repo exists to avoid.
 */

describe('banana for scale', () => {
  it('is 190 mm along its curve', () => {
    expect(bananaLengthMm()).toBeCloseTo(BANANA_LENGTH_MM, 6)
  })

  it('comes as a bunch of five, about 21 x 18 cm', () => {
    const b = bounds(bananaBunch(1))
    expect(BUNCH_SIZE).toBe(5)
    expect(b.x1 - b.x0).toBeGreaterThan(180)
    expect(b.x1 - b.x0).toBeLessThan(240)
    expect(b.y1 - b.y0).toBeGreaterThan(150)
    expect(b.y1 - b.y0).toBeLessThan(220)
  })

  it('is the same bunch every time for a seed', () => {
    expect(bananaBunch(4)).toEqual(bananaBunch(4))
  })
})

describe('dinosaurs', () => {
  it.each(LINEUP_ORDER)('%s is its quoted length nose to tail, within 3%%', (id) => {
    const sp = SPECIES[id]
    expect(Math.abs(measuredLength(sp) / sp.lengthM - 1)).toBeLessThan(0.035)
  })

  it.each(LINEUP_ORDER)('%s is its stated height, within 6%%, and stands on the ground', (id) => {
    const sp = SPECIES[id]
    const b = shapesBounds(poseDinosaur(sp))
    expect(Math.abs(b.y1 / sp.heightM - 1)).toBeLessThan(0.06)
    expect(b.y0).toBeGreaterThan(-0.05)
    expect(b.y0).toBeLessThan(0.05)
  })

  it.each(LINEUP_ORDER)('%s keeps its size while it walks', (id) => {
    const sp = SPECIES[id]
    for (const p of [0, 0.25, 0.5, 0.75]) {
      const b = shapesBounds(poseDinosaur(sp, p))
      // Feet lift and the body bobs, but nothing sinks through the floor.
      expect(b.y0).toBeGreaterThan(-0.05 * sp.hipM)
      expect(b.y1 / sp.heightM).toBeGreaterThan(0.9)
      expect(b.y1 / sp.heightM).toBeLessThan(1.12)
    }
  })

  it('is in the same pose at the end of a stride as at the start', () => {
    for (const id of LINEUP_ORDER) {
      const a = poseDinosaur(SPECIES[id], 0)
      const b = poseDinosaur(SPECIES[id], 1)
      expect(b).toHaveLength(a.length)
      a.forEach((s, i) => s.pts.forEach((p, j) => {
        expect(b[i]!.pts[j]![0]).toBeCloseTo(p[0], 9)
        expect(b[i]!.pts[j]![1]).toBeCloseTo(p[1], 9)
      }))
    }
  })

  it('has a person who is 1.75 m', () => {
    const b = shapesBounds(human())
    expect(b.y1).toBeCloseTo(HUMAN_HEIGHT_M, 2)
  })
})

describe('hamsters', () => {
  it.each(DANCES)('every %s frame is a square sprite in the palette', (dance) => {
    for (let f = 0; f < FRAMES; f++) {
      const rows = hamsterFrame(dance, f)
      expect(rows).toHaveLength(SPRITE_SIZE)
      for (const row of rows) {
        expect(row).toHaveLength(SPRITE_SIZE)
        for (const ch of row) expect(ch === '.' || ch in PALETTE).toBe(true)
      }
    }
  })

  it('the frames of each dance actually differ — they dance', () => {
    for (const dance of DANCES) {
      const frames = new Set(Array.from({ length: FRAMES }, (_, f) => hamsterFrame(dance, f).join('\n')))
      expect(frames.size).toBeGreaterThan(1)
    }
  })

  it('no hamster is cut off by its own sprite', () => {
    for (const dance of DANCES) {
      for (let f = 0; f < FRAMES; f++) {
        const rows = hamsterFrame(dance, f)
        expect(rows[SPRITE_SIZE - 1]!.includes('o')).toBe(false)
        expect(rows[0]!.includes('o')).toBe(false)
      }
    }
  })
})

describe('scenery', () => {
  it('a ridge tiles exactly with its period, so a scrolling range has no seam', () => {
    const period = 1913
    const h = makeRidge(7, period)
    for (let x = 0; x < period; x += 37) expect(h(x + period)).toBeCloseTo(h(x), 9)
  })
})

describe('mapShapes', () => {
  it('scales stroke widths when it changes units', () => {
    const [s] = mapShapes([{ pts: [[0, 0], [1, 1]], stroke: '#000', strokeWidth: 1.2, closed: false }], ([x, y]) => [x / 1000, y / 1000], 1 / 1000)
    expect(s!.strokeWidth).toBeCloseTo(0.0012, 9)
  })
})
