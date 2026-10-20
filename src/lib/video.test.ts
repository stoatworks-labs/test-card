import { afterEach, describe, expect, it } from 'vitest'
import { autoBitrate, avcCodecs, avcLevel, estimateLoopBytes, MAX_LOOP_BYTES, rgbaToI420, videoProblem } from './video'
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
