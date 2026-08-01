/**
 * SMPTE RP 219 colour bars — layout and colours.
 *
 * PROVENANCE
 * ==========
 * The geometry here was MEASURED, not taken from documentation. ffmpeg's
 * `smptehdbars` source was rendered at 1920x1080, 3840x2160, 1280x720 and
 * 2048x1080 and the resulting rasters were run-length analysed to recover the
 * exact band boundaries and Y'CbCr code values. All four agreed on the same
 * fractions, including the non-16:9 DCI size, so the model below is a real
 * proportional model rather than a 1920-specific coincidence.
 *
 * The reproduction script is `scripts/extract-rp219-reference.py` and the
 * measured result is committed at `test/fixtures/rp219-ffmpeg.json`, which
 * `rp219.test.ts` asserts against. See docs/rp219.md for the full workings.
 *
 * THE MODEL
 * =========
 * Rows, as fractions of the raster height:   7/12, 1/12, 1/12, 3/12
 * Columns, as fractions of the raster width: a = 1/8   (the two side blocks)
 *                                            b = 3/28  (one colour bar)
 * These close exactly: 2a + 7b = 1/4 + 3/4 = 1.
 *
 *   Row A (7/12)  40% grey | 75% white, yellow, cyan, green, magenta, red, blue | 40% grey
 *   Row B (1/12)  100% cyan | +I | 75% white (6b) | 100% blue
 *   Row C (1/12)  100% yellow | +Q | luma ramp (6b) | 100% red
 *   Row D (3/12)  15% grey | black (3b/2) | 100% white (2b) | black (5b/6)
 *                 | pluge -2%, 0%, +2%, 0%, +4% (b/3 each) | black (b) | 15% grey
 *
 * ONE DELIBERATE DEVIATION FROM ffmpeg
 * ====================================
 * ffmpeg rounds each colour bar UP and dumps the accumulated remainder into the
 * final column, so its right-hand grey block comes out up to 7px narrower than
 * its left-hand one (at 1280x720: 154px against 160px). This module instead
 * rounds each cumulative boundary to nearest, which keeps the two grey blocks
 * equal and every boundary within half a pixel of nominal. An asymmetric test
 * pattern is a defect, so matching ffmpeg exactly here would be the wrong call.
 * The conformance test allows interior boundaries to differ from ffmpeg by up
 * to 8px for this reason, while requiring the row boundaries to match exactly.
 */

import type { Ycbcr } from '../lib/colour'
import { greyPct, rgbToYcbcr } from '../lib/colour'

export type BandFill =
  | { kind: 'flat'; colour: Ycbcr }
  /** Horizontal luma ramp, reference black at the left to reference white at the right. */
  | { kind: 'ramp' }

export type Band = {
  /** 'A' | 'B' | 'C' | 'D' — which of the four rows this band sits in. */
  row: string
  /** Human name, used by the tests and by the region legend. */
  name: string
  x: number
  y: number
  width: number
  height: number
  fill: BandFill
}

/**
 * The bar colours.
 *
 * Everything except +I and +Q is COMPUTED from its R'G'B' definition through the
 * Rec.709 matrix, not tabulated. "75% yellow is (0.75, 0.75, 0)" is a statement
 * anyone can check; "75% yellow is Y=168 Cb=44 Cr=136" is three numbers you have
 * to take on faith. The computed values were verified to land exactly on the
 * measured ffmpeg ones — all 15 of them, to the code value — and `rp219.test.ts`
 * keeps them there.
 *
 * +I and +Q are the NTSC I/Q-axis chroma reference signals. They are not a
 * primary or secondary colour and cannot be derived from an R'G'B' triple, so
 * they are the one pair carried as measured constants.
 */
function bar(r: number, g: number, b: number, pct = 100): Ycbcr {
  const a = pct / 100
  return rgbToYcbcr(r * a, g * a, b * a)
}

const C = {
  grey40: greyPct(40), // measured Y=104
  grey15: greyPct(15), // measured Y=49
  black0: greyPct(0), // measured Y=16
  white100: greyPct(100), // measured Y=235
  white75: greyPct(75), // measured Y=180

  yellow75: bar(1, 1, 0, 75), // measured 168, 44, 136
  cyan75: bar(0, 1, 1, 75), // measured 145, 147, 44
  green75: bar(0, 1, 0, 75), // measured 133, 63, 52
  magenta75: bar(1, 0, 1, 75), // measured 63, 193, 204
  red75: bar(1, 0, 0, 75), // measured 51, 109, 212
  blue75: bar(0, 0, 1, 75), // measured 28, 212, 120

  cyan100: bar(0, 1, 1), // measured 188, 154, 16
  blue100: bar(0, 0, 1), // measured 32, 240, 118
  yellow100: bar(1, 1, 0), // measured 219, 16, 138
  red100: bar(1, 0, 0), // measured 63, 102, 240
  green100: bar(0, 1, 0),
  magenta100: bar(1, 0, 1),

  /** The +I and +Q chroma reference signals. Not derivable — measured. */
  plusI: { y: 57, cb: 156, cr: 97 },
  plusQ: { y: 44, cb: 171, cr: 147 },

  plugeMinus2: greyPct(-2), // measured Y=12
  plugePlus2: greyPct(2), // measured Y=20
  plugePlus4: greyPct(4), // measured Y=25
} satisfies Record<string, Ycbcr>

/** Column width in fractions of the raster width. */
const A = 1 / 8
const B = 3 / 28

