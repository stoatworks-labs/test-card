/**
 * The idle patterns' linear algebra and hashing: a port of Idler's `Vec.h` and
 * `Hash.h` (~/Projects/resolume/idler), by way of its browser demo's port.
 *
 * Matrices are column-major, like GL: `m[c * 4 + r]` is row r of column c, so a
 * Float32Array goes to `uniformMatrix4fv` as it is.
 *
 * The hash is an exact 32-bit integer hash rather than `fract(sin(x) * 43758)`,
 * and every step is forced back into 32 bits (`>>> 0`, `Math.imul`). 3D Pipes
 * and 3D Maze are REPLAYED from the seed, so a hash that lost its low bits to a
 * double would not shift a pixel: it would grow a different, perfectly
 * plausible maze. `random.ts` is the generator for everything else in
 * `src/patterns/`; this one is Idler's, kept so the savers draw what Idler draws.
 */

export type V3 = { x: number; y: number; z: number }
export type V4 = { x: number; y: number; z: number; w: number }
export type V2 = { x: number; y: number }
export type M4 = Float32Array

export const PI = Math.PI
export const TAU = Math.PI * 2

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z })
export const v4 = (x: number, y: number, z: number, w: number): V4 => ({ x, y, z, w })

export const add3 = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const mul3 = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const dot3 = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const cross3 = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
export const length3 = (v: V3): number => Math.sqrt(dot3(v, v))
export const lerp3 = (a: V3, b: V3, t: number): V3 => add3(a, mul3(sub3(b, a), t))

/** Normalise, tolerating a zero vector: a NaN normal poisons the lighting of every vertex that shares it. */
export function normalise3(v: V3): V3 {
  const len = length3(v)
  return len < 1e-12 ? { x: 0, y: 0, z: 1 } : mul3(v, 1 / len)
}

export function normaliseSafe2(v: V2): V2 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y)
  return len < 1e-9 ? { x: 1, y: 0 } : { x: v.x / len, y: v.y / len }
}

/** Perpendicular to a 2D direction, left-hand side. */
export const perp2 = (d: V2): V2 => ({ x: -d.y, y: d.x })

export function mat4Identity(): M4 {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

export function mat4Translate(t: V3): M4 {
  const m = mat4Identity()
  m[12] = t.x
  m[13] = t.y
  m[14] = t.z
  return m
}

export function mat4Scale(s: V3): M4 {
  const m = mat4Identity()
  m[0] = s.x
  m[5] = s.y
  m[10] = s.z
  return m
}

export function mat4RotateX(radians: number): M4 {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  const m = mat4Identity()
  m[5] = c
  m[6] = s
  m[9] = -s
  m[10] = c
  return m
}

export function mat4RotateY(radians: number): M4 {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  const m = mat4Identity()
  m[0] = c
  m[2] = -s
  m[8] = s
  m[10] = c
  return m
}

export function mat4RotateZ(radians: number): M4 {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  const m = mat4Identity()
  m[0] = c
  m[1] = s
  m[4] = -s
  m[5] = c
  return m
}

/**
 * A rotation taking +Z onto `dir`. The up hint is chosen away from `dir`: a pipe
 * going straight up is exactly where a fixed +Y up degenerates, and pipes go
 * straight up constantly.
 */
export function mat4AlignZTo(dir: V3): M4 {
  const f = normalise3(dir)
  const hint = Math.abs(f.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0)
  const r = normalise3(cross3(hint, f))
  const u = cross3(f, r)
  const out = mat4Identity()
  out[0] = r.x
  out[1] = r.y
  out[2] = r.z
  out[4] = u.x
  out[5] = u.y
  out[6] = u.z
  out[8] = f.x
  out[9] = f.y
  out[10] = f.z
  return out
}

export function mat4LookAt(eye: V3, centre: V3, up: V3): M4 {
  const f = normalise3(sub3(centre, eye))
  const s = normalise3(cross3(f, up))
  const u = cross3(s, f)
  const r = mat4Identity()
  r[0] = s.x
  r[4] = s.y
  r[8] = s.z
  r[1] = u.x
  r[5] = u.y
  r[9] = u.z
  r[2] = -f.x
  r[6] = -f.y
  r[10] = -f.z
  r[12] = -dot3(s, eye)
  r[13] = -dot3(u, eye)
  r[14] = dot3(f, eye)
  return r
}

/**
 * Perspective, `fovY` vertical and in radians. Vertical so a saver framed for the
 * height keeps its framing as the surface gets wider: a span of three outputs
 * sees more maze to the sides, not a closer one.
 */
export function mat4Perspective(fovY: number, aspect: number, nearZ: number, farZ: number): M4 {
  const t = 1 / Math.tan(fovY * 0.5)
  const r = new Float32Array(16)
  r[0] = t / aspect
  r[5] = t
  r[10] = (farZ + nearZ) / (nearZ - farZ)
  r[11] = -1
  r[14] = (2 * farZ * nearZ) / (nearZ - farZ)
  return r
}

export function mat4Ortho(l: number, r_: number, b: number, t: number, n: number, f: number): M4 {
  const r = mat4Identity()
  r[0] = 2 / (r_ - l)
  r[5] = 2 / (t - b)
  r[10] = -2 / (f - n)
  r[12] = -(r_ + l) / (r_ - l)
  r[13] = -(t + b) / (t - b)
  r[14] = -(f + n) / (f - n)
  return r
}

export function mat4Mul(a: M4, b: M4): M4 {
  const r = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[c * 4 + k]!
      r[c * 4 + row] = sum
    }
  }
  return r
}

