/**
 * Colour handling for the video test patterns.
 *
 * WHY THIS EXISTS
 * ===============
 * SMPTE bars are defined in Y'CbCr, not RGB. A PNG is RGB. Converting between
 * them requires picking a matrix and a range, and getting either wrong produces
 * a pattern that looks right and measures wrong.
 *
 * Two mistakes are easy and both were observed while building this:
 *
 *  1. WRONG MATRIX. HD material is Rec.709. Running `ffmpeg -f lavfi -i
 *     smptehdbars -pix_fmt rgb24` converts with BT.601 and renders 75% yellow as
 *     (189, 202, 7) instead of (191, 191, 0). It looks like bars. It is not bars.
 *  2. WRONG RANGE. Y' 16..235 is studio swing. Writing those code values
 *     straight into a full-range PNG makes black grey and white dull; expanding
 *     them when the chain expects studio swing clips the pluge and the top of
 *     the ramp.
 *
 * So: patterns are authored in 8-bit Y'CbCr (the values the standard specifies),
 * and this module converts to RGB with the Rec.709 matrix and an explicit,
 * user-chosen output range. See docs/rp219.md for the measurement that pinned
 * the source values.
 */

import type { LevelRange } from '../types'

/** 8-bit Y'CbCr, studio swing: Y' 16..235, Cb/Cr 16..240 centred on 128. */
export type Ycbcr = { y: number; cb: number; cr: number }

export type Rgb = { r: number; g: number; b: number }

/**
 * Rec.709 (ITU-R BT.709) luma coefficients. The derived Pb/Pr scale factors
 * below follow from them:
 *   Kr = 0.2126, Kb = 0.0722
 *   R = Y + 2(1-Kr)·Pr            -> 1.5748
 *   B = Y + 2(1-Kb)·Pb            -> 1.8556
 *   G = Y - (2Kr(1-Kr)/Kg)·Pr - (2Kb(1-Kb)/Kg)·Pb   -> 0.4681, 0.1873
 */
export const KR = 0.2126
export const KB = 0.0722
export const KG = 1 - KR - KB // 0.7152

const R_PR = 1.5748
const B_PB = 1.8556
const G_PR = 0.4681
const G_PB = 0.1873

/** Studio-swing anchors. */
export const LUMA_BLACK = 16
export const LUMA_WHITE = 235
export const LUMA_SPAN = LUMA_WHITE - LUMA_BLACK // 219
export const CHROMA_SPAN = 224

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

/**
 * Y'CbCr (8-bit studio swing, Rec.709) to normalised linear-code R'G'B' in 0..1.
 * "Normalised" here means 0 = reference black, 1 = reference white; it is still
 * gamma-encoded, which is what a PNG wants.
 */
export function ycbcrToUnit(c: Ycbcr): { r: number; g: number; b: number } {
  const y = (c.y - LUMA_BLACK) / LUMA_SPAN
  const pb = (c.cb - 128) / CHROMA_SPAN
  const pr = (c.cr - 128) / CHROMA_SPAN
  return {
    r: y + R_PR * pr,
    g: y - G_PB * pb - G_PR * pr,
    b: y + B_PB * pb,
  }
}

/**
 * Map a normalised 0..1 value onto 8-bit codes for the chosen output range.
 *
 * Values outside 0..1 are clamped. That matters for the pluge: -2% black is
 * below reference black by design, so in `full` range it clamps to 0 and the
 * first pluge bar becomes invisible. That is not a bug in the conversion, it is
 * what "full range" means — and it is exactly why the pluge is only meaningful
 * on a `legal` export. The UI warns about this rather than silently hiding it.
 */
export function unitToCode(v: number, range: LevelRange): number {
  if (range === 'legal') {
    // Studio swing keeps headroom and footroom, so do NOT clamp to 0..1 first —
    // sub-black and super-white are representable and are the entire point.
    const code = LUMA_BLACK + v * LUMA_SPAN
    return Math.round(Math.min(255, Math.max(0, code)))
  }
  return Math.round(clamp01(v) * 255)
}

export function ycbcrToRgb(c: Ycbcr, range: LevelRange): Rgb {
  const u = ycbcrToUnit(c)
  return {
    r: unitToCode(u.r, range),
    g: unitToCode(u.g, range),
    b: unitToCode(u.b, range),
  }
}

/**
 * Normalised gamma-encoded R'G'B' (0..1) to 8-bit studio-swing Y'CbCr, Rec.709.
 * The inverse of `ycbcrToUnit`, and the way the bar colours are defined: stating
 * "75% yellow" as R'G'B' (0.75, 0.75, 0) and converting is self-evidently right,
 * where a tabulated (168, 44, 136) is three numbers nobody can check by eye.
 */
export function rgbToYcbcr(r: number, g: number, b: number): Ycbcr {
  const y = KR * r + KG * g + KB * b
  return {
    y: LUMA_BLACK + y * LUMA_SPAN,
    cb: 128 + (CHROMA_SPAN * (b - y)) / (2 * (1 - KB)),
    cr: 128 + (CHROMA_SPAN * (r - y)) / (2 * (1 - KR)),
  }
}

export function rgbToCss(c: Rgb): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`
}

export function ycbcrToCss(c: Ycbcr, range: LevelRange): string {
  return rgbToCss(ycbcrToRgb(c, range))
}

/**
 * A neutral grey at a given percentage of the reference black-to-white span.
 * 0% = reference black, 100% = reference white.
 */
export function greyPct(pct: number): Ycbcr {
  return { y: LUMA_BLACK + (pct / 100) * LUMA_SPAN, cb: 128, cr: 128 }
}

/** A neutral grey as a CSS colour for the chosen range. */
export function greyCss(pct: number, range: LevelRange): string {
  return ycbcrToCss(greyPct(pct), range)
}

/**
 * Saturated primaries/secondaries at a given amplitude, computed rather than
 * tabulated so 100% and 75% versions cannot drift apart.
 */
export function barColour(
  r: number,
  g: number,
  b: number,
  amplitudePct: number,
  range: LevelRange,
): string {
  const a = amplitudePct / 100
  return rgbToCss({
    r: unitToCode(r * a, range),
    g: unitToCode(g * a, range),
    b: unitToCode(b * a, range),
  })
}
