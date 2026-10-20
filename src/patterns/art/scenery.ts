/**
 * Scenery for the moving scenes: mountains, trees, ferns, clouds, a volcano,
 * a comet and things that fly.
 *
 * Everything here is in the scene's own pixels, y DOWN, and returns Shapes. The
 * one rule that matters is periodicity: a mountain range that scrolls has to
 * tile with the period it scrolls by, or the loop shows a seam where it wraps.
 * `ridge` is a sum of triangle waves whose frequencies are whole cycles per
 * period, so it tiles exactly; the tests check that it does.
 */

import { between, pick, rng } from '../random'
import { capsule, cubic, ellipse, lerp, polar, tube, type Pt, type Shape } from './shapes'

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

/** Mix two hex colours, t = 0 gives `a`. Returns a hex colour. */
export function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a)
  const y = hexRgb(b)
  const k = Math.max(0, Math.min(1, t))
  const c = x.map((v, i) => Math.round(v + (y[i]! - v) * k))
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Every shape filled with one colour — a silhouette. Strokes too. */
export function silhouette(shapes: Shape[], colour: string): Shape[] {
  return shapes.map((s) => ({
    ...s,
    fill: s.fill ? colour : undefined,
    stroke: s.stroke ? colour : undefined,
    alpha: s.alpha !== undefined && s.alpha < 0.95 ? 0 : 1,
  }))
}

// ---------------------------------------------------------------------------
// Ridges
// ---------------------------------------------------------------------------

/** Triangle wave, 0 at whole numbers and 1 half way between. */
function tri(u: number): number {
  const f = u - Math.floor(u)
  return 1 - 2 * Math.abs(f - 0.5)
}

/**
 * A mountain profile, periodic in `period`: returns height 0..1 for x.
 * Frequencies are whole cycles per period, so ridge(x) === ridge(x + period).
 */
export function makeRidge(seed: number, period: number, opts: { octaves?: number; rough?: number; base?: number } = {}) {
  const r = rng(seed)
  const octaves = opts.octaves ?? 5
  const rough = opts.rough ?? 0.48
  const base = opts.base ?? 3
  const parts: { f: number; ph: number; a: number }[] = []
  let a = 1
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    const f = Math.max(1, Math.round(base * 2 ** o * between(r, 0.8, 1.25)))
    parts.push({ f, ph: r(), a })
    norm += a
    a *= rough
  }
  return (x: number): number => {
    let h = 0
    for (const p of parts) h += p.a * tri((x / period) * p.f + p.ph)
    return h / norm
  }
}

/**
 * A filled ridge from x0 to x1: the profile on top, closed down to `bottom`.
 * `baseY` is where height 0 sits and `amp` how far height 1 rises above it.
 *
 * `offset` is how far the ridge has scrolled. The profile is sampled on a grid
 * fixed to the RIDGE, and the samples moved, rather than sampling a moving
 * ridge on a fixed grid — so a peak is cut the same way every frame instead of
 * shimmering, and two outputs of a span draw the same polygon at their join.
 */
export function ridgeShape(
  h: (x: number) => number,
  x0: number,
  x1: number,
  baseY: number,
  amp: number,
  bottom: number,
  fill: string,
  offset = 0,
  step = 6,
): Shape {
  const pts: Pt[] = [[x0 - step, bottom]]
  const first = Math.floor((x0 + offset) / step) * step
  for (let c = first; c - offset <= x1 + step; c += step) pts.push([c - offset, baseY - h(c) * amp])
  pts.push([x1 + step, bottom])
  return { pts, fill, smooth: false }
}

/** Snow above a height: the ridge where it is higher than `snowY`, else nothing. */
export function snowShape(
  h: (x: number) => number,
  x0: number,
  x1: number,
  baseY: number,
  amp: number,
  snowY: number,
  fill: string,
  offset = 0,
  step = 6,
): Shape[] {
  const out: Shape[] = []
  let run: { p: Pt; c: number }[] = []
  const first = Math.floor((x0 + offset) / step) * step
  for (let c = first; c - offset <= x1 + step; c += step) {
    const y = baseY - h(c) * amp
    if (y < snowY) {
      run.push({ p: [c - offset, y], c })
    } else if (run.length) {
      out.push(capSnow(run, snowY, fill, step))
      run = []
    }
  }
  if (run.length) out.push(capSnow(run, snowY, fill, step))
  return out
}

function capSnow(top: { p: Pt; c: number }[], snowY: number, fill: string, step: number): Shape {
  // The snow line wanders a little rather than being ruled straight. The
  // wander is keyed to the ridge, not to where this run of samples began, so
  // it scrolls with the mountain instead of crawling along it.
  const bottom: Pt[] = top
    .map(({ p: [x, y], c }) => {
      const k = ((Math.round(c / step) % 3) + 3) % 3
      return [x, Math.min(snowY + (k - 1) * 4, y + (snowY - y) * 0.85)] as Pt
    })
    .reverse()
  return { pts: [...top.map((t) => t.p), ...bottom], fill, smooth: false }
}

// ---------------------------------------------------------------------------
// Plants
// ---------------------------------------------------------------------------

