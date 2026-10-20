/**
 * Dinosaurs, at life size.
 *
 * Every animal is built in METRES, y up, standing on y = 0 and facing +x, so
 * the life-size pattern only has to turn metres into pixels with the output's
 * pitch. The sizes are the ones commonly quoted for each animal rather than a
 * claim about any one fossil, and the tests hold the drawings to them:
 * measured nose to tail along the centreline, and from the ground to the top.
 *
 * Each animal is a small rig rather than a fixed drawing — a spine with a
 * thickness either side, a head on the end of it, and legs posed by two-bone
 * IK onto a foot target — so the same Tyrannosaurus can stand still for the
 * life-size line-up and walk, with its feet planted, in the scrolling scene.
 *
 * All of it is original artwork, drawn in code for this project.
 */

import { BANANA_LENGTH_MM, bananaBunch } from './bananas'
import {
  add,
  capsule,
  ellipse,
  len,
  lerp,
  mapShapes,
  pathLength,
  polar,
  resample,
  rotate,
  spline,
  sub,
  tube,
  type Pt,
  type Shape,
} from './shapes'
import type { DinosaurId } from '../../types'

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

type SpinePoint = { at: Pt; up: number; down: number }

type LegDef = {
  /** Joint position relative to the hip joint, which is the body's origin. */
  root: Pt
  /** Bone lengths: upper, lower, and the foot bone (metatarsus / metacarpus). */
  bones: [number, number, number]
  /** Radius at root, knee, ankle and foot. */
  radii: [number, number, number, number]
  /** Toe length along the ground. */
  toe: number
  /** +1: the knee points forward (a hind leg). -1: the elbow points back. */
  bend: 1 | -1
  /** Angle of the foot bone from the ground, radians. ~1.2 for a bird-like foot, π/2 for a column. */
  footAngle: number
  /** Where the foot rests, x relative to the joint, when standing. */
  rest: number
  /** Gait phase offset, 0..1. */
  phase: number
  /** Extra thigh or shoulder muscle drawn over the upper bone. */
  muscle?: number
  /** Toe style. */
  foot: 'bird' | 'pad' | 'hoof'
}

export type Species = {
  id: DinosaurId
  name: string
  /** Nose to tail, metres, as commonly quoted. */
  lengthM: number
  /** Ground to the top of the animal, metres. */
  heightM: number
  /** Height of the hip joint above the ground. */
  hipM: number
  spine: SpinePoint[]
  legs: LegDef[]
  colours: { body: string; belly: string; dark: string; far: string; accent: string; eye: string }
  /** Head drawn on the end of the spine. Points in head space: origin at the neck, x forward. */
  head: (r: HeadCtx) => Shape[]
  /** Anything that is neither body, head nor leg: plates, frills, feathers, stripes. */
  extras?: (r: RigCtx) => { behind: Shape[]; front: Shape[] }
  /** Stride length per gait cycle, metres. */
  stride: number
  /** Fraction of the cycle a foot is on the ground. */
  duty: number
  /** Up-and-down per step, metres. */
  bob: number
  /** Turns the head from the line of the neck, radians; negative looks down. */
  headTilt?: number
  /** Arms that do not reach the ground (theropods). */
  arms?: { root: Pt; bones: [number, number]; radii: [number, number, number]; fingers: number }
}

type HeadCtx = { colours: Species['colours']; to: (p: Pt) => Pt; scale: number }

type RigCtx = {
  centre: Pt[]
  up: number[]
  down: number[]
  normals: Pt[]
  colours: Species['colours']
  phase: number
}

const SPINE_SAMPLES = 10

/** Two-bone IK: the middle joint, bending toward `bend`. */
function solve2(root: Pt, target: Pt, l1: number, l2: number, bend: 1 | -1): { mid: Pt; end: Pt } {
  const d = sub(target, root)
  const want = len(d)
  const dist = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, want))
  const a = Math.atan2(d[1], d[0])
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)))
  const mid = polar(root, a + bend * A, l1)
  const toTarget = Math.atan2(target[1] - mid[1], target[0] - mid[0])
  return { mid, end: polar(mid, toTarget, l2) }
}

/** Foot position along the ground in the body frame, and its lift, at gait phase p. */
function footTrack(p: number, duty: number, step: number): { dx: number; lift: number } {
  if (p < duty) {
    // Planted: the body moves forward over it, so it slides back at body speed.
    const f = p / duty
    return { dx: step / 2 - f * step, lift: 0 }
  }
  const f = (p - duty) / (1 - duty)
  const ease = f * f * (3 - 2 * f)
  return { dx: -step / 2 + ease * step, lift: Math.sin(f * Math.PI) }
}

