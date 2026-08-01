import { describe, expect, it } from 'vitest'
import reference from '../../test/fixtures/rp219-ffmpeg.json'
import { greyPct, rgbToYcbcr, unitToCode, ycbcrToRgb, ycbcrToUnit } from '../lib/colour'
import { layOut, rp219Layout } from './rp219'

type RefColumn = {
  name: string | null
  x: number
  w: number
  ycbcr?: number[]
}
type RefRow = { row: string; y: number; h: number; columns: RefColumn[] }
type RefSize = { width: number; height: number; rows: RefRow[] }

const SIZES = reference.sizes as RefSize[]

/**
 * ffmpeg rounds each bar up and dumps the accumulated remainder into the final
 * column; this implementation rounds each cumulative boundary to nearest so the
 * two grey blocks stay equal. The two therefore disagree by a few pixels in the
 * interior, growing towards the right-hand edge. At 1280x720 — the worst of the
 * four sizes, because 3W/28 lands furthest from an integer — the drift reaches
 * 6px. See the header of rp219.ts for why matching ffmpeg exactly is not the
 * goal. Anything beyond this means the proportional model itself is wrong.
 */
const BOUNDARY_TOLERANCE_PX = 8

function rowsOf(width: number, height: number) {
  const bands = rp219Layout(width, height)
  const byRow = new Map<string, ReturnType<typeof rp219Layout>>()
  for (const b of bands) {
    const list = byRow.get(b.row) ?? []
    list.push(b)
    byRow.set(b.row, list)
  }
  return byRow
}

describe('layOut', () => {
  it('tiles the total exactly, with no gap or overlap', () => {
    for (const total of [1080, 1081, 720, 2160, 7, 1]) {
      const segs = layOut([7 / 12, 1 / 12, 1 / 12, 3 / 12], total)
      expect(segs[0]!.start).toBe(0)
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i]!.start).toBe(segs[i - 1]!.start + segs[i - 1]!.size)
      }
      const last = segs[segs.length - 1]!
      expect(last.start + last.size).toBe(total)
      expect(segs.reduce((a, s) => a + s.size, 0)).toBe(total)
    }
  })

  it('keeps every boundary within half a pixel of nominal', () => {
    const weights = [1 / 8, ...Array(7).fill(3 / 28), 1 / 8]
    const total = 1920
    const segs = layOut(weights, total)
    let acc = 0
    for (let i = 0; i < weights.length - 1; i++) {
      acc += weights[i]!
      expect(Math.abs(segs[i]!.start + segs[i]!.size - acc * total)).toBeLessThanOrEqual(0.5)
    }
  })
})

describe('RP 219 geometry against the ffmpeg reference', () => {
  for (const size of SIZES) {
    const { width, height } = size

    it(`${width}x${height}: row boundaries match exactly`, () => {
      const byRow = rowsOf(width, height)
      for (const refRow of size.rows) {
        const bands = byRow.get(refRow.row)!
        expect(bands, `row ${refRow.row}`).toBeDefined()
        // Every band in a row shares that row's y and height.
        for (const b of bands) {
          expect(b.y, `row ${refRow.row} y`).toBe(refRow.y)
          expect(b.height, `row ${refRow.row} height`).toBe(refRow.h)
        }
      }
    })

    it(`${width}x${height}: each row has the same number of columns`, () => {
      const byRow = rowsOf(width, height)
      for (const refRow of size.rows) {
        expect(byRow.get(refRow.row)!.length, `row ${refRow.row}`).toBe(refRow.columns.length)
      }
    })

    it(`${width}x${height}: column boundaries agree within ${BOUNDARY_TOLERANCE_PX}px`, () => {
      const byRow = rowsOf(width, height)
      for (const refRow of size.rows) {
        const bands = byRow.get(refRow.row)!
        for (let i = 0; i < refRow.columns.length; i++) {
          const ref = refRow.columns[i]!
          const band = bands[i]!
          expect(
            Math.abs(band.x - ref.x),
            `row ${refRow.row} col ${i} (${band.name}) x: got ${band.x}, ffmpeg ${ref.x}`,
          ).toBeLessThanOrEqual(BOUNDARY_TOLERANCE_PX)
        }
        // Whatever the drift, the row must still cover the full raster.
        expect(bands[0]!.x).toBe(0)
        const last = bands[bands.length - 1]!
        expect(last.x + last.width).toBe(width)
      }
    })

    it(`${width}x${height}: bands tile the raster with no gaps`, () => {
      const byRow = rowsOf(width, height)
      for (const [, bands] of byRow) {
        for (let i = 1; i < bands.length; i++) {
          expect(bands[i]!.x).toBe(bands[i - 1]!.x + bands[i - 1]!.width)
        }
      }
      const total = rp219Layout(width, height).reduce((a, b) => a + b.width * b.height, 0)
      expect(total).toBe(width * height)
    })
  }
})

