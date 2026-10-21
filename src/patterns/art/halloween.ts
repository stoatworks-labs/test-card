/**
 * Halloween artwork: jack-o'-lanterns, bats, witches on broomsticks, flying
 * vampires, zombies, skeletons, dead trees, gravestones, an iron fence and a
 * haunted house.
 *
 * The same rules as the rest of the art: pure functions that return Shapes,
 * and only `fillShapes` touches a canvas. Each function says which units it
 * works in. Most are in the scene's own pixels, y DOWN, built round an origin
 * the painter moves them to. The two walkers are in body heights, y UP, feet
 * on y = 0, like the dinosaurs, so a test can ask whether a zombie's feet are
 * on the ground.
 *
 * Everything that moves takes a phase 0..1 and is the same shape at 0 as at 1:
 * a wingbeat, a stride, a flap of a cape, a blink. The painters give each one
 * a whole number of cycles per loop.
 */

import type { PumpkinFace } from '../../types'
import { between, rng } from '../random'
import { capsule, cubic, ellipse, lerp, polar, rotate, spline, sub, tube, type Pt, type Shape } from './shapes'

const TAU = Math.PI * 2

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function centroid(pts: Pt[]): Pt {
  let x = 0
  let y = 0
  for (const p of pts) {
    x += p[0]
    y += p[1]
  }
  return [x / pts.length, y / pts.length]
}

function scaleAbout(pts: Pt[], kx: number, ky: number, about: Pt = centroid(pts)): Pt[] {
  return pts.map(([x, y]) => [about[0] + (x - about[0]) * kx, about[1] + (y - about[1]) * ky])
}

function mirrorPts(pts: Pt[]): Pt[] {
  return pts.map(([x, y]) => [-x, y])
}

/** Points in units of `k`, placed at nothing in particular: a shorthand for the drawings below. */
function scaled(list: [number, number][], k: number): Pt[] {
  return list.map(([u, v]) => [u * k, v * k])
}

// ---------------------------------------------------------------------------
// Jack-o'-lanterns
// ---------------------------------------------------------------------------

export const PUMPKIN_FACES: PumpkinFace[] = ['classic', 'fierce', 'happy', 'surprised', 'sly', 'goofy']

export const PUMPKIN_FACE_LABELS: Record<PumpkinFace, string> = {
  classic: 'Classic',
  fierce: 'Fierce',
  happy: 'Happy',
  surprised: 'Surprised',
  sly: 'Sly, with fangs',
  goofy: 'Goofy',
}

/**
 * A pumpkin one unit wide, centred on (0, 0), y down. The body runs from
 * y = -0.37 to 0.37 and the stem rises to about -0.52.
 *
 * `holes` are the carved openings, which the painter fills with candlelight.
 * `walls` are the same openings a little larger and lower: the cut flesh,
 * the thickness of the pumpkin seen through the hole.
 */
export type Hole = { pts: Pt[]; smooth: boolean }
export type Pumpkin = { body: Shape[]; walls: Hole[]; holes: Hole[] }

/** A carved opening with sharp corners, or a round one. */
const sharp = (pts: Pt[]): Hole => ({ pts, smooth: false })
const round = (pts: Pt[]): Hole => ({ pts, smooth: true })

/** Body extent, for the tests and the painter's sizing. */
export const PUMPKIN_TOP = -0.52
export const PUMPKIN_BOTTOM = 0.37

const RIBS = [
  { cx: -0.3, cy: 0.02, rx: 0.2, ry: 0.32, fill: '#a3420b' },
  { cx: 0.3, cy: 0.02, rx: 0.2, ry: 0.32, fill: '#a3420b' },
  { cx: -0.165, cy: 0.005, rx: 0.215, ry: 0.355, fill: '#c0540f' },
  { cx: 0.165, cy: 0.005, rx: 0.215, ry: 0.355, fill: '#c0540f' },
  { cx: 0, cy: 0, rx: 0.2, ry: 0.37, fill: '#d66717' },
]

function pumpkinBody(): Shape[] {
  const out: Shape[] = RIBS.map((r) => ({
    pts: ellipse(r.cx, r.cy, r.rx, r.ry, 0, 40),
    fill: r.fill,
    stroke: '#6a2805',
    strokeWidth: 0.012,
  }))
  out.push({ pts: ellipse(-0.07, -0.2, 0.05, 0.09, 0.3, 20), fill: '#f59a45', alpha: 0.3 })
  out.push({
    pts: [[-0.045, -0.33], [0.04, -0.335], [0.06, -0.42], [0.1, -0.5], [0.065, -0.52], [0.02, -0.455], [-0.03, -0.41]],
    fill: '#5d5a24',
  })
  out.push({ pts: ellipse(0.083, -0.507, 0.022, 0.012, 0.5, 12), fill: '#9a9450' })
  out.push({
    pts: [[-0.04, -0.35], [-0.1, -0.42], [-0.17, -0.41], [-0.16, -0.36], [-0.1, -0.33]],
    fill: '#3d7428',
  })
  out.push({
    pts: [[0.04, -0.36], [0.12, -0.4], [0.17, -0.36], [0.15, -0.31], [0.11, -0.33], [0.13, -0.36]],
    stroke: '#4a7326',
    strokeWidth: 0.014,
    closed: false,
  })
  return out
}

/** A mouth of interlocking zig-zag teeth, `n` a side, between two curves. */
function zigzagMouth(open: number): Pt[] {
  const n = 8
  const half = 0.3
  const c = (x: number) => Math.max(0, 1 - (x / half) ** 2)
  const tooth = (x: number) => 0.045 * Math.sqrt(c(x))
  const top: Pt[] = []
  const bottom: Pt[] = []
  for (let i = 0; i <= 2 * n; i++) {
    const x = -half + (2 * half * i) / (2 * n)
    top.push([x, 0.11 + 0.06 * c(x) + (i % 2 ? tooth(x) : 0)])
  }
  for (let i = 0; i < 2 * n; i++) {
    const x = half - (2 * half * (i + 0.5)) / (2 * n)
    bottom.push([x, 0.11 + (0.17 + 0.04 * open) * c(x) - (i % 2 ? tooth(x) : 0)])
  }
  return [...top, ...bottom]
}

/** A lens between two points, bulging `up` on one side and `down` on the other. */
function lens(a: Pt, b: Pt, up: number, down: number, n = 10): Pt[] {
  const d = sub(b, a)
  const l = Math.hypot(d[0], d[1]) || 1
  // The normal that points up the picture (y down, so negative y).
  let nrm: Pt = [-d[1] / l, d[0] / l]
  if (nrm[1] > 0) nrm = [-nrm[0], -nrm[1]]
  const out: Pt[] = []
  for (let k = 0; k <= n; k++) {
    const p = lerp(a, b, k / n)
    const s = Math.sin((Math.PI * k) / n)
    out.push([p[0] + nrm[0] * up * s, p[1] + nrm[1] * up * s])
  }
  for (let k = n - 1; k > 0; k--) {
    const p = lerp(a, b, k / n)
    const s = Math.sin((Math.PI * k) / n)
    out.push([p[0] - nrm[0] * down * s, p[1] - nrm[1] * down * s])
  }
  return out
}