function legShapes(
  leg: LegDef,
  hip: Pt,
  groundY: number,
  gaitPhase: number | null,
  sp: Species,
  stride: number,
  colour: string,
  dark: string,
): Shape[] {
  const root = add(hip, leg.root)
  const [l1, l2, l3] = leg.bones
  const [r0, r1, r2, r3] = leg.radii
  let footX = root[0] + leg.rest
  let lift = 0
  if (gaitPhase !== null) {
    const p = (gaitPhase + leg.phase) % 1
    const t = footTrack(p, sp.duty, stride * sp.duty)
    footX += t.dx
    lift = t.lift * Math.min(0.35, (l1 + l2) * 0.18)
  }
  const ball: Pt = [footX, groundY + r3 + lift]
  // The foot bone rises back from the ball of the foot to the ankle.
  const ankleTarget: Pt = [ball[0] - Math.cos(leg.footAngle) * l3 * leg.bend, ball[1] + Math.sin(leg.footAngle) * l3]
  const { mid, end } = solve2(root, ankleTarget, l1, l2, leg.bend)
  const ankle = end
  const ballActual: Pt = [ankle[0] + Math.cos(leg.footAngle) * l3 * leg.bend, ankle[1] - Math.sin(leg.footAngle) * l3]

  const out: Shape[] = []
  out.push({ pts: capsule(root, mid, r0, r1), fill: colour })
  if (leg.muscle) {
    const m = lerp(root, mid, 0.36)
    const ang = Math.atan2(mid[1] - root[1], mid[0] - root[0])
    out.push({ pts: ellipse(m[0], m[1], l1 * 0.6, leg.muscle * 0.72, ang, 32), fill: colour })
  }
  out.push({ pts: capsule(mid, ankle, r1, r2), fill: colour })
  out.push({ pts: capsule(ankle, ballActual, r2, r3), fill: colour })

  const g = groundY + lift
  if (leg.foot === 'bird') {
    // Three forward toes and a claw on each.
    const toe = leg.toe
    out.push({
      pts: [
        [ballActual[0] - r3 * 1.2, g + r3 * 1.6],
        [ballActual[0] + toe * 0.5, g + r3 * 0.9],
        [ballActual[0] + toe, g + r3 * 0.25],
        [ballActual[0] + toe * 1.05, g],
        [ballActual[0] - r3 * 0.6, g],
      ],
      fill: colour,
    })
    out.push({
      pts: [
        [ballActual[0] + toe * 0.95, g + r3 * 0.35],
        [ballActual[0] + toe * 1.22, g + r3 * 0.05],
        [ballActual[0] + toe * 1.0, g],
      ],
      fill: dark,
      smooth: false,
    })
  } else if (leg.foot === 'pad') {
    out.push({ pts: ellipse(ballActual[0] + r3 * 0.25, g + r3 * 0.55, r3 * 1.45, r3 * 0.6, 0, 24), fill: colour })
    for (let i = 0; i < 3; i++) {
      const x = ballActual[0] + r3 * (0.3 + i * 0.45)
      out.push({ pts: ellipse(x, g + r3 * 0.25, r3 * 0.22, r3 * 0.2, 0, 12), fill: dark, alpha: 0.6 })
    }
  } else {
    out.push({
      pts: [
        [ballActual[0] - r3 * 1.1, g + r3 * 1.3],
        [ballActual[0] + r3 * 1.5, g + r3 * 0.9],
        [ballActual[0] + r3 * 1.8, g],
        [ballActual[0] - r3 * 1.1, g],
      ],
      fill: colour,
    })
    out.push({ pts: ellipse(ballActual[0] + r3 * 1.45, g + r3 * 0.25, r3 * 0.35, r3 * 0.25, 0, 10), fill: dark, alpha: 0.7 })
  }
  return out
}

/**
 * The whole animal in metres, y up, feet on y = 0, facing +x.
 *
 * `gaitPhase` null is the standing pose; 0..1 is a point in the walk cycle.
 * `strideM` overrides the species' stride, so a scene can make the distance
 * walked per cycle match the ground scrolling under it exactly — otherwise
 * the planted foot slides.
 */
export function poseDinosaur(sp: Species, gaitPhase: number | null = null, strideM = sp.stride): Shape[] {
  const walking = gaitPhase !== null
  const bob = walking ? sp.bob * Math.cos(gaitPhase * Math.PI * 4) : 0
  const hip: Pt = [0, sp.hipM + bob]
  const sway = (i: number, n: number) =>
    walking ? Math.sin(gaitPhase * Math.PI * 2 + i * 0.5) * 0.04 * Math.max(0, 1 - (i / n) * 3) * sp.hipM : 0

  // The spine, through its control points, in world space.
  const ctrl = sp.spine.map((s, i) => add(hip, [s.at[0], s.at[1] + sway(i, sp.spine.length)]))
  const centre = spline(ctrl, SPINE_SAMPLES)
  const up = resample(sp.spine.map((s) => s.up), centre.length)
  const down = resample(sp.spine.map((s) => s.down), centre.length)
  const normals = centre.map((_, i) => {
    const a = centre[Math.max(0, i - 1)]!
    const b = centre[Math.min(centre.length - 1, i + 1)]!
    const d = sub(b, a)
    const l = len(d) || 1
    return [-d[1] / l, d[0] / l] as Pt
  })
  const rig: RigCtx = { centre, up, down, normals, colours: sp.colours, phase: gaitPhase ?? 0 }

  const near = sp.legs.filter((_, i) => i % 2 === 0)
  const far = sp.legs.filter((_, i) => i % 2 === 1)

  const out: Shape[] = []
  const extras = sp.extras?.(rig) ?? { behind: [], front: [] }
  out.push(...extras.behind)
  for (const leg of far) out.push(...legShapes(leg, hip, 0, gaitPhase, sp, strideM, sp.colours.far, sp.colours.dark))

  out.push({ pts: tube(centre, up, down), fill: sp.colours.body })
  // Countershading: a paler band along the underside.
  out.push({
    pts: tube(centre, down.map((v) => -v * 0.3), down.map((v) => v * 0.985)),
    fill: sp.colours.belly,
  })

  // The head, on the end of the spine and pointing the way it was going.
  const end = centre[centre.length - 1]!
  const before = centre[centre.length - 4]!
  const angle = Math.atan2(end[1] - before[1], end[0] - before[0]) + (sp.headTilt ?? 0)
  out.push(
    ...sp.head({
      colours: sp.colours,
      to: (p) => add(end, rotate(p, angle)),
      scale: 1,
    }),
  )

  out.push(...extras.front)
  if (sp.arms) out.push(...armShapes(sp, hip, gaitPhase))
  for (const leg of near) out.push(...legShapes(leg, hip, 0, gaitPhase, sp, strideM, sp.colours.body, sp.colours.dark))
  return out
}

