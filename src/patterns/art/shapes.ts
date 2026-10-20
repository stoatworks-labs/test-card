/**
 * Shapes: the one drawing vocabulary every piece of artwork here is built from.
 *
 * Invariant 1 of this repo is that geometry is pure and canvases are dumb, and
 * the artwork keeps it. A banana, a Tyrannosaurus or a mountain range is a list
 * of filled polygons computed in plain numbers — so a test can ask how long the
 * banana is, or whether the dinosaur is really 12.3 m nose to tail — and
 * `fillShapes` is the only thing that ever touches a canvas.
 *
 * Polygons are drawn smoothed (quadratic curves through the edge midpoints) by
 * default. A life-size Brachiosaurus on a fine-pitch wall is thousands of
 * pixels tall, and straight segments between samples would show as facets.
 */

export type Pt = [number, number]

export type Shape = {
  pts: Pt[]
  fill?: string
  stroke?: string
  strokeWidth?: number
  alpha?: number
  /** Default true. False keeps sharp corners — horns, plates, claws. */
  smooth?: boolean
  /** Default true. An open shape is stroked, never filled. */
  closed?: boolean
}

export function add(a: Pt, b: Pt): Pt {
  return [a[0] + b[0], a[1] + b[1]]
}

export function sub(a: Pt, b: Pt): Pt {
  return [a[0] - b[0], a[1] - b[1]]
}

export function scaleP(a: Pt, k: number): Pt {
  return [a[0] * k, a[1] * k]
}

export function len(a: Pt): number {
  return Math.hypot(a[0], a[1])
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

export function rotate(p: Pt, angle: number, about: Pt = [0, 0]): Pt {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const x = p[0] - about[0]
  const y = p[1] - about[1]
  return [about[0] + x * c - y * s, about[1] + x * s + y * c]
}

/** A point `distance` along `angle` from `from`. */
export function polar(from: Pt, angle: number, distance: number): Pt {
  return [from[0] + Math.cos(angle) * distance, from[1] + Math.sin(angle) * distance]
}

/** Sample a cubic Bézier, endpoints included. */
export function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 24): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return out
}

/**
 * A Catmull–Rom curve through every control point, `per` samples per span.
 * Used for spines, tails and necks: put the points where the animal is, and
 * the curve goes through them rather than near them.
 */