/**
 * The carved features of each face. `e` is the expression, 0 at rest and 1 at
 * its height: a blink, a wink, a chomp, a squint, a gasp.
 */
const FACES: Record<PumpkinFace, (e: number) => Hole[]> = {
  classic: (e) => {
    const eye: Pt[] = [[-0.25, -0.02], [-0.155, -0.19], [-0.06, -0.02]]
    const mouth: Pt[] = [
      [-0.3, 0.07], [-0.12, 0.15], [-0.12, 0.22], [-0.04, 0.22], [-0.04, 0.16], [0.3, 0.07],
      [0.24, 0.17], [0.13, 0.25], [0.13, 0.19], [0.05, 0.19], [0.05, 0.27], [-0.1, 0.28], [-0.24, 0.18],
    ]
    return [
      sharp(eye),
      sharp(mirrorPts(eye)),
      sharp([[-0.045, 0.075], [0, 0.005], [0.045, 0.075]]),
      // The jaw drops from the top lip: it chomps.
      sharp(scaleAbout(mouth, 1, 1 + 0.3 * e, [0, 0.08])),
    ]
  },
  fierce: (e) => {
    const eye: Pt[] = [[-0.27, -0.14], [-0.05, -0.05], [-0.08, 0.0], [-0.2, 0.0], [-0.26, -0.06]]
    const squint = scaleAbout(eye, 1, 1 - 0.5 * e)
    return [sharp(squint), sharp(mirrorPts(squint)), sharp([[-0.035, 0.06], [0, 0.0], [0.035, 0.06]]), sharp(zigzagMouth(e))]
  },
  happy: (e) => {
    const eye = (x: number) => ellipse(x, -0.08, 0.07, 0.07 * (1 - 0.85 * e), 0, 20)
    const top: Pt[] = []
    const bottom: Pt[] = []
    for (let i = 0; i <= 12; i++) {
      const x = -0.27 + (0.54 * i) / 12
      const c = 1 - (x / 0.27) ** 2
      top.push([x, 0.09 + 0.09 * c])
      bottom.push([x, 0.09 + 0.2 * c])
    }
    return [round(eye(-0.15)), round(eye(0.15)), sharp([[-0.035, 0.05], [0, -0.005], [0.035, 0.05]]), round([...top, ...bottom.reverse()])]
  },
  surprised: (e) => {
    const g = 1 + 0.12 * e
    return [
      round(ellipse(-0.14, -0.09, 0.055 * g, 0.085 * g, 0, 20)),
      round(ellipse(0.14, -0.09, 0.055 * g, 0.085 * g, 0, 20)),
      sharp([[-0.025, 0.05], [0, 0.01], [0.025, 0.05]]),
      round(ellipse(0, 0.2, 0.075 * (1 + 0.25 * e), 0.095 * (1 + 0.3 * e), 0, 24)),
    ]
  },
  sly: (e) => {
    // Cat's eyes, outer corners up, narrowing to slits.
    const left = lens([-0.27, -0.12], [-0.07, -0.04], 0.055 * (1 - 0.7 * e), 0.04 * (1 - 0.7 * e))
    return [
      sharp(left),
      sharp(mirrorPts(left)),
      sharp([[-0.03, 0.06], [0, 0.02], [0.03, 0.06]]),
      sharp([
        [-0.26, 0.12], [-0.12, 0.17], [-0.09, 0.17], [-0.075, 0.24], [-0.06, 0.17], [0.06, 0.17],
        [0.075, 0.24], [0.09, 0.17], [0.2, 0.14], [0.28, 0.08],
        [0.22, 0.17], [0.1, 0.27], [0, 0.29], [-0.12, 0.27], [-0.22, 0.19],
      ]),
    ]
  },
  goofy: (e) => [
    // One big eye, which winks; one small one, which does not.
    round(ellipse(-0.15, -0.1, 0.09, 0.09 * (1 - 0.88 * e), 0, 22)),
    round(ellipse(0.16, -0.06, 0.045, 0.05, 0, 16)),
    round(ellipse(0, 0.04, 0.03, 0.03, 0, 12)),
    sharp([
      [-0.28, 0.1], [-0.02, 0.15], [-0.02, 0.21], [0.05, 0.21], [0.05, 0.15], [0.24, 0.12],
      [0.2, 0.2], [0.05, 0.29], [-0.15, 0.27], [-0.25, 0.18],
    ]),
  ],
}

export function pumpkin(face: PumpkinFace | null, expression = 0): Pumpkin {
  const body = pumpkinBody()
  if (!face) return { body, walls: [], holes: [] }
  const walls = FACES[face](clamp01(expression))
  const holes = walls.map((w) => ({ ...w, pts: scaleAbout(w.pts, 0.88, 0.8).map(([x, y]) => [x, y - 0.01] as Pt) }))
  return { body, walls, holes }
}

// ---------------------------------------------------------------------------
// Things that fly
// ---------------------------------------------------------------------------

/**
 * A bat, centred on (0, 0), y down, `span` wingtip to wingtip with the wings
 * level. `flap` 0..1 is one wingbeat.
 */
export function bat(span: number, flap: number, colour: string): Shape[] {
  const s = span / 2
  const lift = Math.sin(flap * TAU)
  const out: Shape[] = []
  for (const side of [-1, 1]) {
    const shoulder: Pt = [side * s * 0.06, -s * 0.06]
    const wrist: Pt = [side * s * 0.42, -s * 0.12 - lift * s * 0.3]
    const tip: Pt = [side * s, -s * 0.05 - lift * s * 0.62]
    const f2: Pt = [side * s * 0.78, s * 0.2 - lift * s * 0.42]
    const f3: Pt = [side * s * 0.5, s * 0.26 - lift * s * 0.22]
    const body: Pt = [side * s * 0.08, s * 0.16]
    // The scallops between the fingers: the membrane pulled in toward the wrist.
    const scallop = (a: Pt, b: Pt): Pt[] => [lerp(lerp(a, b, 0.33), wrist, 0.2), lerp(lerp(a, b, 0.67), wrist, 0.2)]
    out.push({
      pts: [shoulder, wrist, tip, ...scallop(tip, f2), f2, ...scallop(f2, f3), f3, ...scallop(f3, body), body],
      fill: colour,
      smooth: false,
    })
  }
  out.push({ pts: ellipse(0, s * 0.05, s * 0.1, s * 0.17, 0, 14), fill: colour })
  out.push({ pts: ellipse(0, -s * 0.1, s * 0.08, s * 0.075, 0, 12), fill: colour })
  for (const side of [-1, 1]) {
    out.push({ pts: [[side * s * 0.07, -s * 0.13], [side * s * 0.06, -s * 0.26], [side * s * 0.01, -s * 0.15]], fill: colour, smooth: false })
  }
  return out
}

