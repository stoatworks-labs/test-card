/**
 * Banana for scale.
 *
 * Built in millimetres, y up, so the drawing IS the size: the painter only has
 * to convert millimetres to pixels with the output's pitch. A medium banana is
 * taken as 190 mm along its outer curve and 36 mm across — inside the 7 to
 * 7⅞ inch (178–200 mm) band commonly given for a "medium" one — and a
 * supermarket bunch as a hand of five. The tests hold the drawing to those
 * numbers, which is the entire joke: it has to actually be banana-sized.
 */

import { rng, between } from '../random'
import { ellipse, pathLength, tube, type Pt, type Shape } from './shapes'

export const BANANA_LENGTH_MM = 190
export const BANANA_DIAMETER_MM = 36
export const BUNCH_SIZE = 5

const YELLOW = '#f2cf3b'
const YELLOW_SHADE = '#d7a21c'
const YELLOW_LIGHT = '#fbe58e'
const STALK = '#8f9a35'
const STALK_DARK = '#5f6a22'
const TIP = '#4a3a20'
const SPOT = '#7a4e22'

/**
 * The centreline of one banana: an arc of fixed length that starts at `base`
 * heading `heading` (radians, y up) and turns through `turn` as it goes.
 */
export function bananaSpine(base: Pt, heading: number, turn: number, length = BANANA_LENGTH_MM, n = 48): Pt[] {
  const pts: Pt[] = [base]
  const step = length / n
  let a = heading
  let p = base
  for (let i = 0; i < n; i++) {
    // Midpoint heading, so the arc length is exact rather than a chord sum.
    const mid = a + turn / n / 2
    p = [p[0] + Math.cos(mid) * step, p[1] + Math.sin(mid) * step]
    pts.push(p)
    a += turn / n
  }
  return pts
}

/** Half-thickness along the banana, base to tip: a thin stalk, a fat middle, a blunt tip. */
const PROFILE = [3.5, 4.5, 9, 15, 17.5, 18, 17.5, 16, 13, 9, 6]

function oneBanana(spine: Pt[], seed: number, shade: number): Shape[] {
  const r = rng(seed)
  const n = spine.length
  const stalkEnd = Math.round(n * 0.13)
  const out: Shape[] = []

  const body = tube(spine, PROFILE, PROFILE.map((v) => v * 0.98))
  out.push({ pts: body, fill: shade < 0.5 ? YELLOW_SHADE : YELLOW })
  if (shade >= 0.5) {
    // Underside shade and an upper highlight, as offset bands along the curve.
    const under = tube(
      spine.slice(stalkEnd),
      PROFILE.slice(2).map((v) => -v * 0.25),
      PROFILE.slice(2).map((v) => v * 0.98),
    )
    out.push({ pts: under, fill: YELLOW_SHADE, alpha: 0.75 })
    const light = tube(
      spine.slice(stalkEnd + 2, n - 6),
      PROFILE.slice(2, -1).map((v) => v * 0.75),
      PROFILE.slice(2, -1).map((v) => -v * 0.35),
    )
    out.push({ pts: light, fill: YELLOW_LIGHT, alpha: 0.8 })
  }

  // The stalk end, greener, and the dark nub at the flower end.
  out.push({ pts: tube(spine.slice(0, stalkEnd + 3), [4, 4.5, 6, 8], [4, 4.5, 6, 8]), fill: STALK })
  const tipAt = spine[n - 1]!
  const before = spine[n - 3]!
  const ang = Math.atan2(tipAt[1] - before[1], tipAt[0] - before[0])
  out.push({ pts: ellipse(tipAt[0], tipAt[1], 4.5, 4, ang, 16), fill: TIP })

  // The ridge that runs along a banana's back.
  out.push({
    pts: tube(spine.slice(stalkEnd + 1, n - 3), [7.5], [6.5]).slice(0, n - stalkEnd - 4),
    stroke: YELLOW_SHADE,
    strokeWidth: 1.2,
    closed: false,
    alpha: 0.6,
  })

  // A few sugar spots. Ripe, not past it.
  const spots = 3 + Math.floor(r() * 5)
  for (let i = 0; i < spots; i++) {
    const at = spine[Math.floor(between(r, 0.3, 0.85) * n)]!
    out.push({
      pts: ellipse(at[0] + between(r, -6, 6), at[1] + between(r, -6, 6), between(r, 0.8, 2), between(r, 0.6, 1.5), r() * 3, 10),
      fill: SPOT,
      alpha: 0.7,
    })
  }
  return out
}

/**
 * A hand of five, crown at the origin, fanning to the right and curving up.
 * Drawn back to front, so the nearer bananas overlap the further ones.
 */
export function bananaBunch(seed = 1): Shape[] {
  const out: Shape[] = []
  const bananas: { base: Pt; heading: number; turn: number; shade: number }[] = []
  for (let i = 0; i < BUNCH_SIZE; i++) {
    const f = i / (BUNCH_SIZE - 1)
    bananas.push({
      base: [i * 3, -i * 9],
      heading: (6 - f * 38) * (Math.PI / 180),
      turn: (52 + f * 6) * (Math.PI / 180),
      shade: i % 2 === 0 ? 1 : 0.6,
    })
  }
  // Back row first: the odd ones sit behind.
  const order = [1, 3, 0, 2, 4]
  for (const i of order) {
    const b = bananas[i]!
    out.push(...oneBanana(bananaSpine(b.base, b.heading, b.turn), seed * 31 + i, b.shade))
  }
  // The crown, where the hand was cut from the stem.
  out.push({ pts: ellipse(2, -12, 13, 17, 0.3, 24), fill: STALK })
  out.push({ pts: ellipse(-3, -10, 7, 12, 0.3, 20), fill: STALK_DARK })
  return out
}

/** The arc length of a banana as drawn — what the tests hold to 190 mm. */
export function bananaLengthMm(): number {
  return pathLength(bananaSpine([0, 0], 0, Math.PI / 3))
}