export type PlantColours = { trunk: string; leaf: string; dark: string }

/** A palm, base at (x, y), `h` tall, leaning `lean` (fraction of height). */
export function palm(x: number, y: number, h: number, seed: number, c: PlantColours, sway = 0): Shape[] {
  const r = rng(seed)
  const lean = between(r, -0.25, 0.25) + sway * 0.03
  const top: Pt = [x + lean * h, y - h]
  const trunkLine = cubic([x, y], [x, y - h * 0.4], [x + lean * h * 0.4, y - h * 0.8], top, 20)
  const w = h * 0.045
  const out: Shape[] = [{ pts: tube(trunkLine, [w * 1.25, w, w * 0.8], [w * 1.25, w, w * 0.8]), fill: c.trunk }]
  for (let i = 2; i < trunkLine.length - 1; i += 2) {
    const p = trunkLine[i]!
    out.push({ pts: ellipse(p[0], p[1], w * 1.05, w * 0.22, 0, 10), fill: c.dark, alpha: 0.5 })
  }
  const fronds = 7 + Math.floor(r() * 3)
  for (let i = 0; i < fronds; i++) {
    const ang = -Math.PI / 2 + (i / (fronds - 1) - 0.5) * 3.4 + between(r, -0.15, 0.15)
    const reach = h * between(r, 0.38, 0.5)
    const droop = h * between(r, 0.15, 0.3) * (1 + sway * 0.1)
    const end: Pt = [top[0] + Math.cos(ang) * reach, top[1] + Math.sin(ang) * reach * 0.6 + droop]
    const mid: Pt = [top[0] + Math.cos(ang) * reach * 0.55, top[1] + Math.sin(ang) * reach * 0.55 - h * 0.06]
    const line = cubic(top, mid, lerp(mid, end, 0.6), end, 14)
    out.push({ pts: tube(line, [h * 0.002, h * 0.045, h * 0.035, 0.5], [h * 0.002, h * 0.02, h * 0.018, 0.5]), fill: i % 2 ? c.leaf : c.dark })
  }
  return out
}

/** A conifer: a trunk and stacked tiers. */
export function conifer(x: number, y: number, h: number, seed: number, c: PlantColours): Shape[] {
  const r = rng(seed)
  const out: Shape[] = [{ pts: capsule([x, y], [x, y - h * 0.4], h * 0.035, h * 0.025, 6), fill: c.trunk }]
  const tiers = 4 + Math.floor(r() * 2)
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers
    const ty = y - h * (0.18 + f * 0.75)
    const half = h * (0.3 - f * 0.22) * between(r, 0.9, 1.1)
    out.push({
      pts: [
        [x - half, ty],
        [x - half * 0.4, ty - h * 0.02],
        [x, ty - h * 0.26],
        [x + half * 0.4, ty - h * 0.02],
        [x + half, ty],
        [x, ty + h * 0.03],
      ],
      fill: i % 2 ? c.leaf : c.dark,
      smooth: false,
    })
  }
  return out
}

/** A low fan of fern fronds, rooted at (x, y). */
export function fern(x: number, y: number, size: number, seed: number, c: PlantColours, sway = 0): Shape[] {
  const r = rng(seed)
  const out: Shape[] = []
  const n = 5 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.6 + between(r, -0.1, 0.1) + sway * 0.06
    const len = size * between(r, 0.7, 1.0)
    const end = polar([x, y], ang, len)
    const ctrl = polar([x, y], ang - 0.1 * Math.sign(Math.cos(ang) || 1), len * 0.6)
    const line = cubic([x, y], ctrl, lerp(ctrl, end, 0.7), [end[0], end[1] + len * 0.25], 12)
    // Leaflets: a zig-zag either side of the rib.
    const left: Pt[] = []
    const right: Pt[] = []
    for (let k = 0; k < line.length; k++) {
      const a = line[Math.max(0, k - 1)]!
      const b = line[Math.min(line.length - 1, k + 1)]!
      const d: Pt = [b[0] - a[0], b[1] - a[1]]
      const l = Math.hypot(d[0], d[1]) || 1
      const nrm: Pt = [-d[1] / l, d[0] / l]
      const w = size * 0.11 * Math.sin((k / (line.length - 1)) * Math.PI) * (k % 2 ? 1 : 0.55)
      left.push([line[k]![0] + nrm[0] * w, line[k]![1] + nrm[1] * w])
      right.push([line[k]![0] - nrm[0] * w, line[k]![1] - nrm[1] * w])
    }
    out.push({ pts: [...left, ...right.reverse()], fill: i % 2 ? c.leaf : c.dark, smooth: false })
  }
  return out
}

/** A tuft of grass blades. */
export function grass(x: number, y: number, size: number, seed: number, colour: string, sway = 0): Shape[] {
  const r = rng(seed)
  const out: Shape[] = []
  const n = 4 + Math.floor(r() * 4)
  for (let i = 0; i < n; i++) {
    const bx = x + between(r, -size * 0.3, size * 0.3)
    const tipX = bx + between(r, -size * 0.35, size * 0.35) + sway * size * 0.1
    const h = size * between(r, 0.6, 1)
    out.push({ pts: [[bx - size * 0.05, y], [tipX, y - h], [bx + size * 0.05, y]], fill: colour, smooth: false })
  }
  return out
}