/**
 * A witch on a broomstick, flying toward +x, y down, `length` the length of
 * the broom and its bristles together, centred on the broom. `flutter` 0..1
 * ripples the cloak, the hem, the hair and the hat. With `cat`, a cat rides
 * behind her.
 */
export function witch(length: number, flutter: number, cat: boolean, colour: string): Shape[] {
  const L = length
  const P = (u: number, v: number): Pt => [u * L, v * L]
  const wave = (k: number) => Math.sin(TAU * (flutter - k * 0.17))
  const out: Shape[] = []
  const add = (pts: Pt[], smooth = true) => out.push({ pts, fill: colour, smooth })

  // The cloak: a flag streaming back from her shoulders, rippling.
  add(scaled([
    [0.03, -0.31], [-0.1, -0.325 + 0.012 * wave(0)], [-0.24, -0.315 + 0.02 * wave(1)], [-0.38, -0.295 + 0.025 * wave(2)],
    [-0.52, -0.275 + 0.03 * wave(3)], [-0.45, -0.235 + 0.03 * wave(3)], [-0.36, -0.2 + 0.025 * wave(2)],
    [-0.24, -0.175 + 0.02 * wave(1)], [-0.12, -0.15 + 0.012 * wave(0)], [-0.04, -0.17],
  ], L))

  // The broom: a handle, a binding, and a full brush of bristles with a ragged end.
  add(capsule(P(-0.4, 0.0), P(0.55, -0.06), 0.012 * L, 0.009 * L, 6))
  const rustle = 0.01 * Math.sin(TAU * flutter * 2)
  const brush: Pt[] = [P(-0.38, -0.028), P(-0.6, -0.075 + rustle), P(-0.8, -0.13 + rustle * 1.6)]
  for (let k = 1; k < 8; k++) {
    const v = -0.13 + (0.24 * k) / 8
    brush.push(P(-0.8 + (k % 2 ? 0.035 : 0) - 0.02 * Math.sin(k * 1.7), v + rustle * 1.6))
  }
  brush.push(P(-0.8, 0.11 + rustle * 1.6), P(-0.6, 0.06 + rustle), P(-0.38, 0.024))
  add(brush, false)
  add(scaled([[-0.36, -0.033], [-0.4, -0.032], [-0.4, 0.03], [-0.36, 0.028]], L), false)

  // The dress, hanging either side of the broom and trailing back.
  add(scaled([
    [-0.13, -0.1], [0.0, -0.115], [0.07, -0.05], [0.1, 0.03], [0.03, 0.07 + 0.01 * wave(1)],
    [-0.07, 0.06 + 0.015 * wave(2)], [-0.17, 0.085 + 0.02 * wave(3)], [-0.25, 0.045 + 0.02 * wave(4)], [-0.2, -0.02],
  ], L))
  // Stockinged leg and a pointed boot.
  add(capsule(P(0.08, 0.02), P(0.065, 0.13), 0.022 * L, 0.017 * L, 8))
  add(scaled([[0.04, 0.12], [0.085, 0.115], [0.15, 0.135], [0.195, 0.115], [0.185, 0.15], [0.11, 0.165], [0.04, 0.16]], L), false)

  // Torso leaning into the wind, and an arm out to the broom.
  add(capsule(P(-0.07, -0.08), P(0.02, -0.27), 0.06 * L, 0.05 * L, 10))
  add(capsule(P(0.02, -0.26), P(0.14, -0.15), 0.026 * L, 0.022 * L, 8))
  add(capsule(P(0.14, -0.15), P(0.26, -0.065), 0.022 * L, 0.018 * L, 8))
  add(ellipse(0.27 * L, -0.06 * L, 0.024 * L, 0.02 * L, 0, 12))

  // Head, hair streaming back, the nose and the chin.
  add(ellipse(0.07 * L, -0.335 * L, 0.046 * L, 0.05 * L, 0, 18))
  add(scaled([[0.03, -0.375], [-0.05, -0.37], [-0.16, -0.35 + 0.015 * wave(1)], [-0.27, -0.31 + 0.025 * wave(2)], [-0.18, -0.3 + 0.02 * wave(3)], [-0.08, -0.3], [0.0, -0.315]], L))
  add(scaled([[0.105, -0.355], [0.175, -0.33], [0.11, -0.322]], L), false)
  add(scaled([[0.08, -0.305], [0.118, -0.283], [0.06, -0.293]], L), false)

  // The hat: a wide brim, and a tall cone whose tip bends back in the wind.
  add(ellipse(0.06 * L, -0.383 * L, 0.15 * L, 0.022 * L, -0.15, 24))
  const tip = 0.018 * wave(0)
  add(scaled([
    [-0.045, -0.385], [0.125, -0.41], [0.08, -0.5], [0.03, -0.585], [-0.04, -0.645],
    [-0.16, -0.665 + tip], [-0.075, -0.6], [-0.03, -0.53], [-0.035, -0.45],
  ], L), false)

  if (cat) {
    add(ellipse(-0.34 * L, -0.045 * L, 0.03 * L, 0.04 * L, 0, 14))
    add(ellipse(-0.315 * L, -0.1 * L, 0.024 * L, 0.022 * L, 0, 12))
    add(scaled([[-0.333, -0.114], [-0.33, -0.143], [-0.315, -0.12]], L), false)
    add(scaled([[-0.31, -0.12], [-0.297, -0.143], [-0.297, -0.11]], L), false)
    out.push({
      pts: scaled([[-0.365, -0.02], [-0.405, -0.05], [-0.41, -0.105 + 0.01 * wave(1)], [-0.385, -0.13 + 0.01 * wave(2)]], L),
      stroke: colour,
      strokeWidth: 0.011 * L,
      closed: false,
    })
  }
  return out
}

/** Where a witch's drawing reaches, in units of her broom: for culling off-screen witches. */
export const WITCH_EXTENT = { left: -0.84, right: 0.56, top: -0.69, bottom: 0.17 }

/**
 * A vampire in flight toward +x, y down, `length` head to heels, origin at
 * the hip. The cape spreads behind like a bat's wing, black outside and red
 * within. `flap` 0..1 is one beat of it.
 */