function armShapes(sp: Species, hip: Pt, gaitPhase: number | null): Shape[] {
  const a = sp.arms!
  const root = add(hip, a.root)
  const swing = gaitPhase === null ? 0 : Math.sin(gaitPhase * Math.PI * 2) * 0.15
  const elbow = polar(root, -1.25 + swing, a.bones[0])
  const hand = polar(elbow, -0.35 + swing, a.bones[1])
  const out: Shape[] = [
    { pts: capsule(root, elbow, a.radii[0], a.radii[1]), fill: sp.colours.body },
    { pts: capsule(elbow, hand, a.radii[1], a.radii[2]), fill: sp.colours.body },
  ]
  for (let i = 0; i < a.fingers; i++) {
    const tip = polar(hand, -0.9 - i * 0.45, a.bones[1] * 0.35)
    out.push({ pts: capsule(hand, tip, a.radii[2] * 0.7, a.radii[2] * 0.25, 6), fill: sp.colours.dark })
  }
  return out
}

/** Back-edge stripes, kept inside the body by building them from the body's own edge. */
function stripes(r: RigCtx, from: number, to: number, count: number, depth: number, colour: string): Shape[] {
  const out: Shape[] = []
  const n = r.centre.length
  for (let k = 0; k < count; k++) {
    const i = Math.round(n * (from + ((to - from) * (k + 0.5)) / count))
    const j = Math.min(n - 1, i + 2)
    const edge = (q: number, f: number): Pt => add(r.centre[q]!, [r.normals[q]![0] * r.up[q]! * f, r.normals[q]![1] * r.up[q]! * f])
    out.push({
      pts: [edge(i, 0.99), edge(j, 0.99), edge(Math.round((i + j) / 2), 1 - depth)],
      fill: colour,
      alpha: 0.55,
    })
  }
  return out
}

function eye(at: Pt, r: number, c: HeadCtx): Shape[] {
  return [
    { pts: ellipse(...c.to(at), r * 1.25, r * 1.15, 0, 16), fill: '#f4ecd2' },
    { pts: ellipse(...c.to([at[0] + r * 0.2, at[1]]), r * 0.65, r * 0.75, 0, 14), fill: c.colours.eye },
    { pts: ellipse(...c.to([at[0] + r * 0.35, at[1] + r * 0.3]), r * 0.2, r * 0.2, 0, 8), fill: '#ffffff' },
  ]
}

const T = (c: HeadCtx, pts: Pt[]) => pts.map(c.to)

// ---------------------------------------------------------------------------
// The animals
// ---------------------------------------------------------------------------

const tyrannosaurus: Species = {
  id: 'tyrannosaurus',
  name: 'Tyrannosaurus',
  lengthM: 12.3,
  // To the top of the head, held level. Usually quoted as 3.7–4 m at the hips.
  heightM: 4.6,
  hipM: 3.25,
  spine: [
    { at: [-6.6, 0.0], up: 0.05, down: 0.05 },
    { at: [-5.1, 0.18], up: 0.24, down: 0.22 },
    { at: [-3.2, 0.33], up: 0.45, down: 0.4 },
    { at: [-1.4, 0.4], up: 0.66, down: 0.62 },
    { at: [0.0, 0.32], up: 0.78, down: 0.8 },
    { at: [1.5, 0.2], up: 0.8, down: 1.02 },
    { at: [2.65, 0.3], up: 0.64, down: 0.76 },
    { at: [3.35, 0.45], up: 0.42, down: 0.46 },
    { at: [3.72, 0.58], up: 0.36, down: 0.38 },
  ],
  headTilt: -0.42,
  legs: [],
  colours: { body: '#5f7a3a', belly: '#b8a467', dark: '#34431f', far: '#4a6030', accent: '#3d4f25', eye: '#c98a16' },
  stride: 3.6,
  duty: 0.62,
  bob: 0.05,
  arms: { root: [2.55, -0.2], bones: [0.42, 0.36], radii: [0.13, 0.09, 0.07], fingers: 2 },
  head: (c) => {
    const skull: Pt[] = ([
      [-0.25, 0.42], [0.1, 0.52], [0.45, 0.56], [0.75, 0.47], [1.1, 0.4], [1.4, 0.33],
      [1.62, 0.22], [1.66, 0.05], [1.6, -0.06], [1.1, -0.1], [0.55, -0.12], [0.1, -0.12], [-0.25, -0.1],
    ] as Pt[]).map(([x, y]) => [x * 1.12, y * 1.5] as Pt)
    const jaw: Pt[] = ([
      [1.55, -0.08], [1.5, -0.2], [1.1, -0.3], [0.6, -0.38], [0.15, -0.42], [-0.2, -0.32], [-0.25, -0.08],
    ] as Pt[]).map(([x, y]) => [x * 1.12, y * 1.5] as Pt)
    const out: Shape[] = [
      { pts: T(c, jaw), fill: c.colours.belly },
      { pts: T(c, skull), fill: c.colours.body },
    ]
    // Teeth along the upper jaw.
    for (let i = 0; i < 9; i++) {
      const x = 0.5 + i * 0.145
      out.push({ pts: T(c, [[x, -0.12], [x + 0.07, -0.12], [x + 0.035, -0.24]]), fill: '#f2ecd8', smooth: false })
    }
    out.push({ pts: T(c, [[1.8, -0.12], [1.25, -0.16], [0.6, -0.19], [0.15, -0.22]]), stroke: c.colours.dark, strokeWidth: 0.03, closed: false })
    out.push({ pts: T(c, [[0.25, 0.7], [0.5, 0.83], [0.8, 0.72]]), stroke: c.colours.dark, strokeWidth: 0.07, closed: false })
    out.push({ pts: ellipse(...c.to([1.68, 0.38]), 0.05, 0.03, 0, 10), fill: c.colours.dark })
    out.push(...eye([0.48, 0.55], 0.08, c))
    return out
  },
  extras: (r) => ({ behind: [], front: stripes(r, 0.12, 0.62, 9, 0.42, r.colours.accent) }),
}
tyrannosaurus.legs = [0, 0.5].map((phase, i) => ({
  root: [0, 0] as Pt,
  bones: [1.38, 1.3, 0.66] as [number, number, number],
  radii: [0.5, 0.34, 0.2, 0.15] as [number, number, number, number],
  toe: 0.62,
  bend: 1 as const,
  footAngle: 1.2,
  rest: i === 0 ? 0.25 : -0.35,
  phase,
  muscle: 0.74,
  foot: 'bird' as const,
}))