describe('RP 219 colours against the ffmpeg reference', () => {
  it('every computed Y’CbCr lands on the measured code value', () => {
    // The reference is identical at all four sizes, so one is enough — but check
    // them all, since a size-dependent colour would be a real bug.
    for (const size of SIZES) {
      const byRow = rowsOf(size.width, size.height)
      for (const refRow of size.rows) {
        const bands = byRow.get(refRow.row)!
        for (let i = 0; i < refRow.columns.length; i++) {
          const ref = refRow.columns[i]!
          if (!ref.ycbcr) continue // the ramp
          const band = bands[i]!
          expect(band.fill.kind).toBe('flat')
          if (band.fill.kind !== 'flat') continue
          const got = band.fill.colour
          const where = `${size.width}x${size.height} row ${refRow.row} "${band.name}"`
          expect(Math.round(got.y), `${where} Y`).toBe(ref.ycbcr[0])
          expect(Math.round(got.cb), `${where} Cb`).toBe(ref.ycbcr[1])
          expect(Math.round(got.cr), `${where} Cr`).toBe(ref.ycbcr[2])
        }
      }
    }
  })

  it('the ramp spans reference black to reference white', () => {
    const rampBand = rp219Layout(1920, 1080).find((b) => b.fill.kind === 'ramp')
    expect(rampBand).toBeDefined()
    expect(rampBand!.row).toBe('C')
    // ffmpeg sweeps raw code 0..254 here, including sub-black and super-white;
    // RP 219 specifies 0% to 100%, which is what this implements.
    expect(unitToCode(0, 'legal')).toBe(16)
    expect(unitToCode(1, 'legal')).toBe(235)
    expect(unitToCode(0, 'full')).toBe(0)
    expect(unitToCode(1, 'full')).toBe(255)
  })
})

describe('colour conversion', () => {
  it('round-trips R’G’B’ through Y’CbCr', () => {
    for (const [r, g, b] of [
      [1, 1, 1],
      [0, 0, 0],
      [0.75, 0.75, 0],
      [0, 1, 1],
      [0.2, 0.6, 0.9],
    ] as const) {
      const back = ycbcrToUnit(rgbToYcbcr(r, g, b))
      expect(back.r).toBeCloseTo(r, 3)
      expect(back.g).toBeCloseTo(g, 3)
      expect(back.b).toBeCloseTo(b, 3)
    }
  })

  it('renders 75% yellow as 191,191,0 in full range — not ffmpeg’s BT.601 189,202,7', () => {
    const rgb = ycbcrToRgb(rgbToYcbcr(0.75, 0.75, 0), 'full')
    expect(rgb).toEqual({ r: 191, g: 191, b: 0 })
  })

  it('puts reference black and white at the right codes in each range', () => {
    expect(ycbcrToRgb(greyPct(0), 'full')).toEqual({ r: 0, g: 0, b: 0 })
    expect(ycbcrToRgb(greyPct(100), 'full')).toEqual({ r: 255, g: 255, b: 255 })
    expect(ycbcrToRgb(greyPct(0), 'legal')).toEqual({ r: 16, g: 16, b: 16 })
    expect(ycbcrToRgb(greyPct(100), 'legal')).toEqual({ r: 235, g: 235, b: 235 })
  })

  it('clamps sub-black to 0 in full range but keeps it in legal range', () => {
    // This is why the pluge is only meaningful on a legal-range export.
    expect(ycbcrToRgb(greyPct(-2), 'full').r).toBe(0)
    expect(ycbcrToRgb(greyPct(-2), 'legal').r).toBe(12)
    expect(ycbcrToRgb(greyPct(2), 'legal').r).toBe(20)
    expect(ycbcrToRgb(greyPct(4), 'legal').r).toBe(25)
  })
})