export function vampire(length: number, flap: number): Shape[] {
  const B = length
  const P = (u: number, v: number): Pt => [u * B, v * B]
  const lift = Math.sin(TAU * flap)
  const kick = 0.02 * Math.sin(TAU * flap)
  const suit = '#17111d'
  const trousers = '#100c14'
  const capeOut = '#0e0710'
  const lining = '#7d0d1c'
  const skin = '#d6dbe6'
  const out: Shape[] = []

  // The cape as a wing: leading edge up to a point, then fingers and scallops back to the body.
  const S = P(0.27, -0.06)
  const wrist = P(0.04, -0.3 - 0.13 * lift)
  const fingers = [P(-0.38, -0.2 - 0.11 * lift), P(-0.46, -0.03 - 0.04 * lift), P(-0.2, -0.0 - 0.02 * lift), P(0.04, 0.0)]
  // A curved leading edge, then the membrane bowing in toward the wrist between each pair of fingertips.
  const wing: Pt[] = cubic(S, P(0.26, -0.18 - 0.06 * lift), P(0.16, -0.27 - 0.11 * lift), wrist, 8)
  wing.push(...cubic(wrist, lerp(wrist, fingers[0]!, 0.35), lerp(wrist, fingers[0]!, 0.7), fingers[0]!, 5).slice(1))
  for (let i = 0; i + 1 < fingers.length; i++) {
    const a = fingers[i]!
    const b = fingers[i + 1]!
    const c = lerp(lerp(a, b, 0.5), wrist, 0.32)
    for (let k = 1; k <= 6; k++) {
      const t = k / 6
      wing.push([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]])
    }
  }
  wing.push(P(0.15, -0.02))
  out.push({ pts: wing, fill: capeOut, smooth: false })
  // The red lining shows nearest the body, edged in black.
  out.push({ pts: scaleAbout(wing, 0.78, 0.62, P(0.06, -0.02)), fill: lining, smooth: false })

  // Legs trailing behind.
  out.push({ pts: capsule(P(0.0, -0.02), P(-0.25, 0.0), 0.05 * B, 0.04 * B, 8), fill: trousers })
  out.push({ pts: capsule(P(-0.25, 0.0), P(-0.48, 0.03 + kick), 0.04 * B, 0.032 * B, 8), fill: trousers })
  out.push({ pts: ellipse(-0.5 * B, (0.035 + kick) * B, 0.045 * B, 0.022 * B, 0, 12), fill: '#050406' })
  out.push({ pts: capsule(P(0.0, 0.01), P(-0.24, 0.035), 0.05 * B, 0.04 * B, 8), fill: suit })
  out.push({ pts: capsule(P(-0.24, 0.035), P(-0.46, 0.065 - kick), 0.04 * B, 0.032 * B, 8), fill: suit })
  out.push({ pts: ellipse(-0.48 * B, (0.07 - kick) * B, 0.045 * B, 0.022 * B, 0, 12), fill: '#050406' })

  // Body, shirt front, and an arm reaching ahead.
  out.push({ pts: capsule(P(0.0, 0.0), P(0.28, -0.04), 0.07 * B, 0.072 * B, 10), fill: suit })
  out.push({ pts: scaled([[0.25, -0.03], [0.33, -0.05], [0.3, 0.0]], B), fill: '#e6e2e8', smooth: false })
  out.push({ pts: capsule(P(0.27, -0.02), P(0.42, 0.035), 0.03 * B, 0.026 * B, 8), fill: suit })
  out.push({ pts: capsule(P(0.42, 0.035), P(0.56, 0.005), 0.026 * B, 0.022 * B, 8), fill: suit })
  out.push({ pts: scaled([[0.56, -0.016], [0.66, -0.012], [0.635, 0.0], [0.665, 0.012], [0.6, 0.022]], B), fill: skin, smooth: false })

  // The high collar behind the head, then the head.
  out.push({ pts: scaled([[0.26, -0.05], [0.29, -0.17], [0.32, -0.08]], B), fill: capeOut, smooth: false })
  out.push({ pts: scaled([[0.275, -0.06], [0.29, -0.14], [0.31, -0.075]], B), fill: lining, smooth: false })
  out.push({ pts: ellipse(0.375 * B, -0.075 * B, 0.062 * B, 0.052 * B, -0.25, 18), fill: skin })
  out.push({ pts: scaled([[0.32, -0.1], [0.35, -0.13], [0.405, -0.128], [0.43, -0.105], [0.405, -0.1], [0.39, -0.085], [0.355, -0.08], [0.33, -0.06]], B), fill: '#0b090e' })
  out.push({ pts: ellipse(0.41 * B, -0.08 * B, 0.009 * B, 0.006 * B, 0, 8), fill: '#ff2b3a' })
  out.push({ pts: scaled([[0.418, -0.052], [0.424, -0.035], [0.43, -0.052]], B), fill: '#ffffff', smooth: false })
  return out
}

/** Where a vampire's drawing reaches, in units of their length. */
export const VAMPIRE_EXTENT = { left: -0.56, right: 0.67, top: -0.45, bottom: 0.1 }

// ---------------------------------------------------------------------------
// The walkers: one rig, two costumes
// ---------------------------------------------------------------------------

/** Thigh and shin, in body heights. Hip to ankle is their sum standing straight. */
const THIGH = 0.25
const SHIN = 0.24
/** Ankle height off the ground with the foot flat. */
const ANKLE = 0.03

export type WalkStyle = {
  /** How far each thigh swings forward and back, radians. */
  swing: number
  /** How much each knee bends as that leg swings through: [near, far]. */
  lift: [number, number]
  /** Forward lean of the torso, radians. */
  lean: number
  /** 'reach' holds both arms out ahead; 'swing' swings them against the legs. */
  arms: 'reach' | 'swing'
}

/** A shamble: one leg dragged nearly straight, a forward lean, arms out. */
export const ZOMBIE_WALK: WalkStyle = { swing: 0.3, lift: [0.65, 0.12], lean: 0.22, arms: 'reach' }
/** A jaunty strut, both knees well up, arms swinging. */
export const SKELETON_WALK: WalkStyle = { swing: 0.4, lift: [0.75, 0.75], lean: 0.05, arms: 'swing' }

/**
 * How far the body travels in one stride (one whole gait cycle), in body
 * heights: each foot sweeps 2 (thigh + shin) sin(swing) under the hip while it
 * is down, and each foot is down once per stride.
 */
export function strideOf(style: WalkStyle): number {
  return 4 * (THIGH + SHIN) * Math.sin(style.swing)
}

export type Limb = [Pt, Pt, Pt, Pt]

export type Pose = {
  hip: Pt
  shoulder: Pt
  neck: Pt
  head: Pt
  /** [hip, knee, ankle, toe] for the near leg, then the far one. */
  legs: [Limb, Limb]
  /** [shoulder, elbow, hand, hand] for the near arm, then the far one. */
  arms: [Limb, Limb]
}

/**
 * Where every joint is at `gait` 0..1 through a stride, in body heights, y up,
 * facing +x. The hip sits at whatever height puts the lower foot on the
 * ground, so nothing sinks and the body bobs as it walks.
 */