/** Transform a point (w = 1). */
export function mat4Point(m: M4, v: V3): V3 {
  return {
    x: m[0]! * v.x + m[4]! * v.y + m[8]! * v.z + m[12]!,
    y: m[1]! * v.x + m[5]! * v.y + m[9]! * v.z + m[13]!,
    z: m[2]! * v.x + m[6]! * v.y + m[10]! * v.z + m[14]!,
  }
}

/** Transform a direction: rotation and scale, no translation. */
export function mat4Direction(m: M4, v: V3): V3 {
  return {
    x: m[0]! * v.x + m[4]! * v.y + m[8]! * v.z,
    y: m[1]! * v.x + m[5]! * v.y + m[9]! * v.z,
    z: m[2]! * v.x + m[6]! * v.y + m[10]! * v.z,
  }
}

/** HSV to RGB, hue in turns. */
export function hsvToRgb(hueTurns: number, s: number, v: number): V3 {
  const h = (hueTurns - Math.floor(hueTurns)) * 6
  const i = Math.floor(h)
  const f = h - i
  const p = v * (1 - s)
  const q = v * (1 - s * f)
  const t = v * (1 - s * (1 - f))
  switch (i) {
    case 0:
      return v3(v, t, p)
    case 1:
      return v3(q, v, p)
    case 2:
      return v3(p, v, t)
    case 3:
      return v3(p, q, v)
    case 4:
      return v3(t, p, v)
    default:
      return v3(v, p, q)
  }
}

/** A triangle wave on 0..1 with period 1: every bounce here is one, so a bounce is a function of time. */
export function triangleWave(t: number): number {
  const f = t - Math.floor(t)
  return f < 0.5 ? f * 2 : 2 - f * 2
}

export function hash32(x: number): number {
  x = x >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  x = Math.imul(x, 0x7feb352d) >>> 0
  x = (x ^ (x >>> 15)) >>> 0
  x = Math.imul(x, 0x846ca68b) >>> 0
  x = (x ^ (x >>> 16)) >>> 0
  return x >>> 0
}

/** Hash2(index, seed), so nudging the seed reshuffles rather than rotates. */
export function hash2(a: number, b: number): number {
  return hash32((a ^ hash32((b + 0x9e3779b9) >>> 0)) >>> 0)
}

export function hash3(a: number, b: number, c: number): number {
  return hash32((hash2(a, b) ^ hash32((c + 0x85ebca6b) >>> 0)) >>> 0)
}

/** A hash to 0..1, from its top 24 bits: the widest slice a float32 holds exactly. */
export const unit = (h: number): number => (h >>> 8) * (1 / 16777216)

/**
 * A counter-based stream: draw n is Hash2(n, seed) and depends on nothing before
 * it, so a replay resumed from tick 400 draws what a replay from 0 would have.
 */
export class Random {
  seed: number
  counter = 0

  constructor(seed = 1) {
    this.seed = seed >>> 0
  }

  reset(seed: number) {
    this.seed = seed >>> 0
    this.counter = 0
  }

  next(): number {
    const h = hash2(this.counter >>> 0, this.seed)
    this.counter = (this.counter + 1) >>> 0
    return h
  }

  unit01(): number {
    return unit(this.next())
  }

  /** A whole number in [0, n). */
  below(n: number): number {
    return n <= 1 ? 0 : this.next() % (n >>> 0)
  }
}