function smallTheropod(
  id: 'velociraptor' | 'compsognathus',
  name: string,
  lengthM: number,
  colours: Species['colours'],
  feathered: boolean,
): Species {
  // Built at 2 m and scaled, so the two share one set of proportions to tune.
  const k = lengthM / 2
  const sp: Species = {
    id,
    name,
    lengthM,
    // To the top of the raised head; both stand about a quarter of their length at the hip.
    heightM: 0.41 * lengthM,
    hipM: 0.5 * k,
    spine: ([
      { at: [-1.02, 0.08], up: 0.018, down: 0.018 },
      { at: [-0.72, 0.08], up: 0.035, down: 0.03 },
      { at: [-0.36, 0.07], up: 0.06, down: 0.055 },
      { at: [0.0, 0.05], up: 0.095, down: 0.1 },
      { at: [0.24, 0.035], up: 0.095, down: 0.12 },
      { at: [0.43, 0.08], up: 0.065, down: 0.075 },
      { at: [0.56, 0.18], up: 0.042, down: 0.045 },
      { at: [0.64, 0.25], up: 0.04, down: 0.04 },
    ] as SpinePoint[]).map((s) => ({ at: [s.at[0] * k, s.at[1] * k] as Pt, up: s.up * k, down: s.down * k })),
    legs: [0, 0.5].map((phase, i) => ({
      root: [0, 0] as Pt,
      bones: [0.21 * k, 0.25 * k, 0.15 * k] as [number, number, number],
      radii: [0.055 * k, 0.03 * k, 0.018 * k, 0.014 * k] as [number, number, number, number],
      toe: 0.085 * k,
      bend: 1 as const,
      footAngle: 1.15,
      rest: i === 0 ? 0.05 * k : -0.07 * k,
      phase,
      muscle: 0.06 * k,
      foot: 'bird' as const,
    })),
    colours,
    headTilt: -0.8,
    stride: 0.75 * k,
    duty: 0.55,
    bob: 0.012 * k,
    arms: feathered
      ? { root: [0.36 * k, -0.04 * k], bones: [0.11 * k, 0.1 * k], radii: [0.025 * k, 0.018 * k, 0.012 * k], fingers: 3 }
      : { root: [0.4 * k, -0.05 * k], bones: [0.07 * k, 0.06 * k], radii: [0.016 * k, 0.012 * k, 0.008 * k], fingers: 2 },
    head: (c) => {
      const s = k
      const skull: Pt[] = [
        [-0.03, 0.045], [0.04, 0.07], [0.1, 0.065], [0.18, 0.045], [0.25, 0.03], [0.28, 0.012],
        [0.27, -0.01], [0.18, -0.018], [0.08, -0.03], [0.0, -0.04], [-0.03, -0.02],
      ].map(([x, y]) => [x! * s, y! * s] as Pt)
      const out: Shape[] = [{ pts: T(c, skull), fill: c.colours.body }]
      out.push({
        pts: T(c, [[0.27 * s, -0.008 * s], [0.15 * s, -0.016 * s], [0.04 * s, -0.022 * s]]),
        stroke: c.colours.dark,
        strokeWidth: 0.005 * s,
        closed: false,
      })
      out.push(...eye([0.06 * s, 0.03 * s], 0.012 * s, c))
      return out
    },
    extras: (r) => {
      const front: Shape[] = stripes(r, 0.1, 0.62, 10, 0.5, r.colours.accent)
      const behind: Shape[] = []
      if (feathered) {
        // A fan of tail feathers and a ruff along the back.
        const tip = r.centre[0]!
        const at = r.centre[6]!
        for (let i = 0; i < 7; i++) {
          const a = Math.PI + (i - 3) * 0.09
          const base = lerp(tip, at, i / 7)
          behind.push({
            pts: capsule(base, polar(base, a + 0.25, 0.22 * k), 0.022 * k, 0.006 * k, 6),
            fill: i % 2 ? r.colours.accent : r.colours.far,
          })
        }
        const n = r.centre.length
        for (let i = Math.round(n * 0.35); i < Math.round(n * 0.9); i += 2) {
          const p = add(r.centre[i]!, [r.normals[i]![0] * r.up[i]! * 0.9, r.normals[i]![1] * r.up[i]! * 0.9])
          const ang = Math.atan2(r.normals[i]![1], r.normals[i]![0]) - 0.9
          behind.push({ pts: capsule(p, polar(p, ang, 0.06 * k), 0.012 * k, 0.003 * k, 5), fill: r.colours.accent })
        }
      }
      return { behind, front }
    },
  }
  return sp
}

