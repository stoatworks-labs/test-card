import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/defaults'
import { candleLevel, expressionLevel, tileFace, walkerAt, walkLap, type Walker } from './halloween'
import { loopTiming } from './loop'
import {
  bat,
  deadTree,
  hauntedHouse,
  HOUSE_HALF_WIDTH,
  pumpkin,
  PUMPKIN_BOTTOM,
  PUMPKIN_FACES,
  PUMPKIN_TOP,
  skeleton,
  SKELETON_WALK,
  strideOf,
  vampire,
  walkPose,
  witch,
  zombie,
  ZOMBIE_WALK,
} from './art/halloween'
import { bounds, type Shape } from './art/shapes'

/** Every point of every shape, as one flat list, for "the same drawing" comparisons. */
const flat = (shapes: Shape[]) => shapes.flatMap((s) => s.pts.flatMap(([x, y]) => [x, y]))

function expectSameDrawing(a: Shape[], b: Shape[]) {
  const fa = flat(a)
  const fb = flat(b)
  expect(fb).toHaveLength(fa.length)
  fa.forEach((v, i) => expect(fb[i]!).toBeCloseTo(v, 9))
}

const LOOPS = [loopTiming({ seconds: 10, fps: '30' }).seconds, loopTiming({ seconds: 10, fps: '29.97' }).seconds, 7]

describe('Halloween timing loops with no seam', () => {
  it('a candle flickers the same at the end of the loop as at the start, and does flicker', () => {
    for (const T of LOOPS) {
      for (const key of [1, 99, 123456]) {
        expect(candleLevel(T, T, key)).toBeCloseTo(candleLevel(0, T, key), 9)
        const levels = Array.from({ length: 40 }, (_, i) => candleLevel((i * T) / 40, T, key))
        for (const v of levels) {
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(1)
        }
        expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.1)
      }
    }
  })

  it('a face is at rest most of the time and pulls a face now and then, the same at both ends', () => {
    for (const T of LOOPS) {
      for (const key of [2, 77, 4242]) {
        expect(expressionLevel(T, T, key)).toBeCloseTo(expressionLevel(0, T, key), 9)
        const levels = Array.from({ length: 400 }, (_, i) => expressionLevel((i * T) / 400, T, key))
        const busy = levels.filter((v) => v > 0).length / levels.length
        expect(busy).toBeGreaterThan(0.05)
        expect(busy).toBeLessThan(0.3)
        expect(Math.max(...levels)).toBeGreaterThan(0.9)
      }
    }
  })

  it('a walker does exactly one lap and whole strides per loop, and never walks backwards', () => {
    for (const T of LOOPS) {
      for (const kind of ['zombie', 'skeleton'] as const) {
        const wk: Walker = { kind, x: 300, y: 900, heightPx: 210, dir: kind === 'zombie' ? 1 : -1, look: 1 }
        const lap = 1920
        const start = walkerAt(wk, lap, 0, T)
        const end = walkerAt(wk, lap, T, T)
        expect(end.x).toBeCloseTo(start.x, 9)
        expect(end.gait).toBeCloseTo(start.gait, 9)
        // Just before the wrap it is nearly a whole lap on.
        const late = walkerAt(wk, lap, T * 0.999, T)
        expect(Math.abs(late.x - start.x)).toBeGreaterThan(lap * 0.99)
        let prev = start.x
        for (let i = 1; i <= 200; i++) {
          const x = walkerAt(wk, lap, (i * T) / 200, T).x
          if (i < 200) expect((x - prev) * wk.dir).toBeGreaterThan(0)
          prev = x
        }
      }
    }
  })

  it('walks a lap that keeps the dead at a walking pace on a wide span', () => {
    expect(walkLap({ widthPx: 1920, heightPx: 1080 })).toBe(1920)
    const wide = walkLap({ widthPx: 1920 * 6, heightPx: 1080 })
    expect(wide).toBe(1920)
    expect(Number.isInteger((1920 * 6) / wide)).toBe(true)
    expect(walkLap({ widthPx: 1080, heightPx: 1920 })).toBe(1080)
  })
})

describe('the pumpkin patch', () => {
  const opts = DEFAULT_SETTINGS.pumpkins

  it('deals the same face to the same tile every time, and a variety across the wall', () => {
    const faces = new Set<string | null>()
    for (let col = -3; col < 12; col++) {
      for (let row = 0; row < 6; row++) {
        const f = tileFace(opts, { col, row }, 0)
        expect(tileFace(opts, { col, row }, 0)).toBe(f)
        faces.add(f)
      }
    }
    expect(faces.size).toBe(PUMPKIN_FACES.length)
  })

  it('carves only the faces ticked, and none when none are', () => {
    for (let col = 0; col < 20; col++) expect(tileFace({ ...opts, faces: ['sly'] }, { col, row: 1 }, 0)).toBe('sly')
    expect(tileFace({ ...opts, faces: [] }, { col: 0, row: 0 }, 0)).toBeNull()
  })

  it('gives outputs that are each their own world their own arrangement', () => {
    const deal = (key: number) => Array.from({ length: 30 }, (_, col) => tileFace(opts, { col, row: 0 }, key)).join()
    expect(deal(11)).not.toBe(deal(12))
  })
})

