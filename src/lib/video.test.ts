import { afterEach, describe, expect, it } from 'vitest'
import {
  autoBitrate,
  avcCodecs,
  avcLevel,
  estimateLoopBytes,
  MAX_LOOP_BYTES,
  planLoop,
  rgbaToI420,
  tileGrid,
  tileGrids,
  videoProblem,
} from './video'
import { rgbToYcbcr, unitToCode } from './colour'

/** A flat RGBA image. */
function flat(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) out.set([r, g, b, 255], i * 4)
  return out
}

const BARS: [string, number, number, number][] = [
  ['white', 0.75, 0.75, 0.75],
  ['yellow', 0.75, 0.75, 0],
  ['cyan', 0, 0.75, 0.75],
  ['green', 0, 0.75, 0],
  ['magenta', 0.75, 0, 0.75],
  ['red', 0.75, 0, 0],
  ['blue', 0, 0, 0.75],
  ['black', 0, 0, 0],
]

describe('rgbaToI420', () => {
  it.each(BARS)('writes 75%% %s with the Rec.709 matrix from colour.ts', (_name, r, g, b) => {
    // From the 8-bit RGB a canvas holds, not the ideal value: that is what the
    // encoder is handed, and what a PNG of the same pattern contains.
    const codes = [r, g, b].map((v) => unitToCode(v, 'full'))
    const ideal = rgbToYcbcr(codes[0]! / 255, codes[1]! / 255, codes[2]! / 255)
    const out = rgbaToI420(flat(4, 4, codes[0]!, codes[1]!, codes[2]!), 4, 4, 'full')
    expect(out[0]).toBe(Math.round(ideal.y))
    expect(out[16]).toBe(Math.round(ideal.cb))
    expect(out[20]).toBe(Math.round(ideal.cr))
  })

  it('gives the same Y′CbCr for a full-range and a legal-range picture of the same thing', () => {
    // Measured on browser-made bar loops: decoded within 1 code value of the
    // standard 75% bar values either way. Here, within rounding of each other.
    for (const [, r, g, b] of BARS) {
      const full = rgbaToI420(flat(2, 2, unitToCode(r, 'full'), unitToCode(g, 'full'), unitToCode(b, 'full')), 2, 2, 'full')
      const legal = rgbaToI420(flat(2, 2, unitToCode(r, 'legal'), unitToCode(g, 'legal'), unitToCode(b, 'legal')), 2, 2, 'legal')
      for (let i = 0; i < full.length; i++) expect(Math.abs(full[i]! - legal[i]!)).toBeLessThanOrEqual(1)
    }
  })

  it('keeps sub-black and super-white from a legal-range picture', () => {
    // The -2% pluge patch and a 109% white: the reason to read legal as legal.
    const sub = rgbaToI420(flat(2, 2, 12, 12, 12), 2, 2, 'legal')
    const sup = rgbaToI420(flat(2, 2, 250, 250, 250), 2, 2, 'legal')
    expect(sub[0]).toBe(12)
    expect(sup[0]).toBe(250)
  })

  it('maps full-range black and white to studio 16 and 235, chroma centred', () => {
    expect(Array.from(rgbaToI420(flat(2, 2, 0, 0, 0), 2, 2, 'full'))).toEqual([16, 16, 16, 16, 128, 128])
    expect(Array.from(rgbaToI420(flat(2, 2, 255, 255, 255), 2, 2, 'full'))).toEqual([235, 235, 235, 235, 128, 128])
  })

  it('averages each 2x2 block for chroma, and lays the planes out Y, Cb, Cr', () => {
    const img = new Uint8Array(4 * 2 * 4)
    // Left 2x2 block red, right 2x2 block blue.
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 4; x++) img.set(x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (y * 4 + x) * 4)
    }
    const out = rgbaToI420(img, 4, 2, 'full')
    expect(out).toHaveLength(4 * 2 + 2 + 2)
    const red = rgbToYcbcr(1, 0, 0)
    const blue = rgbToYcbcr(0, 0, 1)
    expect([out[8], out[9]]).toEqual([Math.round(red.cb), Math.round(blue.cb)])
    expect([out[10], out[11]]).toEqual([Math.round(red.cr), Math.round(blue.cr)])
  })
})