export function walkPose(gait: number, style: WalkStyle): Pose {
  const legAngles = [0, 1].map((i) => {
    const ph = TAU * (gait + i * 0.5)
    const a = style.swing * Math.sin(ph)
    // The knee bends while the leg swings through, which is when it moves forward.
    const b = a - style.lift[i]! * Math.max(0, Math.cos(ph)) ** 1.5
    return { a, b }
  })
  const reach = legAngles.map(({ a, b }) => THIGH * Math.cos(a) + SHIN * Math.cos(b))
  const hip: Pt = [0, Math.max(...reach) + ANKLE]
  const legs = legAngles.map(({ a, b }): Limb => {
    const knee: Pt = [hip[0] + Math.sin(a) * THIGH, hip[1] - Math.cos(a) * THIGH]
    const ankle: Pt = [knee[0] + Math.sin(b) * SHIN, knee[1] - Math.cos(b) * SHIN]
    const toe: Pt = [ankle[0] + 0.075, ankle[1] - 0.02]
    return [hip, knee, ankle, toe]
  }) as [Limb, Limb]

  const lean = style.lean + (style.arms === 'reach' ? 0.05 * Math.sin(TAU * 2 * gait) : 0)
  const shoulder: Pt = [hip[0] + Math.sin(lean) * 0.29, hip[1] + Math.cos(lean) * 0.29]
  const neck: Pt = [shoulder[0] + Math.sin(lean) * 0.05, shoulder[1] + Math.cos(lean) * 0.05]
  const loll = style.arms === 'reach' ? 0.012 * Math.sin(TAU * gait) : 0
  const head: Pt = [neck[0] + 0.03 + loll, neck[1] + 0.075]

  const arms = [0, 1].map((i): Limb => {
    const ph = TAU * (gait + i * 0.5)
    // Angles from hanging straight down, forward positive.
    const up = style.arms === 'reach' ? 1.35 + 0.07 * Math.sin(ph) + i * 0.08 : -0.4 * Math.sin(ph)
    const fore = style.arms === 'reach' ? up + 0.12 : up + 0.3
    const elbow: Pt = [shoulder[0] + Math.sin(up) * 0.15, shoulder[1] - Math.cos(up) * 0.15]
    const hand: Pt = [elbow[0] + Math.sin(fore) * 0.14, elbow[1] - Math.cos(fore) * 0.14]
    return [shoulder, elbow, hand, hand]
  }) as [Limb, Limb]

  return { hip, shoulder, neck, head, legs, arms }
}

const ZOMBIE_SHIRTS = ['#5f4f72', '#4f6a6e', '#6e5a3e', '#7a3e3e']
const ZOMBIE_TROUSERS = ['#33394a', '#3d3428', '#2f3a33']

function darker(hex: string, k = 0.72): string {
  const v = parseInt(hex.slice(1), 16)
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.round(x * k))
  return '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('')
}

/** A unit vector along a limb and the one at right angles to it, turned forward. */
function frame(from: Pt, to: Pt): { d: Pt; f: Pt } {
  const v = sub(to, from)
  const l = Math.hypot(v[0], v[1]) || 1
  const d: Pt = [v[0] / l, v[1] / l]
  return { d, f: [d[1], -d[0]] }
}

/**
 * A zombie, in body heights, y up, feet on the ground at y = 0, facing +x.
 * `look` picks the clothes.
 */
export function zombie(gait: number, look = 0): Shape[] {
  const p = walkPose(gait, ZOMBIE_WALK)
  const r = rng(look)
  const shirt = ZOMBIE_SHIRTS[Math.floor(r() * ZOMBIE_SHIRTS.length)]!
  const trousers = ZOMBIE_TROUSERS[Math.floor(r() * ZOMBIE_TROUSERS.length)]!
  const skin = '#8eac72'
  const out: Shape[] = []

  const leg = (l: Limb, far: boolean) => {
    const [hip, knee, ankle, toe] = l
    const t = far ? darker(trousers) : trousers
    const hem = lerp(knee, ankle, 0.72)
    out.push({ pts: capsule(hip, knee, 0.048, 0.04, 8), fill: t })
    out.push({ pts: capsule(knee, hem, 0.04, 0.036, 8), fill: t })
    out.push({ pts: capsule(hem, ankle, 0.024, 0.022, 6), fill: far ? darker(skin) : skin })
    out.push({ pts: capsule(ankle, toe, 0.026, 0.016, 6), fill: far ? '#1d1816' : '#2b2420' })
  }
  const arm = (a: Limb, far: boolean) => {
    const [shoulder, elbow, hand] = a
    out.push({ pts: capsule(shoulder, elbow, 0.036, 0.03, 8), fill: far ? darker(shirt) : shirt })
    out.push({ pts: capsule(elbow, hand, 0.026, 0.022, 8), fill: far ? darker(skin) : skin })
    // A hand hanging limp from the wrist.
    const { d } = frame(elbow, hand)
    const knuckle: Pt = [hand[0] + d[0] * 0.025, hand[1] + d[1] * 0.025]
    out.push({ pts: ellipse(knuckle[0], knuckle[1], 0.03, 0.02, Math.atan2(d[1], d[0]), 10), fill: far ? darker(skin) : skin })
    for (const k of [-1, 0, 1]) {
      const base: Pt = [knuckle[0] + d[0] * 0.02, knuckle[1] + d[1] * 0.02 + k * 0.008]
      out.push({ pts: capsule(base, [base[0] + 0.022, base[1] - 0.035], 0.008, 0.006, 4), fill: far ? darker(skin) : skin })
    }
  }

  arm(p.arms[1], true)
  leg(p.legs[1], true)

  // The shirt, in rags round the hips.
  const { d, f } = frame(p.hip, p.shoulder)
  const at = (base: Pt, along: number, across: number): Pt => [base[0] + d[0] * along + f[0] * across, base[1] + d[1] * along + f[1] * across]
  const hem: Pt[] = []
  for (let k = 0; k <= 6; k++) hem.push(at(p.hip, -0.06 + (k % 2 ? 0.035 : 0) - (k === 3 ? 0.015 : 0), 0.085 - (0.17 * k) / 6))
  out.push({ pts: [at(p.shoulder, 0.01, -0.07), at(p.shoulder, 0.01, 0.08), ...hem], fill: shirt, smooth: false })
  out.push({ pts: [at(p.hip, 0.12, 0.02), at(p.hip, 0.15, 0.06), at(p.hip, 0.08, 0.07)], fill: darker(shirt, 0.6), smooth: false })

  leg(p.legs[0], false)
  out.push({ pts: capsule(p.shoulder, p.neck, 0.03, 0.028, 6), fill: skin })

  // The head: lolling, sunken eye, a scar, a few tufts of hair.
  const h = p.head
  out.push({ pts: ellipse(h[0] - 0.012, h[1] + 0.002, 0.015, 0.022, 0, 8), fill: darker(skin) })
  out.push({ pts: ellipse(h[0], h[1], 0.068, 0.078, -0.15, 20), fill: skin })
  out.push({ pts: ellipse(h[0] + 0.035, h[1] + 0.012, 0.018, 0.014, 0, 10), fill: '#1d1a1e' })
  out.push({ pts: ellipse(h[0] + 0.038, h[1] + 0.012, 0.006, 0.006, 0, 6), fill: '#e8f0a0' })
  out.push({ pts: ellipse(h[0] + 0.04, h[1] - 0.045, 0.022, 0.012, 0.2, 10), fill: '#2a1a1a' })
  out.push({ pts: [[h[0] - 0.03, h[1] + 0.05], [h[0] + 0.03, h[1] + 0.035]], stroke: '#3d4a32', strokeWidth: 0.006, closed: false })
  out.push({
    pts: [
      [h[0] - 0.06, h[1] + 0.04], [h[0] - 0.05, h[1] + 0.095], [h[0] - 0.03, h[1] + 0.07], [h[0] - 0.01, h[1] + 0.1],
      [h[0] + 0.01, h[1] + 0.075], [h[0] + 0.035, h[1] + 0.09], [h[0] + 0.03, h[1] + 0.06], [h[0] - 0.02, h[1] + 0.055],
    ],
    fill: '#2a2a22',
    smooth: false,
  })
  arm(p.arms[0], false)
  return out
}