describe('Halloween artwork', () => {
  it.each(PUMPKIN_FACES)('the %s face is carved inside the pumpkin, at rest and mid-expression', (face) => {
    for (const e of [0, 0.5, 1]) {
      const pk = pumpkin(face, e)
      expect(pk.holes.length).toBeGreaterThanOrEqual(3)
      for (const hole of [...pk.holes, ...pk.walls]) {
        for (const [x, y] of hole.pts) {
          // Inside the pumpkin's outline: an ellipse half a unit wide and 0.37 tall.
          expect((x / 0.5) ** 2 + (y / 0.37) ** 2).toBeLessThan(0.92)
        }
      }
    }
  })

  it.each(PUMPKIN_FACES)('the %s face actually changes when it pulls a face', (face) => {
    expect(flat(pumpkin(face, 1).holes.map((h) => ({ pts: h.pts })))).not.toEqual(flat(pumpkin(face, 0).holes.map((h) => ({ pts: h.pts }))))
  })

  it('a pumpkin with no face is uncarved, and fits the size the painter allows for', () => {
    const plain = pumpkin(null)
    expect(plain.holes).toHaveLength(0)
    const b = bounds(plain.body)
    expect(b.x0).toBeGreaterThanOrEqual(-0.51)
    expect(b.x1).toBeLessThanOrEqual(0.51)
    expect(b.y0).toBeGreaterThanOrEqual(PUMPKIN_TOP - 0.01)
    expect(b.y1).toBeLessThanOrEqual(PUMPKIN_BOTTOM + 0.01)
  })

  it.each([
    ['zombie', (g: number) => zombie(g, 3)],
    ['skeleton', (g: number) => skeleton(g)],
  ] as const)('a %s stands on the ground and is one body height tall all through its stride', (_name, draw) => {
    for (let g = 0; g < 1; g += 0.05) {
      const b = bounds(draw(g))
      expect(b.y0).toBeGreaterThan(-0.02)
      expect(b.y0).toBeLessThan(0.02)
      expect(b.y1).toBeGreaterThan(0.95)
      expect(b.y1).toBeLessThan(1.08)
    }
  })

  it('every walker, flyer and flapper is in the same pose at the end of its cycle as at the start', () => {
    expectSameDrawing(zombie(0, 5), zombie(1, 5))
    expectSameDrawing(skeleton(0), skeleton(1))
    expectSameDrawing(witch(100, 0, true, '#000'), witch(100, 1, true, '#000'))
    expectSameDrawing(vampire(100, 0), vampire(100, 1))
    expectSameDrawing(bat(40, 0, '#000'), bat(40, 1, '#000'))
    for (const style of [ZOMBIE_WALK, SKELETON_WALK]) {
      const a = walkPose(0, style)
      const b = walkPose(1, style)
      expect(b.hip[1]).toBeCloseTo(a.hip[1], 9)
      a.legs.forEach((leg, i) => leg.forEach((p, j) => expect(b.legs[i]![j]![0]).toBeCloseTo(p[0], 9)))
    }
  })

  it('walkers take strides of a sensible length', () => {
    expect(strideOf(ZOMBIE_WALK)).toBeGreaterThan(0.4)
    expect(strideOf(SKELETON_WALK)).toBeGreaterThan(strideOf(ZOMBIE_WALK))
    expect(strideOf(SKELETON_WALK)).toBeLessThan(1)
  })

  it('a dead tree is the same tree for the same seed, and stands on its roots', () => {
    expect(deadTree(0, 0, 300, 7, '#000')).toEqual(deadTree(0, 0, 300, 7, '#000'))
    expect(flat(deadTree(0, 0, 300, 8, '#000'))).not.toEqual(flat(deadTree(0, 0, 300, 7, '#000')))
    const b = bounds(deadTree(0, 0, 300, 7, '#000', 3))
    expect(b.y1).toBeLessThanOrEqual(1.01)
    expect(b.y0).toBeLessThan(-200)
  })

  it('the haunted house always has lights on, and its windows are on the house', () => {
    for (const seed of [1, 2, 3, 4, 5, 99]) {
      const house = hauntedHouse(1000, 600, 500, seed)
      expect(house.windows.filter((w) => w.state === 'lit').length).toBeGreaterThanOrEqual(3)
      for (const w of house.windows) {
        expect(Math.abs(w.cx - 1000)).toBeLessThan(HOUSE_HALF_WIDTH * 500)
        expect(w.cy).toBeLessThan(600)
        expect(w.cy).toBeGreaterThan(600 - 500)
      }
      expect(house.spire[1]).toBeCloseTo(100, 6)
      expect(hauntedHouse(1000, 600, 500, seed)).toEqual(house)
    }
  })
})