const velociraptor = smallTheropod(
  'velociraptor',
  'Velociraptor',
  2.0,
  { body: '#a87b48', belly: '#dcc59a', dark: '#4a3218', far: '#86603a', accent: '#5f4126', eye: '#d8a020' },
  true,
)

const compsognathus = smallTheropod(
  'compsognathus',
  'Compsognathus',
  1.0,
  { body: '#7d9b49', belly: '#cfd49a', dark: '#2f3d1a', far: '#62803a', accent: '#4c6229', eye: '#e0b030' },
  false,
)

const triceratops: Species = {
  id: 'triceratops',
  name: 'Triceratops',
  lengthM: 9.0,
  heightM: 3.0,
  hipM: 2.05,
  spine: [
    { at: [-3.45, -0.5], up: 0.06, down: 0.06 },
    { at: [-2.5, -0.12], up: 0.27, down: 0.24 },
    { at: [-1.5, 0.22], up: 0.55, down: 0.52 },
    { at: [0.0, 0.3], up: 0.62, down: 0.95 },
    { at: [1.5, 0.12], up: 0.66, down: 1.02 },
    { at: [2.55, -0.18], up: 0.55, down: 0.72 },
    { at: [3.2, -0.42], up: 0.42, down: 0.42 },
  ],
  legs: [],
  colours: { body: '#8d5b3b', belly: '#caa27a', dark: '#40261a', far: '#6f4630', accent: '#b9693b', eye: '#2a1a10' },
  stride: 2.4,
  duty: 0.65,
  bob: 0.04,
  head: (c) => {
    const frill: Pt[] = [
      [-0.35, -0.2], [-0.55, 0.35], [-0.5, 0.95], [-0.2, 1.4], [0.25, 1.55], [0.6, 1.3], [0.75, 0.75], [0.7, 0.2],
    ]
    const face: Pt[] = [
      [0.2, 0.55], [0.7, 0.45], [1.15, 0.35], [1.5, 0.22], [1.78, 0.05], [1.85, -0.18], [1.65, -0.42],
      [1.25, -0.5], [0.75, -0.55], [0.3, -0.5], [0.05, -0.2],
    ]
    const out: Shape[] = [
      { pts: T(c, frill), fill: c.colours.accent },
    ]
    // Bumps round the frill's edge, sat on the edge itself.
    const edge = spline(frill, 6).slice(4, -4)
    for (let i = 0; i < edge.length; i += 4) {
      out.push({ pts: ellipse(...c.to(edge[i]!), 0.09, 0.09, 0, 10), fill: '#e0b071' })
    }
    out.push({ pts: T(c, frill.map(([x, y]) => [x * 0.65 + 0.08, y * 0.65 + 0.15] as Pt)), fill: '#a95e33' })
    out.push({ pts: T(c, face), fill: c.colours.body })
    // Brow horns, nose horn, beak.
    out.push({ pts: T(c, [[0.55, 0.42], [0.78, 0.55], [1.4, 1.2], [1.82, 1.62], [1.55, 1.02], [0.98, 0.34]]), fill: '#efe3c3' })
    out.push({ pts: T(c, [[1.38, 0.24], [1.55, 0.2], [1.7, 0.55], [1.62, 0.6]]), fill: '#efe3c3', smooth: false })
    out.push({ pts: T(c, [[1.7, 0.02], [1.97, -0.15], [1.85, -0.38], [1.62, -0.3]]), fill: '#3a2a1c' })
    out.push(...eye([0.72, 0.22], 0.06, c))
    return out
  },
}
triceratops.legs = [
  // Hind pair, then fore pair. Even index = near side.
  { root: [0, 0], bones: [1.0, 0.75, 0.32], radii: [0.4, 0.26, 0.2, 0.18], toe: 0.3, bend: 1, footAngle: 1.45, rest: 0.15, phase: 0, muscle: 0.45, foot: 'hoof' },
  { root: [0, 0], bones: [1.0, 0.75, 0.32], radii: [0.4, 0.26, 0.2, 0.18], toe: 0.3, bend: 1, footAngle: 1.45, rest: -0.25, phase: 0.5, muscle: 0.45, foot: 'hoof' },
  { root: [2.45, -0.6], bones: [0.75, 0.62, 0.22], radii: [0.32, 0.22, 0.17, 0.16], toe: 0.25, bend: -1, footAngle: 1.5, rest: 0.1, phase: 0.25, muscle: 0.3, foot: 'hoof' },
  { root: [2.45, -0.6], bones: [0.75, 0.62, 0.22], radii: [0.32, 0.22, 0.17, 0.16], toe: 0.25, bend: -1, footAngle: 1.5, rest: -0.2, phase: 0.75, muscle: 0.3, foot: 'hoof' },
]