// ---------------------------------------------------------------------------
// Sky things
// ---------------------------------------------------------------------------

/** A flat cloud: overlapping circles over a flat bottom. */
export function cloud(x: number, y: number, w: number, seed: number, colour: string): Shape[] {
  const r = rng(seed)
  const out: Shape[] = []
  const n = 4 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1)
    const cx = x - w / 2 + f * w
    const rad = w * (0.13 + Math.sin(f * Math.PI) * between(r, 0.12, 0.2))
    out.push({ pts: ellipse(cx, y - rad * 0.5, rad, rad, 0, 24), fill: colour })
  }
  out.push({ pts: [[x - w * 0.62, y], [x + w * 0.62, y], [x + w * 0.5, y - w * 0.08], [x - w * 0.5, y - w * 0.08]], fill: colour })
  return out
}

/**
 * A pterosaur, wings spread, seen from a little below — the shape that reads
 * as "pterosaur" at any size. `span` is the wingspan, `flap` 0..1 one
 * wingbeat. The head points +x.
 */
export function pterosaur(x: number, y: number, span: number, flap: number, colour: string): Shape[] {
  const s = span / 2
  const beat = Math.sin(flap * Math.PI * 2)
  const out: Shape[] = []
  for (const side of [-1, 1]) {
    const elbow: Pt = [x + side * s * 0.38, y - beat * s * 0.22 - s * 0.08]
    const tip: Pt = [x + side * s, y - beat * s * 0.55 + s * 0.06]
    out.push({
      pts: [
        [x + side * s * 0.06, y - s * 0.04],
        elbow,
        tip,
        [x + side * s * 0.62, y - beat * s * 0.3 + s * 0.12],
        [x + side * s * 0.3, y + s * 0.1],
        [x + side * s * 0.05, y + s * 0.1],
      ],
      fill: colour,
    })
  }
  out.push({ pts: ellipse(x, y + s * 0.02, s * 0.09, s * 0.16, 0, 16), fill: colour })
  // Head: a long beak forward and a crest back, a Pteranodon's silhouette.
  out.push({
    pts: [
      [x - s * 0.04, y - s * 0.12],
      [x - s * 0.2, y - s * 0.3],
      [x + s * 0.02, y - s * 0.2],
      [x + s * 0.42, y - s * 0.1],
      [x + s * 0.04, y - s * 0.06],
    ],
    fill: colour,
    smooth: false,
  })
  return out
}

/** A volcano cone, base centred at (x, y), crater `h` above it. */
export function volcano(x: number, y: number, w: number, h: number, c: { rock: string; light: string; dark: string }): Shape[] {
  const rim = w * 0.07
  const left = cubic([x - w / 2, y], [x - w * 0.3, y - h * 0.15], [x - rim * 1.6, y - h * 0.7], [x - rim, y - h], 20)
  const right = cubic([x + rim, y - h], [x + rim * 1.6, y - h * 0.7], [x + w * 0.3, y - h * 0.15], [x + w / 2, y], 20)
  const cone: Pt[] = [...left, [x - rim * 0.4, y - h + rim * 0.25], [x + rim * 0.4, y - h + rim * 0.25], ...right]
  // The lit face: the right flank, between a ridge line and the edge.
  const lit: Pt[] = [
    [x + rim * 0.3, y - h + rim * 0.2],
    ...right,
    [x + w * 0.1, y],
    [x + rim * 0.6, y - h * 0.55],
  ]
  return [
    { pts: cone, fill: c.rock, smooth: false },
    { pts: lit, fill: c.light, alpha: 0.55, smooth: false },
    { pts: [[x - rim, y - h], [x + rim, y - h], [x + rim * 0.5, y - h + rim * 0.35], [x - rim * 0.5, y - h + rim * 0.35]], fill: c.dark, smooth: false },
  ]
}

/** A wandering line down a slope, for lava. Starts at `from`, ends `length` below. */
export function lavaFlow(from: Pt, length: number, drift: number, seed: number): Pt[] {
  const r = rng(seed)
  const pts: Pt[] = [from]
  const n = 14
  let p = from
  for (let i = 1; i <= n; i++) {
    p = [p[0] + drift * (length / n) + between(r, -1, 1) * length * 0.03, p[1] + length / n]
    pts.push(p)
  }
  return pts
}

export const TREE_KINDS = ['palm', 'conifer', 'palm', 'fern'] as const

export function anyPlant(
  kind: (typeof TREE_KINDS)[number],
  x: number,
  y: number,
  h: number,
  seed: number,
  c: PlantColours,
  sway = 0,
): Shape[] {
  if (kind === 'palm') return palm(x, y, h, seed, c, sway)
  if (kind === 'conifer') return conifer(x, y, h, seed, c)
  return fern(x, y, h * 0.5, seed, c, sway)
}

export { pick }
