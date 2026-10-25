/**
 * What a saver hands back, and the only thing the renderer knows how to draw: a
 * port of Idler's `Scene.h` and `Mesh.cpp`.
 *
 * A saver never touches GL. It fills a `Scene` — a camera, a shading mode and
 * one triangle mesh — and `gl.ts` draws that in one call.
 *
 * EVERYTHING IS TRIANGLES, LINES INCLUDED. WebGL2 only promises a line width of
 * 1, and the whole look of Mystify is a fat ribbon, so a line is real geometry.
 *
 * Positions, normals and colours are flat arrays rather than objects: the mesh is
 * rebuilt every frame at up to a few hundred thousand vertices.
 */

import {
  mat4Direction,
  mat4Identity,
  mat4Point,
  mat4Translate,
  normalise3,
  normaliseSafe2,
  mul3,
  perp2,
  PI,
  TAU,
  v3,
  v4,
  type M4,
  type V2,
  type V3,
  type V4,
} from './maths'

/** As Scene.h's enum. Wireframe draws each triangle's edges, in pixels, from barycentrics. */
export const Shading = { Flat: 0, Lit: 1, Wireframe: 2 } as const
export type ShadingMode = (typeof Shading)[keyof typeof Shading]

const FLAT_NORMAL = v3(0, 0, 1)

export class Mesh {
  px: number[] = []
  py: number[] = []
  pz: number[] = []
  nx: number[] = []
  ny: number[] = []
  nz: number[] = []
  cr: number[] = []
  cg: number[] = []
  cb: number[] = []
  ca: number[] = []
  indices: number[] = []

  get empty(): boolean {
    return this.indices.length === 0
  }

  /** Index of the next vertex to be added. */
  mark(): number {
    return this.px.length
  }

  addVertex(p: V3, n: V3, c: V4) {
    this.px.push(p.x)
    this.py.push(p.y)
    this.pz.push(p.z)
    this.nx.push(n.x)
    this.ny.push(n.y)
    this.nz.push(n.z)
    this.cr.push(c.x)
    this.cg.push(c.y)
    this.cb.push(c.z)
    this.ca.push(c.w)
  }

  addTriangle(a: number, b: number, c: number) {
    this.indices.push(a, b, c)
  }