const stegosaurus: Species = {
  id: 'stegosaurus',
  name: 'Stegosaurus',
  lengthM: 9.0,
  heightM: 4.0,
  hipM: 1.95,
  spine: [
    { at: [-4.2, -0.2], up: 0.06, down: 0.06 },
    { at: [-3.2, 0.25], up: 0.24, down: 0.22 },
    { at: [-1.6, 0.62], up: 0.46, down: 0.42 },
    { at: [0.0, 0.62], up: 0.7, down: 0.88 },
    { at: [1.35, 0.18], up: 0.62, down: 0.8 },
    { at: [2.35, -0.42], up: 0.46, down: 0.52 },
    { at: [3.15, -0.85], up: 0.25, down: 0.25 },
    { at: [3.7, -1.02], up: 0.19, down: 0.19 },
  ],
  legs: [
    { root: [0, 0], bones: [0.95, 0.72, 0.28], radii: [0.36, 0.24, 0.19, 0.17], toe: 0.28, bend: 1, footAngle: 1.45, rest: 0.1, phase: 0, muscle: 0.4, foot: 'pad' },
    { root: [0, 0], bones: [0.95, 0.72, 0.28], radii: [0.36, 0.24, 0.19, 0.17], toe: 0.28, bend: 1, footAngle: 1.45, rest: -0.25, phase: 0.5, muscle: 0.4, foot: 'pad' },
    { root: [2.3, -0.75], bones: [0.55, 0.45, 0.2], radii: [0.26, 0.18, 0.15, 0.14], toe: 0.2, bend: -1, footAngle: 1.5, rest: 0.08, phase: 0.25, foot: 'pad' },
    { root: [2.3, -0.75], bones: [0.55, 0.45, 0.2], radii: [0.26, 0.18, 0.15, 0.14], toe: 0.2, bend: -1, footAngle: 1.5, rest: -0.15, phase: 0.75, foot: 'pad' },
  ],
  colours: { body: '#5b7d69', belly: '#a8bd98', dark: '#2a3d33', far: '#486455', accent: '#cf6a3a', eye: '#1e1a12' },
  stride: 2.0,
  duty: 0.65,
  bob: 0.03,
  head: (c) => {
    const skull: Pt[] = [
      [-0.05, 0.16], [0.2, 0.19], [0.42, 0.14], [0.6, 0.06], [0.66, -0.04], [0.6, -0.1], [0.3, -0.13], [0.0, -0.15],
    ]
    return [
      { pts: T(c, skull), fill: c.colours.body },
      { pts: T(c, [[0.64, -0.05], [0.4, -0.07], [0.15, -0.08]]), stroke: c.colours.dark, strokeWidth: 0.015, closed: false },
      ...eye([0.22, 0.07], 0.035, c),
    ]
  },
  extras: (r) => {
    // Two staggered rows of plates; the far row sits behind the body.
    const behind: Shape[] = []
    const front: Shape[] = []
    const n = r.centre.length
    const plates = 13
    for (let k = 0; k < plates; k++) {
      const f = 0.14 + (0.62 * k) / (plates - 1)
      const i = Math.round(n * f)
      const size = Math.sin(((k + 0.5) / plates) * Math.PI) * 0.62 + 0.18
      const base = add(r.centre[i]!, [r.normals[i]![0] * r.up[i]! * 0.8, r.normals[i]![1] * r.up[i]! * 0.8])
      const nrm = r.normals[i]!
      const tan: Pt = [nrm[1], -nrm[0]]
      const plate = (shift: number): Pt[] => {
        const b = add(base, [tan[0] * shift, tan[1] * shift])
        const tip = add(b, [nrm[0] * size * 1.2 - tan[0] * size * 0.15, nrm[1] * size * 1.2 - tan[1] * size * 0.15])
        return [
          add(b, [-tan[0] * size * 0.42, -tan[1] * size * 0.42]),
          add(lerp(b, tip, 0.55), [-tan[0] * size * 0.38, -tan[1] * size * 0.38]),
          tip,
          add(lerp(b, tip, 0.5), [tan[0] * size * 0.36, tan[1] * size * 0.36]),
          add(b, [tan[0] * size * 0.4, tan[1] * size * 0.4]),
        ]
      }
      const far = plate(size * 0.45)
      behind.push({ pts: far, fill: '#a0502c' })
      if (k % 2 === 0 || k > 1) {
        front.push({ pts: plate(0), fill: r.colours.accent })
        front.push({ pts: plate(0).map((p) => lerp(p, base, 0.38)), fill: '#e89a5c', alpha: 0.6 })
      }
    }
    // The thagomizer: two pairs of tail spikes.
    for (let k = 0; k < 2; k++) {
      const i = 3 + k * 5
      const b = r.centre[i]!
      const nrm = r.normals[i]!
      for (const lean of [-0.55, -0.2]) {
        const dir = Math.atan2(nrm[1], nrm[0]) + lean + 0.35
        front.push({ pts: [polar(b, dir - 1.4, 0.08), polar(b, dir, 0.85), polar(b, dir + 1.4, 0.08)], fill: '#e9dcc0', smooth: false })
      }
    }
    return { behind, front }
  },
}