/** A skeleton, in body heights, y up, feet on the ground at y = 0, facing +x. */
export function skeleton(gait: number): Shape[] {
  const p = walkPose(gait, SKELETON_WALK)
  const bone = '#ebe5d4'
  const far = '#b9b2a2'
  const dark = '#1a1714'
  const out: Shape[] = []
  const limb = (a: Pt, b: Pt, r: number, fill: string) => out.push({ pts: capsule(a, b, r, r * 0.85, 8), fill })
  const knob = (c: Pt, r: number, fill: string) => out.push({ pts: ellipse(c[0], c[1], r, r, 0, 10), fill })

  const leg = (l: Limb, fill: string) => {
    const [hip, knee, ankle, toe] = l
    limb(hip, knee, 0.017, fill)
    knob(knee, 0.024, fill)
    limb(knee, ankle, 0.015, fill)
    out.push({ pts: capsule(ankle, toe, 0.02, 0.012, 6), fill })
  }
  const arm = (a: Limb, fill: string) => {
    const [shoulder, elbow, hand] = a
    limb(shoulder, elbow, 0.014, fill)
    knob(elbow, 0.02, fill)
    limb(elbow, hand, 0.012, fill)
    out.push({ pts: ellipse(hand[0], hand[1], 0.022, 0.016, 0, 8), fill })
    const { d } = frame(elbow, hand)
    for (const k of [-1, 0, 1]) {
      const base: Pt = [hand[0] + d[0] * 0.015, hand[1] + d[1] * 0.015]
      out.push({ pts: [base, [base[0] + d[0] * 0.04 + k * 0.012, base[1] + d[1] * 0.04 - 0.01]], stroke: fill, strokeWidth: 0.007, closed: false })
    }
  }

  arm(p.arms[1], far)
  leg(p.legs[1], far)

  // Spine, pelvis, ribs, sternum, collarbone.
  const { d, f } = frame(p.hip, p.neck)
  const at = (base: Pt, along: number, across: number): Pt => [base[0] + d[0] * along + f[0] * across, base[1] + d[1] * along + f[1] * across]
  for (let k = 0; k <= 8; k++) {
    const c = lerp(p.hip, p.neck, k / 8)
    out.push({ pts: ellipse(c[0], c[1], 0.017, 0.012, Math.atan2(d[1], d[0]) + Math.PI / 2, 8), fill: bone })
  }
  out.push({ pts: ellipse(p.hip[0] + 0.005, p.hip[1] + 0.01, 0.06, 0.05, 0, 16), fill: bone })
  out.push({ pts: ellipse(p.hip[0] + 0.02, p.hip[1] + 0.005, 0.024, 0.018, 0, 10), fill: dark })
  for (let k = 0; k < 5; k++) {
    const s = lerp(p.shoulder, p.hip, 0.1 + k * 0.13)
    const reach = 0.12 - k * 0.008
    out.push({
      pts: [at(s, 0, -0.025), at(s, 0.012, 0.03), at(s, -0.005, reach * 0.8), at(s, -0.045 - k * 0.004, reach)],
      stroke: bone,
      strokeWidth: 0.016,
      closed: false,
    })
  }
  out.push({ pts: capsule(at(p.shoulder, -0.02, 0.11), at(p.shoulder, -0.16, 0.105), 0.01, 0.008, 6), fill: bone })
  out.push({ pts: capsule(at(p.shoulder, 0, -0.01), at(p.shoulder, 0.01, 0.075), 0.01, 0.009, 6), fill: bone })

  leg(p.legs[0], bone)

  // The skull, its jaw chattering twice a stride.
  const h = p.head
  const j = 0.008 + 0.01 * (1 + Math.sin(TAU * 2 * gait))
  const S = (u: number, v: number): Pt => [h[0] + u, h[1] + v]
  out.push({ pts: ellipse(h[0] - 0.005, h[1] + 0.012, 0.068, 0.066, 0, 22), fill: bone })
  out.push({ pts: [S(-0.02, -0.02), S(0.07, -0.015), S(0.072, -0.045), S(0.0, -0.05)], fill: bone })
  out.push({ pts: ellipse(h[0] + 0.032, h[1], 0.022, 0.02, 0, 10), fill: dark })
  out.push({ pts: [S(0.058, -0.012), S(0.068, -0.03), S(0.05, -0.03)], fill: dark, smooth: false })
  out.push({ pts: [S(0.02, -0.045), S(0.07, -0.045)], stroke: dark, strokeWidth: 0.005, closed: false })
  out.push({ pts: [S(-0.03, -0.04), S(-0.01, -0.045 - j), S(0.068, -0.05 - j), S(0.062, -0.075 - j), S(0.0, -0.08 - j)], fill: bone })
  out.push({ pts: [S(0.01, -0.052 - j), S(0.064, -0.055 - j)], stroke: dark, strokeWidth: 0.004, closed: false })

  arm(p.arms[0], bone)
  return out
}

// ---------------------------------------------------------------------------
// Scenery
// ---------------------------------------------------------------------------

/**
 * A dead tree, gnarled and leafless, base at (x, y), about `h` tall, y down.
 * `depth` is how many times it forks: 3 for a far silhouette, 5 up close.
 */
export function deadTree(x: number, y: number, h: number, seed: number, colour: string, depth = 4): Shape[] {
  const r = rng(seed)
  const out: Shape[] = []
  const tw = h * 0.05
  // Roots flaring into the ground.
  out.push({
    pts: [[x - tw * 2.6, y + 1], [x - tw * 0.9, y - h * 0.06], [x - tw * 0.6, y - h * 0.2], [x + tw * 0.6, y - h * 0.2], [x + tw * 0.9, y - h * 0.06], [x + tw * 2.4, y + 1]],
    fill: colour,
  })
  const branch = (from: Pt, angle: number, length: number, width: number, left: number) => {
    const bend = between(r, -0.35, 0.35)
    const wobble = between(r, -0.2, 0.2)
    const mid = polar(from, angle + bend * 0.5, length * 0.5)
    const end = polar(mid, angle - bend * 0.4 + wobble, length * 0.5)
    out.push({ pts: tube(spline([from, mid, end], 6), [width, width * 0.62]), fill: colour })
    if (left <= 0) return
    const kids = 2 + (r() < (left > 2 ? 0.4 : 0.6) ? 1 : 0)
    for (let k = 0; k < kids; k++) {
      const spread = between(r, 0.35, 0.8) * (k % 2 ? 1 : -1) + between(r, -0.1, 0.1)
      const turn = Math.max(-Math.PI - 0.25, Math.min(0.25, angle + spread))
      branch(end, turn, length * between(r, 0.6, 0.78), width * 0.62, left - 1)
    }
  }
  branch([x, y - h * 0.02], -Math.PI / 2 + between(r, -0.12, 0.12), h * 0.42, tw, depth)
  return out
}