describe('avcLevel', () => {
  it('picks the lowest level that admits the raster and rate', () => {
    expect(avcLevel(1920, 1080, 30)).toBe(40)
    expect(avcLevel(1920, 1080, 60)).toBe(42)
    expect(avcLevel(3840, 2160, 30)).toBe(51)
    expect(avcLevel(3840, 2160, 60)).toBe(52)
    // 480 x 68 = 32 640 macroblocks fits 5.1's 36 864; at 60 fps that is
    // 1 958 400 a second, inside 5.2's 2 073 600.
    expect(avcLevel(7680, 1080, 30)).toBe(51)
    expect(avcLevel(7680, 1080, 60)).toBe(52)
  })

  it('has no level for a raster past H.264’s ceiling', () => {
    expect(avcLevel(8192, 8192, 30)).toBeNull()
    // A side may be at most sqrt(8 x MaxFS) macroblocks: 1055 at level 6, so
    // 16 384 px is allowed and 17 000 is not.
    expect(avcLevel(16384, 64, 30)).toBe(60)
    expect(avcLevel(17000, 64, 30)).toBeNull()
  })

  it('offers High, then Main, then Constrained Baseline at that level', () => {
    expect(avcCodecs(1920, 1080, 30)).toEqual(['avc1.640028', 'avc1.4d0028', 'avc1.42e028'])
    expect(avcCodecs(8192, 8192, 30)).toEqual([])
  })

  it('keeps the automatic bitrate within sane bounds', () => {
    expect(autoBitrate(64, 64, 24)).toBe(4e6)
    expect(autoBitrate(1920, 1080, 30)).toBeCloseTo(15.55e6, -4)
    expect(autoBitrate(7680, 4320, 60)).toBe(240e6)
  })
})

describe('bitrate and size', () => {
  it('moves up a level when the bitrate needs it', () => {
    expect(avcLevel(1920, 1080, 30, 15e6)).toBe(40)
    expect(avcLevel(1920, 1080, 30, 30e6)).toBe(41)
    expect(avcLevel(1920, 1080, 30, 900e6)).toBeNull()
  })

  it('estimates a loop’s size from its bitrate and length, warm-up included', () => {
    const t = { frames: 300, fpsNum: 30, fpsDen: 1, seconds: 10 }
    expect(estimateLoopBytes(1920, 1080, t, 8e6)).toBe(11e6)
  })

  it('a ten-minute 4K60 loop is over what a tab can build', () => {
    const t = { frames: 36000, fpsNum: 60, fpsDen: 1, seconds: 600 }
    expect(estimateLoopBytes(3840, 2160, t, 0)).toBeGreaterThan(MAX_LOOP_BYTES)
  })
})

describe('videoProblem', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.VideoEncoder
    delete g.VideoFrame
  })

  it('says so when the browser has no encoder', () => {
    expect(videoProblem(1920, 1080)).toMatch(/no video encoder/)
  })

  it('refuses an odd raster, which 4:2:0 H.264 cannot carry', () => {
    g.VideoEncoder = class {}
    g.VideoFrame = class {}
    expect(videoProblem(1920, 1081)).toMatch(/even width and height/)
    expect(videoProblem(1920, 1080)).toBeNull()
  })
})