type ColSpec = { name: string; w: number; fill: BandFill }

function flat(name: string, w: number, colour: Ycbcr): ColSpec {
  return { name, w, fill: { kind: 'flat', colour } }
}

const ROW_A: ColSpec[] = [
  flat('40% grey', A, C.grey40),
  flat('75% white', B, C.white75),
  flat('75% yellow', B, C.yellow75),
  flat('75% cyan', B, C.cyan75),
  flat('75% green', B, C.green75),
  flat('75% magenta', B, C.magenta75),
  flat('75% red', B, C.red75),
  flat('75% blue', B, C.blue75),
  flat('40% grey', A, C.grey40),
]

const ROW_B: ColSpec[] = [
  flat('100% cyan', A, C.cyan100),
  flat('+I', B, C.plusI),
  flat('75% white', 6 * B, C.white75),
  flat('100% blue', A, C.blue100),
]

const ROW_C: ColSpec[] = [
  flat('100% yellow', A, C.yellow100),
  flat('+Q', B, C.plusQ),
  { name: 'luma ramp', w: 6 * B, fill: { kind: 'ramp' } },
  flat('100% red', A, C.red100),
]

const ROW_D: ColSpec[] = [
  flat('15% grey', A, C.grey15),
  flat('black', (3 * B) / 2, C.black0),
  flat('100% white', 2 * B, C.white100),
  flat('black', (5 * B) / 6, C.black0),
  flat('pluge -2%', B / 3, C.plugeMinus2),
  flat('pluge 0%', B / 3, C.black0),
  flat('pluge +2%', B / 3, C.plugePlus2),
  flat('pluge 0%', B / 3, C.black0),
  flat('pluge +4%', B / 3, C.plugePlus4),
  flat('black', B, C.black0),
  flat('15% grey', A, C.grey15),
]

const ROWS: { key: string; h: number; cols: ColSpec[] }[] = [
  { key: 'A', h: 7 / 12, cols: ROW_A },
  { key: 'B', h: 1 / 12, cols: ROW_B },
  { key: 'C', h: 1 / 12, cols: ROW_C },
  { key: 'D', h: 3 / 12, cols: ROW_D },
]

/**
 * Lay a list of proportional widths onto `total` pixels.
 *
 * Boundaries are accumulated in exact fractions and rounded once, so rounding
 * error never compounds: the segments always tile `total` with no gap and no
 * overlap, and every edge lands within half a pixel of nominal.
 */
export function layOut(weights: number[], total: number): { start: number; size: number }[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  const out: { start: number; size: number }[] = []
  let acc = 0
  let prev = 0
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i]!
    // The final boundary is pinned to `total` so the pattern always fills the
    // raster exactly, whatever the weights sum to.
    const edge = i === weights.length - 1 ? total : Math.round((acc / sum) * total)
    out.push({ start: prev, size: edge - prev })
    prev = edge
  }
  return out
}

/**
 * The full band list for an RP 219 pattern on a `width` x `height` raster.
 *
 * Any aspect ratio is accepted; the pattern is proportional, so on a very wide
 * or very tall raster it stretches rather than pillarboxing. That is the right
 * behaviour for a media-server output, where the raster IS the frame.
 */
export function rp219Layout(width: number, height: number): Band[] {
  const rows = layOut(
    ROWS.map((r) => r.h),
    height,
  )
  const bands: Band[] = []
  for (let i = 0; i < ROWS.length; i++) {
    const row = ROWS[i]!
    const geom = rows[i]!
    const cols = layOut(
      row.cols.map((c) => c.w),
      width,
    )
    for (let j = 0; j < row.cols.length; j++) {
      const col = row.cols[j]!
      const cg = cols[j]!
      bands.push({
        row: row.key,
        name: col.name,
        x: cg.start,
        y: geom.start,
        width: cg.size,
        height: geom.size,
        fill: col.fill,
      })
    }
  }
  return bands
}

/**
 * Simple 75% EBU-style bars: eight full-height bars, equal width.
 *
 * Not a standard in the RP 219 sense — it is the everyday "colour bars" people
 * mean when they are eyeballing a link, and it survives being squeezed onto a
 * narrow LED strip where RP 219's four rows would be unreadable.
 */
export function ebuBarsLayout(width: number, height: number, amplitudePct = 75): Band[] {
  const scale = amplitudePct / 100
  const at = (c: Ycbcr): Ycbcr => ({
    y: 16 + (c.y - 16) * scale,
    cb: 128 + (c.cb - 128) * scale,
    cr: 128 + (c.cr - 128) * scale,
  })
  const bars: { name: string; colour: Ycbcr }[] = [
    { name: 'white', colour: at(C.white100) },
    { name: 'yellow', colour: at(C.yellow100) },
    { name: 'cyan', colour: at(C.cyan100) },
    { name: 'green', colour: at(C.green100) },
    { name: 'magenta', colour: at(C.magenta100) },
    { name: 'red', colour: at(C.red100) },
    { name: 'blue', colour: at(C.blue100) },
    { name: 'black', colour: greyPct(0) },
  ]
  const cols = layOut(bars.map(() => 1), width)
  return bars.map((bar, i) => ({
    row: 'A',
    name: bar.name,
    x: cols[i]!.start,
    y: 0,
    width: cols[i]!.size,
    height,
    fill: { kind: 'flat' as const, colour: bar.colour },
  }))
}

export const RP219_COLOURS = C