export const STONE_KINDS = ['arch', 'cross', 'slab', 'obelisk'] as const
export type StoneKind = (typeof STONE_KINDS)[number]

/**
 * A gravestone, base centred on (0, 0), y down, `w` wide, leaning `tilt`
 * radians. `side` is the stone's thickness, drawn first in the darker colour.
 */
export function gravestone(w: number, kind: StoneKind, tilt: number, c: { stone: string; side: string }): Shape[] {
  let face: Pt[]
  const extra: Pt[][] = []
  if (kind === 'arch') {
    const top = -w * 0.8
    face = [[-w / 2, 0], [-w / 2, top]]
    for (let k = 1; k < 12; k++) face.push(polar([0, top], Math.PI + (k / 12) * Math.PI, w / 2))
    face.push([w / 2, top], [w / 2, 0])
  } else if (kind === 'cross') {
    face = [[-0.13 * w, 0], [-0.13 * w, -1.5 * w], [0.13 * w, -1.5 * w], [0.13 * w, 0]]
    extra.push([[-0.45 * w, -1.08 * w], [0.45 * w, -1.08 * w], [0.45 * w, -0.84 * w], [-0.45 * w, -0.84 * w]])
  } else if (kind === 'slab') {
    face = [[-0.45 * w, 0], [-0.45 * w, -0.95 * w], [-0.3 * w, -1.05 * w], [0, -1.12 * w], [0.3 * w, -1.05 * w], [0.45 * w, -0.95 * w], [0.45 * w, 0]]
  } else {
    face = [[-0.22 * w, -0.18 * w], [-0.16 * w, -1.9 * w], [0, -2.15 * w], [0.16 * w, -1.9 * w], [0.22 * w, -0.18 * w]]
    extra.push([[-0.32 * w, 0], [-0.32 * w, -0.18 * w], [0.32 * w, -0.18 * w], [0.32 * w, 0]])
  }
  const lean = (pts: Pt[]) => pts.map((p) => rotate(p, tilt))
  const thick = (pts: Pt[]) => pts.map(([x, y]) => [x + w * 0.09, y - w * 0.03] as Pt)
  const parts = [face, ...extra]
  return [
    ...parts.map((p) => ({ pts: lean(thick(p)), fill: c.side, smooth: false })),
    ...parts.map((p) => ({ pts: lean(p), fill: c.stone, smooth: false })),
  ]
}

/** Where "RIP" goes on a stone, as a height above its base in widths, or null if it has nowhere to go. */
export function stoneInscription(kind: StoneKind): number | null {
  if (kind === 'arch') return 0.62
  if (kind === 'slab') return 0.62
  return null
}

/**
 * An iron railing from x0 to x1 standing on y, `h` tall, y down: two rails and
 * a spear-topped post every `spacing`, the posts on a grid fixed to the world
 * so two outputs of a span agree on where they are.
 */
export function ironFence(x0: number, x1: number, y: number, h: number, spacing: number, colour: string): Shape[] {
  const out: Shape[] = []
  const bar = Math.max(1, h * 0.035)
  out.push({ pts: [[x0, y - h * 0.82], [x1, y - h * 0.82], [x1, y - h * 0.82 + bar], [x0, y - h * 0.82 + bar]], fill: colour, smooth: false })
  out.push({ pts: [[x0, y - h * 0.22], [x1, y - h * 0.22], [x1, y - h * 0.22 + bar], [x0, y - h * 0.22 + bar]], fill: colour, smooth: false })
  const pw = Math.max(1, spacing * 0.14)
  for (let k = Math.floor(x0 / spacing); k * spacing <= x1 + spacing; k++) {
    const x = k * spacing
    const big = ((k % 6) + 6) % 6 === 0
    const t = big ? h * 1.12 : h
    const wd = big ? pw * 1.8 : pw
    out.push({ pts: [[x - wd / 2, y], [x - wd / 2, y - t], [x + wd / 2, y - t], [x + wd / 2, y]], fill: colour, smooth: false })
    out.push({ pts: [[x - wd * 1.3, y - t], [x, y - t - wd * 3.2], [x + wd * 1.3, y - t]], fill: colour, smooth: false })
  }
  return out
}

/**
 * A sheet ghost, centred on (0, 0), y down, `size` tall. `drift` 0..1 ripples
 * its hem.
 */
export function ghost(size: number, drift: number): Shape[] {
  const s = size
  const pts: Pt[] = [[-0.3 * s, 0.4 * s]]
  for (let k = 0; k <= 10; k++) pts.push(polar([0, -0.15 * s], Math.PI + (k / 10) * Math.PI, 0.3 * s))
  for (let k = 0; k <= 6; k++) {
    const x = 0.3 * s - (k / 6) * 0.6 * s
    pts.push([x, 0.42 * s + (k % 2 ? -0.08 : 0.02) * s + 0.03 * s * Math.sin(TAU * (drift + k / 6))])
  }
  return [
    { pts, fill: '#eef0ff', alpha: 0.9 },
    { pts: ellipse(-0.1 * s, -0.12 * s, 0.05 * s, 0.07 * s, 0, 10), fill: '#14121c' },
    { pts: ellipse(0.1 * s, -0.12 * s, 0.05 * s, 0.07 * s, 0, 10), fill: '#14121c' },
    { pts: ellipse(0, 0.06 * s, 0.06 * s, 0.08 * s, 0, 10), fill: '#14121c' },
  ]
}

export type HouseWindow = {
  /** The glass, in scene pixels. */
  pane: Pt[]
  /** Centre and size of the pane, for the glow and anything seen through it. */
  cx: number
  cy: number
  w: number
  h: number
  state: 'lit' | 'dark' | 'boarded'
  /** Frame, glazing bars and boards, drawn over the glass. */
  over: Shape[]
}

export type HauntedHouse = {
  body: Shape[]
  windows: HouseWindow[]
  /** The tip of the tower's spire, where the bats circle. */
  spire: Pt
}

const HOUSE = { body: '#1f1729', roof: '#130e1b', trim: '#2f2540', bars: '#120c18', boards: '#3b2b20' }

/**
 * A haunted house, base centred on (x, y), `h` from the ground to the tip of
 * its spire, y down: a gabled main block, a lower wing, a tower with a
 * witch's-hat spire, a crooked chimney and a porch. Which windows are lit,
 * dark or boarded up comes from `seed`; at least three are always lit.
 */