describe('tileGrid', () => {
  it('cuts 8K into four UHD tiles', () => {
    expect(tileGrid(7680, 4320, 2, 2).map((t) => [t.col, t.row, t.x, t.y, t.width, t.height])).toEqual([
      [0, 0, 0, 0, 3840, 2160],
      [1, 0, 3840, 0, 3840, 2160],
      [0, 1, 0, 2160, 3840, 2160],
      [1, 1, 3840, 2160, 3840, 2160],
    ])
  })

  it.each([
    [10000, 2002, 3, 1],
    [7682, 4322, 2, 2],
    [5762, 1202, 7, 3],
    [16384, 16384, 5, 6],
  ])('covers %ix%i in %ix%i with even tiles, no gap, no overlap, sizes within 2 px', (w, h, cols, rows) => {
    const tiles = tileGrid(w, h, cols, rows)
    expect(tiles).toHaveLength(cols * rows)
    let area = 0
    for (const t of tiles) {
      // Even sides and offsets keep each tile's 2x2 chroma blocks the whole raster's.
      for (const v of [t.x, t.y, t.width, t.height]) expect(v % 2).toBe(0)
      area += t.width * t.height
    }
    expect(area).toBe(w * h)
    for (let row = 0; row < rows; row++) {
      const line = tiles.filter((t) => t.row === row)
      line.forEach((t, i) => expect(t.x).toBe(i ? line[i - 1]!.x + line[i - 1]!.width : 0))
      expect(line.at(-1)!.x + line.at(-1)!.width).toBe(w)
    }
    const widths = tiles.map((t) => t.width)
    const heights = tiles.map((t) => t.height)
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2)
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2)
  })

  it('refuses an odd raster, which no set of even tiles can cover', () => {
    expect(() => tileGrid(1921, 1080, 2, 1)).toThrow(/even raster/)
  })
})

describe('tileGrids', () => {
  it('tries the whole raster first, then few tiles of a sane shape', () => {
    const order = tileGrids(7680, 4320).map((g) => `${g.cols}x${g.rows}`)
    expect(order.slice(0, 5)).toEqual(['1x1', '2x1', '1x2', '3x1', '2x2'])
    // Four tiles: UHD-shaped before tall strips or wide ones.
    expect(order.indexOf('2x2')).toBeLessThan(order.indexOf('4x1'))
    expect(order.indexOf('4x1')).toBeLessThan(order.indexOf('1x4'))
  })

  it.each([
    [16000, 1000],
    [1000, 16000],
    [7680, 4320],
    [17, 4000],
  ])('always tries %ix%i whole before cutting it', (w, h) => {
    expect(tileGrids(w, h)[0]).toEqual({ cols: 1, rows: 1 })
  })

  it('will not cut a picture into slivers to save a tile', () => {
    // 29 is the fewest 9.4 MP tiles that cover 16384 x 16384, and prime.
    const order = tileGrids(16384, 16384).map((g) => `${g.cols}x${g.rows}`)
    expect(order.indexOf('5x6')).toBeLessThan(order.indexOf('29x1'))
    expect(order.indexOf('5x6')).toBeLessThan(order.indexOf('1x29'))
  })

  it('prefers wider tiles when two shapes are equally square', () => {
    expect(tileGrids(4096, 4096)[1]).toEqual({ cols: 1, rows: 2 })
  })

  it('never offers a tile narrower than a macroblock', () => {
    expect(tileGrids(64, 32).every((g) => 64 / g.cols >= 16 && 32 / g.rows >= 16)).toBe(true)
  })
})