export function spline(points: Pt[], per = 12): Pt[] {
  if (points.length < 3) return points.slice()
  const out: Pt[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[Math.min(points.length - 1, i + 2)]!
    for (let k = 0; k < per; k++) {
      const t = k / per
      const t2 = t * t
      const t3 = t2 * t
      out.push([
        0.5 *
          (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 *
          (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  out.push(points[points.length - 1]!)
  return out
}

/** Linear interpolation of a value list onto `n` samples. */
export function resample(values: number[], n: number): number[] {
  if (values.length === 1) return Array.from({ length: n }, () => values[0]!)
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const f = (i / Math.max(1, n - 1)) * (values.length - 1)
    const k = Math.min(values.length - 2, Math.floor(f))
    const t = f - k
    // Smoothstep between control values, so a tail tapers rather than kinks.
    const s = t * t * (3 - 2 * t)
    out.push(values[k]! + (values[k + 1]! - values[k]!) * s)
  }
  return out
}

/**
 * A tube around a centreline: the outline of a tail, a neck, a banana.
 *
 * `above` and `below` are the half-thicknesses on each side of the line (left
 * and right of the direction of travel), sampled onto the centreline. Separate
 * sides are what let a belly hang lower than a back rises.
 */
export function tube(centre: Pt[], above: number[], below: number[] = above): Pt[] {
  const n = centre.length
  const up = resample(above, n)
  const down = resample(below, n)
  const left: Pt[] = []
  const right: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = centre[Math.max(0, i - 1)]!
    const b = centre[Math.min(n - 1, i + 1)]!
    const d = sub(b, a)
    const l = len(d) || 1
    const normal: Pt = [-d[1] / l, d[0] / l]
    left.push(add(centre[i]!, scaleP(normal, up[i]!)))
    right.push(add(centre[i]!, scaleP(normal, -down[i]!)))
  }
  return [...left, ...right.reverse()]
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, rotation = 0, n = 40): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push(rotate([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry], rotation, [cx, cy]))
  }
  return out
}

/** A straight limb segment with rounded ends, as a polygon. */
export function capsule(a: Pt, b: Pt, ra: number, rb: number, n = 10): Pt[] {
  const d = sub(b, a)
  const ang = Math.atan2(d[1], d[0])
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) out.push(polar(b, ang - Math.PI / 2 + (i / n) * Math.PI, rb))
  for (let i = 0; i <= n; i++) out.push(polar(a, ang + Math.PI / 2 + (i / n) * Math.PI, ra))
  return out
}

export function mapPts(pts: Pt[], f: (p: Pt) => Pt): Pt[] {
  return pts.map(f)
}

/**
 * Move every point. When the move is a change of units (millimetres to metres,
 * metres to pixels), pass the scale as `strokeScale` too: stroke widths are in
 * the shape's units, and forgetting them turns a 1.2 mm banana ridge into a
 * 1.2 m yellow smear.
 */
export function mapShapes(shapes: Shape[], f: (p: Pt) => Pt, strokeScale = 1): Shape[] {
  return shapes.map((s) => ({
    ...s,
    pts: s.pts.map(f),
    ...(s.strokeWidth !== undefined ? { strokeWidth: s.strokeWidth * strokeScale } : {}),
  }))
}

/** Mirror left-right about x = 0. Reverses winding, which a fill does not care about. */
export function mirrorX(shapes: Shape[]): Shape[] {
  return mapShapes(shapes, ([x, y]) => [-x, y])
}

export function bounds(shapes: Shape[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of shapes) {
    for (const [x, y] of s.pts) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  return { x0, y0, x1, y1 }
}

/** Length of a polyline. */
export function pathLength(pts: Pt[]): number {
  let total = 0
  for (let i = 1; i < pts.length; i++) total += len(sub(pts[i]!, pts[i - 1]!))
  return total
}

// ---------------------------------------------------------------------------
// The painter. The only function in the art modules that touches a canvas.
// ---------------------------------------------------------------------------

export function tracePath(ctx: CanvasRenderingContext2D, pts: Pt[], smooth: boolean, closed: boolean) {
  if (pts.length < 2) return
  if (!smooth || pts.length < 3) {
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1])
    if (closed) ctx.closePath()
    return
  }
  // Quadratic curves through edge midpoints, with the points as control points.
  const n = pts.length
  if (closed) {
    const m0 = lerp(pts[n - 1]!, pts[0]!, 0.5)
    ctx.moveTo(m0[0], m0[1])
    for (let i = 0; i < n; i++) {
      const p = pts[i]!
      const m = lerp(p, pts[(i + 1) % n]!, 0.5)
      ctx.quadraticCurveTo(p[0], p[1], m[0], m[1])
    }
    ctx.closePath()
  } else {
    ctx.moveTo(pts[0]![0], pts[0]![1])
    for (let i = 1; i < n - 1; i++) {
      const m = lerp(pts[i]!, pts[i + 1]!, 0.5)
      ctx.quadraticCurveTo(pts[i]![0], pts[i]![1], m[0], m[1])
    }
    ctx.lineTo(pts[n - 1]![0], pts[n - 1]![1])
  }
}

export function fillShapes(ctx: CanvasRenderingContext2D, shapes: Shape[]) {
  for (const s of shapes) {
    const closed = s.closed !== false
    ctx.beginPath()
    tracePath(ctx, s.pts, s.smooth !== false, closed)
    ctx.globalAlpha = s.alpha ?? 1
    if (s.fill && closed) {
      ctx.fillStyle = s.fill
      ctx.fill()
    }
    if (s.stroke) {
      ctx.strokeStyle = s.stroke
      ctx.lineWidth = s.strokeWidth ?? 1
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}