export function hauntedHouse(x: number, y: number, h: number, seed: number): HauntedHouse {
  const r = rng(seed)
  const P = (u: number, v: number): Pt => [x + u * h, y + v * h]
  const poly = (list: [number, number][]) => list.map(([u, v]) => P(u, v))
  const rect = (u0: number, v0: number, u1: number, v1: number) => poly([[u0, v0], [u1, v0], [u1, v1], [u0, v1]])
  const body: Shape[] = []
  const add = (pts: Pt[], fill: string, smooth = false) => body.push({ pts, fill, smooth })

  add(rect(-0.62, 0, -0.36, -0.3), HOUSE.body)
  add(poly([[-0.66, -0.29], [-0.53, -0.45], [-0.36, -0.4], [-0.36, -0.29]]), HOUSE.roof)
  add(poly([[-0.29, -0.52], [-0.3, -0.68], [-0.22, -0.69], [-0.22, -0.6]]), HOUSE.roof)
  add(poly([[-0.315, -0.68], [-0.205, -0.7], [-0.205, -0.72], [-0.315, -0.7]]), HOUSE.roof)
  add(rect(-0.37, 0, 0.19, -0.43), HOUSE.body)
  // Siding: faint boards across the main block.
  for (let v = -0.04; v > -0.42; v -= 0.035) body.push({ pts: rect(-0.37, v, 0.19, v - 0.004), fill: HOUSE.trim, alpha: 0.35, smooth: false })
  add(poly([[-0.42, -0.42], [-0.09, -0.7], [0.24, -0.42]]), HOUSE.roof)
  body.push({ pts: poly([[-0.42, -0.42], [-0.09, -0.7], [0.24, -0.42]]), stroke: HOUSE.trim, strokeWidth: h * 0.008, closed: false })
  add(rect(0.17, 0, 0.39, -0.66), HOUSE.body)
  add(rect(0.165, -0.64, 0.395, -0.66), HOUSE.trim)
  add(poly([[0.13, -0.65], [0.2, -0.7], [0.26, -0.9], [0.28, -1.0], [0.3, -0.9], [0.36, -0.7], [0.43, -0.65]]), HOUSE.roof)
  body.push({ pts: poly([[0.28, -1.0], [0.28, -1.07]]), stroke: HOUSE.roof, strokeWidth: h * 0.006, closed: false })
  body.push({ pts: poly([[0.24, -1.06], [0.32, -1.055]]), stroke: HOUSE.roof, strokeWidth: h * 0.005, closed: false })
  add(poly([[0.32, -1.065], [0.345, -1.055], [0.32, -1.045]]), HOUSE.roof)
  // The porch: roof, floor, columns and steps.
  add(poly([[-0.27, -0.15], [0.12, -0.15], [0.09, -0.19], [-0.24, -0.19]]), HOUSE.roof)
  add(rect(-0.27, 0, 0.12, -0.025), HOUSE.trim)
  for (const u of [-0.24, -0.1, 0.04, 0.1]) add(rect(u, -0.025, u + 0.012, -0.15), HOUSE.trim)
  add(rect(-0.12, 0, -0.02, -0.012), HOUSE.trim)
  // A shutter hanging off its hinge.
  add(poly([[-0.215, -0.37], [-0.18, -0.372], [-0.165, -0.275], [-0.2, -0.27]]), HOUSE.roof)

  type Spec = { u: number; v: number; w: number; h: number; round?: boolean }
  const specs: Spec[] = [
    { u: -0.31, v: -0.37, w: 0.07, h: 0.1 },
    { u: -0.125, v: -0.37, w: 0.07, h: 0.1 },
    { u: 0.05, v: -0.37, w: 0.07, h: 0.1 },
    { u: -0.125, v: -0.565, w: 0.07, h: 0.07, round: true },
    { u: -0.345, v: -0.2, w: 0.065, h: 0.1 },
    { u: 0.245, v: -0.58, w: 0.07, h: 0.11 },
    { u: 0.245, v: -0.4, w: 0.07, h: 0.1 },
    { u: 0.245, v: -0.22, w: 0.07, h: 0.1 },
    { u: -0.56, v: -0.24, w: 0.08, h: 0.1 },
    { u: -0.46, v: -0.24, w: 0.06, h: 0.1 },
    // The front door, just ajar.
    { u: -0.11, v: -0.13, w: 0.08, h: 0.105 },
  ]
  // Every random number is drawn before any is used to skip something.
  const rolls = specs.map(() => r())
  const lit = new Set(rolls.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]).slice(0, 3).map(([, i]) => i))
  const windows: HouseWindow[] = specs.map((s, i) => {
    const door = i === specs.length - 1
    const state: HouseWindow['state'] = door ? 'lit' : lit.has(i) || rolls[i]! < 0.45 ? 'lit' : rolls[i]! > 0.85 ? 'boarded' : 'dark'
    const cu = s.u + s.w / 2
    const cv = s.v + s.h / 2
    const pane = s.round ? ellipse(x + cu * h, y + cv * h, (s.w / 2) * h, (s.h / 2) * h, 0, 20) : rect(s.u, s.v, s.u + s.w, s.v + s.h)
    const over: Shape[] = []
    const t = 0.006
    if (door) {
      // A dark door with only a sliver of light down its edge.
      over.push({ pts: rect(s.u, s.v, s.u + s.w * 0.82, s.v + s.h), fill: '#0a070d', smooth: false })
    } else if (s.round) {
      over.push({ pts: ellipse(x + cu * h, y + cv * h, (s.w / 2 + t) * h, (s.h / 2 + t) * h, 0, 20), stroke: HOUSE.trim, strokeWidth: t * h, closed: true })
      over.push({ pts: rect(cu - 0.002, s.v, cu + 0.002, s.v + s.h), fill: HOUSE.bars, smooth: false })
      over.push({ pts: rect(s.u, cv - 0.002, s.u + s.w, cv + 0.002), fill: HOUSE.bars, smooth: false })
    } else {
      over.push({ pts: rect(s.u - t, s.v - t, s.u + s.w + t, s.v), fill: HOUSE.trim, smooth: false })
      over.push({ pts: rect(s.u - t * 1.5, s.v + s.h, s.u + s.w + t * 1.5, s.v + s.h + t * 1.5), fill: HOUSE.trim, smooth: false })
      over.push({ pts: rect(cu - 0.002, s.v, cu + 0.002, s.v + s.h), fill: HOUSE.bars, smooth: false })
      over.push({ pts: rect(s.u, cv - 0.002, s.u + s.w, cv + 0.002), fill: HOUSE.bars, smooth: false })
    }
    if (state === 'boarded') {
      for (const a of [0.45, -0.4]) {
        const c: Pt = P(cu, cv)
        const plank = rect(cu - s.w * 0.65, cv - 0.008, cu + s.w * 0.65, cv + 0.008).map((p) => rotate(p, a, c))
        over.push({ pts: plank, fill: HOUSE.boards, smooth: false })
      }
    }
    return { pane, cx: x + cu * h, cy: y + cv * h, w: s.w * h, h: s.h * h, state, over }
  })
  return { body, windows, spire: P(0.28, -1.0) }
}

/** Width of the house, either side of its centre, in units of its height. */
export const HOUSE_HALF_WIDTH = 0.66