describe('planLoop', () => {
  const g = globalThis as Record<string, unknown>
  const timing = { frames: 300, fpsNum: 30, fpsDen: 1, seconds: 10 }
  const asked: { width: number; height: number; bitrate: number }[] = []
  /** Measured in Chrome 152 on a Mac: H.264 up to 4096 x 2304 of area, whatever the shape. */
  function chrome152(maxArea = 4096 * 2304) {
    g.VideoFrame = class {}
    g.VideoEncoder = {
      isConfigSupported: async (c: VideoEncoderConfig) => {
        asked.push({ width: c.width, height: c.height, bitrate: c.bitrate ?? 0 })
        return { supported: c.width * c.height <= maxArea, config: c }
      },
    }
  }
  afterEach(() => {
    delete g.VideoEncoder
    delete g.VideoFrame
    asked.length = 0
  })

  it('keeps a raster the encoder takes whole as one file, at the bitrate asked for', async () => {
    chrome152()
    const plan = await planLoop(3840, 2160, timing, 50e6)
    expect(plan.tiles).toEqual([{ col: 0, row: 0, x: 0, y: 0, width: 3840, height: 2160, bitrate: 50e6 }])
    expect(await planLoop(4096, 2304, timing, 0)).toMatchObject({ cols: 1, rows: 1 })
    expect(await planLoop(8192, 1080, timing, 0)).toMatchObject({ cols: 1, rows: 1 })
  })

  it.each([
    [7680, 4320, 2, 2, 3840, 2160],
    [8192, 2160, 2, 1, 4096, 2160],
    [15360, 2160, 4, 1, 3840, 2160],
    [2160, 7680, 1, 2, 2160, 3840],
    [4096, 2306, 2, 1, 2048, 2306],
  ])('cuts %ix%i into %ix%i tiles of %ix%i', async (w, h, cols, rows, tw, th) => {
    chrome152()
    const plan = await planLoop(w, h, timing, 0)
    expect([plan.cols, plan.rows]).toEqual([cols, rows])
    expect([plan.tiles[0]!.width, plan.tiles[0]!.height]).toEqual([tw, th])
  })

  it('cuts the largest canvas into 5 x 6, not 29 slivers', async () => {
    chrome152()
    // One second: at ten, thirty tiles of auto bitrate are 2.6 GB.
    const plan = await planLoop(16384, 16384, { frames: 30, fpsNum: 30, fpsDen: 1, seconds: 1 }, 0)
    expect([plan.cols, plan.rows]).toEqual([5, 6])
    expect(plan.tiles.every((t) => t.width * t.height <= 4096 * 2304)).toBe(true)
  })

  it('shares a bitrate set by hand across the tiles by area, so the set comes to what was asked', async () => {
    chrome152()
    const plan = await planLoop(7680, 4320, timing, 80e6)
    expect(plan.tiles.map((t) => t.bitrate)).toEqual([20e6, 20e6, 20e6, 20e6])
  })

  it('leaves an automatic bitrate automatic, sized for each tile', async () => {
    chrome152()
    const plan = await planLoop(7680, 4320, timing, 0)
    expect(plan.tiles.every((t) => t.bitrate === 0)).toBe(true)
    expect(asked.at(-1)!.bitrate).toBe(autoBitrate(3840, 2160, 30))
  })

  it('asks once per tile size and moves on at the first refusal', async () => {
    chrome152()
    await planLoop(7680, 4320, timing, 0)
    const sizes = asked.map((a) => `${a.width}x${a.height}`)
    // 1x1, 2x1, 1x2, 3x1 are refused on all three profiles; 2x2 passes on
    // High, and its four identical tiles are one question.
    expect(sizes).toEqual([
      ...Array(3).fill('7680x4320'),
      ...Array(3).fill('3840x4320'),
      ...Array(3).fill('7680x2160'),
      ...Array(3).fill('2560x4320'),
      '3840x2160',
    ])
  })

  it('refuses before frame 0 when no grid fits', async () => {
    chrome152(0)
    await expect(planLoop(1920, 1080, timing, 0)).rejects.toThrow(/will not take 1920x1080, whole or cut into as many as 64 tiles/)
  })

  it('refuses a set of tiles too big for the tab, all of them counted', async () => {
    chrome152()
    const long = { frames: 18000, fpsNum: 30, fpsDen: 1, seconds: 600 }
    await expect(planLoop(7680, 4320, long, 0)).rejects.toThrow(/GB across 4 tiles/)
  })

  it('still refuses an odd raster and a browser with no encoder', async () => {
    await expect(planLoop(1920, 1080, timing, 0)).rejects.toThrow(/no video encoder/)
    chrome152()
    await expect(planLoop(1920, 1081, timing, 0)).rejects.toThrow(/even width and height/)
  })
})