  /** Two triangles over four already-added vertices, wound a-b-c-d. */
  addQuad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, b, c, a, c, d)
  }

  // --- flat builders, for the 2D savers: depth test off, draw order is index order ---

  /** A thick segment in the XY plane. `width` is the FULL width, half of it either side. */
  addLine(a: V2, b: V2, width: number, colourA: V4, colourB: V4) {
    const pn = perp2(normaliseSafe2({ x: b.x - a.x, y: b.y - a.y }))
    const n = { x: pn.x * width * 0.5, y: pn.y * width * 0.5 }
    const base = this.mark()
    this.addVertex(v3(a.x - n.x, a.y - n.y, 0), FLAT_NORMAL, colourA)
    this.addVertex(v3(a.x + n.x, a.y + n.y, 0), FLAT_NORMAL, colourA)
    this.addVertex(v3(b.x + n.x, b.y + n.y, 0), FLAT_NORMAL, colourB)
    this.addVertex(v3(b.x - n.x, b.y - n.y, 0), FLAT_NORMAL, colourB)
    this.addQuad(base, base + 1, base + 2, base + 3)
  }

  /**
   * A polyline with mitred joins. Separate quads leave a notch outside every
   * corner, and a Mystify polygon is nothing but corners. Past four widths the
   * mitre would shoot a spike across the frame, so it falls back to a bevel.
   */
  addPolyline(points: V2[], count: number, closed: boolean, width: number, colours: V4[]) {
    if (count < 2) return
    const half = width * 0.5
    const MITRE_LIMIT = 4
    const segments = closed ? count : count - 1
    const base = this.mark()

    for (let i = 0; i < count; i++) {
      const here = points[i]!
      const hasPrev = closed || i > 0
      const hasNext = closed || i < count - 1
      const prev = points[(i - 1 + count) % count]!
      const next = points[(i + 1) % count]!
      const prevDir = hasPrev
        ? normaliseSafe2({ x: here.x - prev.x, y: here.y - prev.y })
        : normaliseSafe2({ x: next.x - here.x, y: next.y - here.y })
      const nextDir = hasNext
        ? normaliseSafe2({ x: next.x - here.x, y: next.y - here.y })
        : normaliseSafe2({ x: here.x - prev.x, y: here.y - prev.y })

      // The mitre bisects the two segment normals; 1/cos(theta/2) makes the outer edges meet.
      const nPrev = perp2(prevDir)
      const nNext = perp2(nextDir)
      let mitre = normaliseSafe2({ x: nPrev.x + nNext.x, y: nPrev.y + nNext.y })
      const cosHalf = mitre.x * nPrev.x + mitre.y * nPrev.y
      let scale = Math.abs(cosHalf) < 1e-4 ? MITRE_LIMIT : 1 / cosHalf
      if (scale > MITRE_LIMIT || scale < -MITRE_LIMIT) {
        mitre = nNext
        scale = 1
      }
      const ox = mitre.x * half * scale
      const oy = mitre.y * half * scale
      const colour = colours[i] ?? v4(1, 1, 1, 1)
      this.addVertex(v3(here.x - ox, here.y - oy, 0), FLAT_NORMAL, colour)
      this.addVertex(v3(here.x + ox, here.y + oy, 0), FLAT_NORMAL, colour)
    }

    for (let s = 0; s < segments; s++) {
      const i0 = base + s * 2
      const i1 = base + ((s + 1) % count) * 2
      this.addQuad(i0, i0 + 1, i1 + 1, i1)
    }
  }

  addRect(min: V2, max: V2, colour: V4) {
    const base = this.mark()
    this.addVertex(v3(min.x, min.y, 0), FLAT_NORMAL, colour)
    this.addVertex(v3(max.x, min.y, 0), FLAT_NORMAL, colour)
    this.addVertex(v3(max.x, max.y, 0), FLAT_NORMAL, colour)
    this.addVertex(v3(min.x, max.y, 0), FLAT_NORMAL, colour)
    this.addQuad(base, base + 1, base + 2, base + 3)
  }

  // --- solid builders, for the 3D savers ---

  addBox(centre: V3, halfExtent: V3, colour: V4) {
    this.addTransformedBox(mat4Translate(centre), halfExtent, colour)
  }

  /** Flat shaded: each face has its own four vertices, or the corners average into a rounded die. */
  addTransformedBox(transform: M4, h: V3, colour: V4) {
    const corner = [
      v3(-h.x, -h.y, h.z),
      v3(h.x, -h.y, h.z),
      v3(h.x, h.y, h.z),
      v3(-h.x, h.y, h.z),
      v3(-h.x, -h.y, -h.z),
      v3(h.x, -h.y, -h.z),
      v3(h.x, h.y, -h.z),
      v3(-h.x, h.y, -h.z),
    ]
    for (let f = 0; f < 6; f++) {
      const base = this.mark()
      const n = normalise3(mat4Direction(transform, BOX_FACE_NORMALS[f]!))
      for (const c of BOX_FACE_CORNERS[f]!) this.addVertex(mat4Point(transform, corner[c]!), n, colour)
      this.addQuad(base, base + 1, base + 2, base + 3)
    }
  }

  /** A cylinder along +Z from 0 to `length`: smooth round the barrel, flat on the caps. */
  addCylinder(transform: M4, radius: number, length: number, sides: number, colour: V4, capStart: boolean, capEnd: boolean) {
    sides = Math.max(3, sides)
    const ringBase = this.mark()
    for (let i = 0; i <= sides; i++) {
      const a = (TAU * (i % sides)) / sides
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const n = normalise3(mat4Direction(transform, v3(ca, sa, 0)))
      this.addVertex(mat4Point(transform, v3(ca * radius, sa * radius, 0)), n, colour)
      this.addVertex(mat4Point(transform, v3(ca * radius, sa * radius, length)), n, colour)
    }
    for (let i = 0; i < sides; i++) {
      const a = ringBase + i * 2
      this.addQuad(a, a + 2, a + 3, a + 1)
    }

    const addCap = (z: number, facingPositiveZ: boolean) => {
      const n = normalise3(mat4Direction(transform, v3(0, 0, facingPositiveZ ? 1 : -1)))
      const base = this.mark()
      this.addVertex(mat4Point(transform, v3(0, 0, z)), n, colour)
      for (let i = 0; i < sides; i++) {
        const a = (TAU * i) / sides
        this.addVertex(mat4Point(transform, v3(Math.cos(a) * radius, Math.sin(a) * radius, z)), n, colour)
      }
      for (let i = 0; i < sides; i++) {
        const a = base + 1 + i
        const b = base + 1 + ((i + 1) % sides)
        if (facingPositiveZ) this.addTriangle(base, a, b)
        else this.addTriangle(base, b, a)
      }
    }
    if (capStart) addCap(0, false)
    if (capEnd) addCap(length, true)
  }

  addSphere(transform: M4, radius: number, rings: number, segments: number, colour: V4) {
    rings = Math.max(2, rings)
    segments = Math.max(3, segments)
    const base = this.mark()
    for (let r = 0; r <= rings; r++) {
      const phi = (PI * r) / rings
      const sp = Math.sin(phi)
      const cp = Math.cos(phi)
      for (let s = 0; s <= segments; s++) {
        const theta = (TAU * (s % segments)) / segments
        const local = v3(sp * Math.cos(theta), cp, sp * Math.sin(theta))
        this.addVertex(mat4Point(transform, mul3(local, radius)), normalise3(mat4Direction(transform, local)), colour)
      }
    }
    const stride = segments + 1
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        const a = base + r * stride + s
        const b = a + stride
        this.addQuad(a, b, b + 1, a + 1)
      }
    }
  }

  addTorus(transform: M4, major: number, minor: number, majorSegments: number, minorSegments: number, colour: V4) {
    majorSegments = Math.max(3, majorSegments)
    minorSegments = Math.max(3, minorSegments)
    const base = this.mark()
    for (let i = 0; i <= majorSegments; i++) {
      const u = (TAU * (i % majorSegments)) / majorSegments
      const cu = Math.cos(u)
      const su = Math.sin(u)
      for (let j = 0; j <= minorSegments; j++) {
        const w = (TAU * (j % minorSegments)) / minorSegments
        const cv = Math.cos(w)
        const sv = Math.sin(w)
        const n = v3(cu * cv, su * cv, sv)
        const p = v3(cu * (major + minor * cv), su * (major + minor * cv), minor * sv)
        this.addVertex(mat4Point(transform, p), normalise3(mat4Direction(transform, n)), colour)
      }
    }
    const stride = minorSegments + 1
    for (let i = 0; i < majorSegments; i++) {
      for (let j = 0; j < minorSegments; j++) {
        const a = base + i * stride + j
        const b = a + stride
        this.addQuad(a, a + 1, b + 1, b)
      }
    }
  }

  /**
   * Recompute normals by area-weighted accumulation over the faces sharing each
   * position: un-normalised face normals, so big faces outvote a morph's slivers.
   * Vertices at the EXACT same position share a normal, or the seam creases.
   */
  smoothNormals(fromVertex: number) {
    for (let i = fromVertex; i < this.px.length; i++) {
      this.nx[i] = 0
      this.ny[i] = 0
      this.nz[i] = 0
    }
    const accumulated = new Map<string, V3>()
    const key = (i: number) => `${this.px[i]},${this.py[i]},${this.pz[i]}`

    for (let t = 0; t + 2 < this.indices.length; t += 3) {
      const ia = this.indices[t]!
      const ib = this.indices[t + 1]!
      const ic = this.indices[t + 2]!
      if (ia < fromVertex) continue
      const ax = this.px[ia]!
      const ay = this.py[ia]!
      const az = this.pz[ia]!
      const bx = this.px[ib]! - ax
      const by = this.py[ib]! - ay
      const bz = this.pz[ib]! - az
      const cx = this.px[ic]! - ax
      const cy = this.py[ic]! - ay
      const cz = this.pz[ic]! - az
      const fx = by * cz - bz * cy
      const fy = bz * cx - bx * cz
      const fz = bx * cy - by * cx
      for (const index of [ia, ib, ic]) {
        const k = key(index)
        const acc = accumulated.get(k)
        if (acc) {
          acc.x += fx
          acc.y += fy
          acc.z += fz
        } else accumulated.set(k, { x: fx, y: fy, z: fz })
      }
    }

    for (let i = fromVertex; i < this.px.length; i++) {
      const n = normalise3(accumulated.get(key(i)) ?? v3(0, 0, 0))
      this.nx[i] = n.x
      this.ny[i] = n.y
      this.nz[i] = n.z
    }
  }
}

// Counter-clockwise seen from outside.
const BOX_FACE_NORMALS = [v3(0, 0, 1), v3(0, 0, -1), v3(1, 0, 0), v3(-1, 0, 0), v3(0, 1, 0), v3(0, -1, 0)]
const BOX_FACE_CORNERS = [
  [0, 1, 2, 3],
  [5, 4, 7, 6],
  [1, 5, 6, 2],
  [4, 0, 3, 7],
  [3, 2, 6, 7],
  [4, 5, 1, 0],
]

/** One frame's worth of everything the renderer needs. Rebuilt from scratch every frame. */
export class Scene {
  view: M4 = mat4Identity()
  proj: M4 = mat4Identity()
  mesh = new Mesh()
  depthTest = false
  shading: ShadingMode = Shading.Flat
  lightDirection: V3 = normalise3(v3(-0.35, -0.6, -0.72))
  ambient = 0.28
  /** Opaque, as RGB 0..1. Test Card's patterns cover their raster. */
  background: V3 = v3(0, 0, 0)
  /** View-space distances; off when end <= start. Fog fades to the background. */
  fogStart = 0
  fogEnd = 0
  /** How much of the picture shows over the background, 0..1: the maze fades round its restart. */
  fade = 1
}