const brachiosaurus: Species = {
  id: 'brachiosaurus',
  name: 'Brachiosaurus',
  lengthM: 22,
  heightM: 12.5,
  hipM: 3.9,
  spine: [
    { at: [-10.1, -1.55], up: 0.08, down: 0.08 },
    { at: [-7.3, -0.9], up: 0.25, down: 0.22 },
    { at: [-4.8, -0.35], up: 0.48, down: 0.42 },
    { at: [-2.4, 0.25], up: 0.85, down: 0.75 },
    { at: [0.0, 0.75], up: 1.08, down: 1.5 },
    { at: [2.6, 1.45], up: 1.18, down: 1.72 },
    { at: [4.6, 2.35], up: 0.92, down: 0.95 },
    { at: [5.8, 4.1], up: 0.58, down: 0.58 },
    { at: [6.8, 6.0], up: 0.42, down: 0.42 },
    { at: [7.55, 7.85], up: 0.32, down: 0.32 },
  ],
  legs: [
    { root: [0, 0], bones: [1.95, 1.35, 0.42], radii: [0.82, 0.58, 0.5, 0.5], toe: 0.4, bend: 1, footAngle: 1.52, rest: 0.25, phase: 0, muscle: 0.95, foot: 'pad' },
    { root: [0, 0], bones: [1.95, 1.35, 0.42], radii: [0.82, 0.58, 0.5, 0.5], toe: 0.4, bend: 1, footAngle: 1.52, rest: -0.4, phase: 0.5, muscle: 0.95, foot: 'pad' },
    { root: [4.25, 1.05], bones: [2.25, 1.75, 0.82], radii: [0.74, 0.52, 0.46, 0.46], toe: 0.35, bend: -1, footAngle: 1.53, rest: 0.25, phase: 0.25, muscle: 0.8, foot: 'pad' },
    { root: [4.25, 1.05], bones: [2.25, 1.75, 0.82], radii: [0.74, 0.52, 0.46, 0.46], toe: 0.35, bend: -1, footAngle: 1.53, rest: -0.35, phase: 0.75, muscle: 0.8, foot: 'pad' },
  ],
  colours: { body: '#7189a0', belly: '#b9c6cf', dark: '#33424f', far: '#5b7187', accent: '#5a7088', eye: '#1c1c1c' },
  stride: 3.4,
  duty: 0.68,
  bob: 0.06,
  head: (c) => {
    const skull: Pt[] = [
      [-0.1, 0.32], [0.15, 0.48], [0.4, 0.42], [0.62, 0.28], [0.95, 0.15], [1.08, 0.0], [1.0, -0.14], [0.6, -0.2], [0.15, -0.26], [-0.1, -0.2],
    ]
    return [
      { pts: T(c, skull), fill: c.colours.body },
      { pts: T(c, [[1.02, -0.07], [0.6, -0.1], [0.25, -0.12]]), stroke: c.colours.dark, strokeWidth: 0.025, closed: false },
      ...eye([0.38, 0.17], 0.06, c),
    ]
  },
  extras: (r) => {
    // Dapples along the back.
    const front: Shape[] = []
    const n = r.centre.length
    for (let i = Math.round(n * 0.25); i < Math.round(n * 0.78); i += 3) {
      const p = add(r.centre[i]!, [r.normals[i]![0] * r.up[i]! * 0.55, r.normals[i]![1] * r.up[i]! * 0.55])
      front.push({ pts: ellipse(p[0], p[1], r.up[i]! * 0.22, r.up[i]! * 0.14, Math.atan2(-r.normals[i]![0], r.normals[i]![1]), 14), fill: r.colours.accent, alpha: 0.7 })
    }
    return { behind: [], front }
  },
}

