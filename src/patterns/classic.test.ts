import { describe, expect, it } from 'vitest'
import { installPath2D, RecordingContext } from '../../test/recording-context'
import { DEFAULT_SETTINGS } from '../state/defaults'
import type { Rect } from '../types'
import { centreLines, fitTextSize } from './centre'
import { classicLayout, drawClassicCard, GRATING_LINES, STEP_PCT } from './classic'
import { plainEnv } from './env'

installPath2D()

const SIZES: [number, number][] = [[1920, 1080], [3840, 2160], [1080, 1920], [3840, 1080], [1280, 1024], [640, 360], [64, 36]]

const corners = (r: Rect): [number, number][] => [
  [r.x, r.y],
  [r.x + r.width, r.y],
  [r.x, r.y + r.height],
  [r.x + r.width, r.y + r.height],
]

describe('the classic card layout', () => {
  it.each(SIZES)('puts a grid line through the middle both ways at %ix%i', (w, h) => {
    const L = classicLayout(w, h)
    expect(L.columns.some((x) => Math.abs(x + L.line / 2 - w / 2) <= 1)).toBe(true)
    expect(L.rows.some((y) => Math.abs(y + L.line / 2 - h / 2) <= 1)).toBe(true)
  })

  it.each(SIZES)('castellates every edge, alternating, with no gaps at %ix%i', (w, h) => {
    const L = classicLayout(w, h)
    const top = L.castellations.filter((c) => c.y === 0).sort((a, b) => a.x - b.x)
    expect(top[0]!.x).toBe(0)
    for (let i = 1; i < top.length; i++) {
      expect(top[i]!.x).toBe(top[i - 1]!.x + top[i - 1]!.width)
      expect(top[i]!.black).not.toBe(top[i - 1]!.black)
    }
    expect(top.at(-1)!.x + top.at(-1)!.width).toBe(w)
    expect(L.castellations.some((c) => c.x === 0 && c.y > 0)).toBe(true)
  })

  it.each(SIZES)('keeps everything in the circle inside it at %ix%i', (w, h) => {
    const L = classicLayout(w, h)
    const { cx, cy, r } = L.circle
    const inside = ([x, y]: [number, number]) => Math.hypot(x - cx, y - cy) <= r + 1
    for (const rect of [L.panel, ...L.gratings, ...L.steps]) for (const p of corners(rect)) expect(inside(p)).toBe(true)
    // The bars' outer top corners are cut off by the circle on purpose; their feet are inside.
    expect(inside([L.bars.x, L.bars.y + L.bars.height])).toBe(true)
    expect(inside([L.bars.x + L.bars.width, L.bars.y + L.bars.height])).toBe(true)
  })

  it.each(SIZES)('stacks bars, gratings, the panel, the steps and the ident top to bottom without overlap at %ix%i', (w, h) => {
    const L = classicLayout(w, h)
    const order = [L.bars, L.gratingLabels, L.gratings[0]!, L.panel, L.steps[0]!, L.ident]
    for (let i = 1; i < order.length; i++) expect(order[i]!.y).toBeGreaterThanOrEqual(order[i - 1]!.y + order[i - 1]!.height)
  })

  it('has gratings from 8 px lines down to 1 px, and six steps from black to white, each band tiled exactly', () => {
    const L = classicLayout(1920, 1080)
    expect(L.gratings.map((g) => g.linePx)).toEqual(GRATING_LINES)
    expect(L.steps.map((s) => s.pct)).toEqual(STEP_PCT)
    for (const band of [L.gratings, L.steps]) {
      for (let i = 1; i < band.length; i++) expect(band[i]!.x).toBe(band[i - 1]!.x + band[i - 1]!.width)
    }
  })

  it('leaves the corner circles out where there is no room for them', () => {
    expect(classicLayout(1920, 1080).corners).toHaveLength(4)
    expect(classicLayout(600, 1920).corners).toHaveLength(0)
    for (const [w, h] of SIZES) {
      const L = classicLayout(w, h)
      for (const c of L.corners) expect(Math.hypot(c.cx - L.circle.cx, c.cy - L.circle.cy)).toBeGreaterThan(L.circle.r + c.r)
    }
  })
})

describe('the centrepiece text', () => {
  const measure = (line: string, size: number) => line.length * size * 0.6

  it('drops blank lines', () => {
    expect(centreLines('  STAGE LEFT \n\n\n DSL  ')).toEqual(['STAGE LEFT', 'DSL'])
  })

  it('checks the size it picks, for a font that is wider at some sizes than at bigger ones', () => {
    // Like macOS's system font: 26 px measured wider than 26.4 px.
    const lumpy = (line: string, size: number) => line.length * size * (Number.isInteger(size) ? 0.7 : 0.6)
    const size = fitTextSize(['A LONG LINE OF TEXT'], 300, 200, lumpy)
    expect(lumpy('A LONG LINE OF TEXT', size)).toBeLessThanOrEqual(300)
  })

  it('fills the height when the text is short, and shrinks to the width when it is long', () => {
    expect(fitTextSize(['HI'], 1000, 120, measure)).toBe(100)
    const long = fitTextSize(['A VERY LONG LINE OF TEXT INDEED'], 300, 120, measure)
    expect(measure('A VERY LONG LINE OF TEXT INDEED', long)).toBeLessThanOrEqual(300)
    expect(fitTextSize([], 300, 120, measure)).toBe(0)
  })
})

describe('the classic card painter', () => {
  it.each(SIZES)('leaves the context as it found it at %ix%i, whatever is in the middle', (w, h) => {
    for (const content of ['logo', 'image', 'text'] as const) {
      const rec = new RecordingContext()
      const centre = { ...DEFAULT_SETTINGS.centre, content }
      drawClassicCard(rec.ctx, w, h, DEFAULT_SETTINGS.classic, centre, plainEnv(w, h), undefined)
      expect(rec.bad).toEqual([])
      expect(rec.stack).toHaveLength(0)
      expect(rec.m).toEqual([1, 0, 0, 1, 0, 0])
      expect(rec.globalAlpha).toBe(1)
    }
  })

  it('names the output in the ident, or leaves it out', () => {
    const output = { id: 'a', name: 'Stage left', widthPx: 1920, heightPx: 1080, rasterSource: 'manual' as const, source: 'manual' as const, regions: [], notes: [], enabled: true }
    const texts = (ident: boolean) => {
      const rec = new RecordingContext()
      drawClassicCard(rec.ctx, 1920, 1080, { ...DEFAULT_SETTINGS.classic, ident }, DEFAULT_SETTINGS.centre, plainEnv(1920, 1080), output)
      return rec.drawn.filter((d) => d.op.startsWith('text ')).map((d) => d.op)
    }
    expect(texts(true)).toContain('text Stage left  ·  1920 × 1080')
    expect(texts(false).some((t) => t.includes('Stage left'))).toBe(false)
  })
})