const ankylosaurus: Species = {
  id: 'ankylosaurus',
  name: 'Ankylosaurus',
  lengthM: 7.0,
  heightM: 1.7,
  hipM: 1.1,
  spine: [
    { at: [-3.55, -0.32], up: 0.08, down: 0.08 },
    { at: [-2.6, -0.12], up: 0.14, down: 0.13 },
    { at: [-1.5, 0.08], up: 0.3, down: 0.28 },
    { at: [0.0, 0.18], up: 0.42, down: 0.55 },
    { at: [1.25, 0.1], up: 0.42, down: 0.58 },
    { at: [2.2, -0.12], up: 0.32, down: 0.36 },
    { at: [2.75, -0.25], up: 0.24, down: 0.24 },
  ],
  legs: [
    { root: [0, 0], bones: [0.5, 0.38, 0.16], radii: [0.24, 0.17, 0.14, 0.14], toe: 0.18, bend: 1, footAngle: 1.45, rest: 0.08, phase: 0, muscle: 0.26, foot: 'hoof' },
    { root: [0, 0], bones: [0.5, 0.38, 0.16], radii: [0.24, 0.17, 0.14, 0.14], toe: 0.18, bend: 1, footAngle: 1.45, rest: -0.15, phase: 0.5, muscle: 0.26, foot: 'hoof' },
    { root: [2.05, -0.3], bones: [0.38, 0.3, 0.12], radii: [0.2, 0.15, 0.12, 0.12], toe: 0.15, bend: -1, footAngle: 1.5, rest: 0.05, phase: 0.25, foot: 'hoof' },
    { root: [2.05, -0.3], bones: [0.38, 0.3, 0.12], radii: [0.2, 0.15, 0.12, 0.12], toe: 0.15, bend: -1, footAngle: 1.5, rest: -0.12, phase: 0.75, foot: 'hoof' },
  ],
  colours: { body: '#8b7d55', belly: '#c7b98d', dark: '#3d3522', far: '#6f6342', accent: '#5e5232', eye: '#1e1a12' },
  stride: 1.2,
  duty: 0.65,
  bob: 0.02,
  head: (c) => {
    const skull: Pt[] = [
      [-0.05, 0.22], [0.12, 0.27], [0.4, 0.22], [0.58, 0.08], [0.6, -0.06], [0.5, -0.14], [0.2, -0.18], [-0.05, -0.16],
    ]
    return [
      { pts: T(c, skull), fill: c.colours.body },
      { pts: T(c, [[0.05, 0.24], [-0.18, 0.36], [0.12, 0.2]]), fill: '#e7dcbc', smooth: false },
      { pts: T(c, [[0.08, -0.12], [-0.12, -0.26], [0.2, -0.14]]), fill: '#e7dcbc', smooth: false },
      ...eye([0.25, 0.08], 0.035, c),
    ]
  },
  extras: (r) => {
    const front: Shape[] = []
    const behind: Shape[] = []
    const n = r.centre.length
    // Rows of osteoderms across the back, and spikes down the flank.
    for (let row = 0; row < 3; row++) {
      for (let i = Math.round(n * 0.3) + row; i < Math.round(n * 0.92); i += 3) {
        const f = 0.82 - row * 0.28
        const p = add(r.centre[i]!, [r.normals[i]![0] * r.up[i]! * f, r.normals[i]![1] * r.up[i]! * f])
        const s = r.up[i]! * (0.2 - row * 0.03)
        front.push({ pts: ellipse(p[0], p[1], s * 1.3, s, 0, 12), fill: r.colours.accent })
        front.push({ pts: ellipse(p[0] - s * 0.2, p[1] + s * 0.25, s * 0.6, s * 0.45, 0, 10), fill: '#a99a6c', alpha: 0.8 })
      }
    }
    for (let i = Math.round(n * 0.35); i < Math.round(n * 0.85); i += 4) {
      const b = add(r.centre[i]!, [0, -r.down[i]! * 0.25])
      front.push({ pts: [[b[0] - 0.09, b[1] + 0.04], [b[0] - 0.02, b[1] - 0.3], [b[0] + 0.09, b[1] + 0.04]], fill: '#ddd1ad', smooth: false })
    }
    // The tail club.
    const tip = r.centre[2]!
    behind.push({ pts: ellipse(tip[0] - 0.05, tip[1], 0.36, 0.26, 0.15, 24), fill: r.colours.accent })
    front.push({ pts: ellipse(tip[0] - 0.1, tip[1] + 0.05, 0.28, 0.2, 0.15, 24), fill: '#a99a6c' })
    return { behind, front }
  },
}

export const SPECIES: Record<DinosaurId, Species> = {
  compsognathus,
  velociraptor,
  ankylosaurus,
  triceratops,
  stegosaurus,
  tyrannosaurus,
  brachiosaurus,
}

export const LINEUP_ORDER: DinosaurId[] = [
  'compsognathus',
  'velociraptor',
  'ankylosaurus',
  'triceratops',
  'stegosaurus',
  'tyrannosaurus',
  'brachiosaurus',
]

/** Nose to tail along the centreline, plus the head — what the tests compare with `lengthM`. */
export function measuredLength(sp: Species): number {
  const shapes = poseDinosaur(sp)
  const centre = spline(sp.spine.map((s) => s.at), SPINE_SAMPLES)
  const b = shapesBounds(shapes)
  // The head extends past the last spine point; measure it as the overhang
  // beyond the spine's end along the body's direction of travel.
  const end = centre[centre.length - 1]!
  const headReach = b.x1 - (end[0])
  return pathLength(centre) + Math.max(0, headReach) * 0.98
}

export function shapesBounds(shapes: Shape[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of shapes) {
    for (const [x, y] of s.pts) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  return { x0, y0, x1, y1 }
}

// ---------------------------------------------------------------------------
// Things for scale
// ---------------------------------------------------------------------------

export const HUMAN_HEIGHT_M = 1.75

/** A person, 1.75 m, front-on, feet on y = 0. */
export function human(colour = '#e6e6e6'): Shape[] {
  const h = HUMAN_HEIGHT_M
  const s = h / 1.75
  return [
    { pts: ellipse(0, 1.635 * s, 0.1 * s, 0.115 * s, 0, 24), fill: colour },
    { pts: capsule([0, 1.5 * s], [0, 0.98 * s], 0.2 * s, 0.17 * s, 12), fill: colour },
    { pts: capsule([-0.1 * s, 0.95 * s], [-0.11 * s, 0.05 * s], 0.075 * s, 0.055 * s, 8), fill: colour },
    { pts: capsule([0.1 * s, 0.95 * s], [0.11 * s, 0.05 * s], 0.075 * s, 0.055 * s, 8), fill: colour },
    { pts: capsule([-0.21 * s, 1.42 * s], [-0.27 * s, 0.82 * s], 0.055 * s, 0.04 * s, 8), fill: colour },
    { pts: capsule([0.21 * s, 1.42 * s], [0.27 * s, 0.82 * s], 0.055 * s, 0.04 * s, 8), fill: colour },
    { pts: ellipse(-0.13 * s, 0.025 * s, 0.1 * s, 0.03 * s, 0, 12), fill: colour },
    { pts: ellipse(0.13 * s, 0.025 * s, 0.1 * s, 0.03 * s, 0, 12), fill: colour },
  ]
}

/** The bunch of bananas, converted to metres and sat on the ground. */
export function bananasOnTheGround(): Shape[] {
  const mm = bananaBunch(3)
  const b = shapesBounds(mm)
  return mapShapes(mm, ([x, y]) => [(x - b.x0) / 1000, (y - b.y0) / 1000], 1 / 1000)
}

export { BANANA_LENGTH_MM }
