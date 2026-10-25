/**
 * The OpenGL savers that are pure arithmetic on time — 3D Flying Objects, 3D
 * FlowerBox and 3D Text — and the teapot 3D Pipes borrows. A port of Idler's,
 * with every rate fitted to the loop (see `common.ts`).
 */

import { countFromDensity, fitSpread, orbit, radians, settingsColour, turns, type IdleSettings, type Saver } from './common'
import { getGlyph, isSmall, measureText, SMALL_CAP_SCALE } from './font'
import {
  hash2,
  hsvToRgb,
  mat4AlignZTo,
  mat4Direction,
  mat4LookAt,
  mat4Mul,
  mat4Perspective,
  mat4Point,
  mat4RotateX,
  mat4RotateY,
  mat4RotateZ,
  mat4Scale,
  mat4Translate,
  mul3,
  normalise3,
  normaliseSafe2,
  perp2,
  PI,
  sub3,
  TAU,
  unit,
  v3,
  type M4,
  type V2,
  type V3,
  type V4,
} from './maths'
import { Shading, type Mesh, type Scene } from './scene'

// ---------------------------------------------------------------------------
// The teapot: a revolved profile, small enough to drop where a ball would go
// ---------------------------------------------------------------------------

const TEAPOT_AROUND = 12

const TEAPOT_PROFILE: V2[] = [
  { x: 0, y: 0.02 },
  { x: 0.26, y: 0 },
  { x: 0.44, y: 0.04 },
  { x: 0.6, y: 0.14 },
  { x: 0.72, y: 0.3 },
  { x: 0.75, y: 0.44 },
  { x: 0.7, y: 0.56 },
  { x: 0.6, y: 0.64 },
  { x: 0.52, y: 0.68 },
  { x: 0.56, y: 0.7 }, // the rim, flaring back out
  { x: 0.54, y: 0.72 },
]

const TEAPOT_LID: V2[] = [
  { x: 0.54, y: 0.72 },
  { x: 0.48, y: 0.78 },
  { x: 0.34, y: 0.83 },
  { x: 0.16, y: 0.85 },
  { x: 0.07, y: 0.86 },
  { x: 0.07, y: 0.92 },
  { x: 0.15, y: 0.97 },
  { x: 0.09, y: 1 },
  { x: 0, y: 1 },
]

const UP = v3(0, 1, 0)

/** Revolve a profile about Y. Normals come from smoothNormals, which keeps the crease at the rim. */
function revolve(mesh: Mesh, transform: M4, profile: V2[], scale: number, colour: V4) {
  const base = mesh.mark()
  for (const p of profile) {
    for (let a = 0; a <= TEAPOT_AROUND; a++) {
      const angle = (TAU * (a % TEAPOT_AROUND)) / TEAPOT_AROUND
      mesh.addVertex(mat4Point(transform, v3(p.x * Math.cos(angle) * scale, p.y * scale, p.x * Math.sin(angle) * scale)), UP, colour)
    }
  }
  const stride = TEAPOT_AROUND + 1
  for (let i = 0; i + 1 < profile.length; i++) {
    for (let a = 0; a < TEAPOT_AROUND; a++) {
      const v = base + i * stride + a
      mesh.addQuad(v, v + stride, v + stride + 1, v + 1)
    }
  }
}

/** A tapering tube along a path: the spout and the handle. */
function sweep(mesh: Mesh, transform: M4, path: V3[], startRadius: number, endRadius: number, colour: V4) {
  if (path.length < 2) return
  const sides = 8
  const base = mesh.mark()
  path.forEach((point, i) => {
    const forward = normalise3(
      i === 0
        ? sub3(path[1]!, path[0]!)
        : i + 1 === path.length
          ? sub3(point, path[i - 1]!)
          : sub3(path[i + 1]!, path[i - 1]!),
    )
    const frame = mat4Mul(mat4Translate(point), mat4AlignZTo(forward))
    const radius = startRadius + (endRadius - startRadius) * (i / (path.length - 1))
    for (let a = 0; a <= sides; a++) {
      const angle = (TAU * (a % sides)) / sides
      mesh.addVertex(mat4Point(transform, mat4Point(frame, v3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0))), UP, colour)
    }
  })
  const stride = sides + 1
  for (let i = 0; i + 1 < path.length; i++) {
    for (let a = 0; a < sides; a++) {
      const v = base + i * stride + a
      mesh.addQuad(v, v + stride, v + stride + 1, v + 1)
    }
  }
}

/** A teapot within `scale` of the origin, centred on its mass, so it sits where a ball would. */
export function addTeapot(mesh: Mesh, transform: M4, scale: number, colour: V4) {
  const u = scale * 0.9
  const place = mat4Mul(transform, mat4Translate(v3(0, -u * 0.45, 0)))
  const start = mesh.mark()
  revolve(mesh, place, TEAPOT_PROFILE, u, colour)
  revolve(mesh, place, TEAPOT_LID, u, colour)
  const spout = [v3(0.55, 0.3, 0), v3(0.8, 0.36, 0), v3(1, 0.52, 0), v3(1.08, 0.72, 0), v3(1.06, 0.82, 0)].map((p) => mul3(p, u))
  sweep(mesh, place, spout, 0.17 * u, 0.07 * u, colour)
  const handle: V3[] = []
  for (let i = 0; i <= 8; i++) {
    const angle = PI * (0.15 + (i / 8) * 0.7)
    handle.push(v3(-(0.48 + 0.36 * Math.sin(angle)) * u, (0.3 + 0.38 * (1 - Math.cos(angle))) * u, 0))
  }
  sweep(mesh, place, handle, 0.09 * u, 0.09 * u, colour)
  mesh.smoothNormals(start)
}

// ---------------------------------------------------------------------------
// 3D Flying Objects
// ---------------------------------------------------------------------------

const Solid = { Box: 0, Sphere: 1, Cylinder: 2, Torus: 3, Teapot: 4, Count: 5 } as const

/**
 * Lit solids tumbling through space. Each position is three sines at rates from
 * the object's hash — a Lissajous in 3D — fitted to the loop by chance so the
 * paths stay a family without any two being one. They pass through each other,
 * as the original's did.
 *
 * Density = objects. Complexity = which solids are in the mix. Size. Length = how
 * deep the volume is. Variation = spread in size and tumble.
 */
export class FlyingObjects implements Saver {
  build(s: IdleSettings, scene: Scene) {
    const depth = 3 + s.length * 9
    FlyingObjects.setCamera(s, scene, depth)
    const count = countFromDensity(s.density, 1, 24)
    const available = 1 + Math.trunc(s.complexity * (Solid.Count - 1) + 0.5)
    const baseSize = 0.15 + s.size * 0.5
    const spread = 1.6 + s.length * 2.5

    for (let i = 0; i < count; i++) {
      const h = hash2(i >>> 0, s.seed)
      const wobble = (rate: number, salt: number, phase: number) =>
        Math.sin(TAU * s.time * fitSpread(s, rate, unit(hash2(h, salt))) + phase)
      const position = v3(
        wobble(0.05 + unit(hash2(h, 0x11)) * 0.06, 0xb1, unit(hash2(h, 0x44)) * TAU) * spread * s.aspect * 0.6,
        wobble(0.05 + unit(hash2(h, 0x22)) * 0.06, 0xb2, unit(hash2(h, 0x55)) * TAU) * spread * 0.6,
        -depth * 0.5 + wobble(0.04 + unit(hash2(h, 0x33)) * 0.05, 0xb3, unit(hash2(h, 0x66)) * TAU) * depth * 0.35,
      )
      const tumble = 0.4 + unit(hash2(h, 0x77)) * s.variation * 2
      const orientation = mat4Mul(
        mat4Mul(mat4RotateY(radians(s, tumble * 0.7)), mat4RotateX(radians(s, tumble * 0.43))),
        mat4RotateZ(radians(s, tumble * 0.29)),
      )
      const size = baseSize * (1 - s.variation * 0.6 * unit(hash2(h, 0x88)))
      const place = mat4Mul(mat4Translate(position), orientation)
      const solid = hash2(h, 0x99) % (available >>> 0)
      const colour = settingsColour(s, hsvToRgb(unit(hash2(h, 0xaa)), 0.7, 1), i, count)

      switch (solid) {
        case Solid.Box:
          scene.mesh.addTransformedBox(place, v3(size, size, size), colour)
          break
        case Solid.Sphere:
          scene.mesh.addSphere(place, size, 10, 16, colour)
          break
        case Solid.Cylinder:
          // Back half its length, so it tumbles about its middle rather than swinging round one end.
          scene.mesh.addCylinder(mat4Mul(place, mat4Translate(v3(0, 0, -size))), size * 0.6, size * 2, 14, colour, true, true)
          break
        case Solid.Torus:
          scene.mesh.addTorus(place, size, size * 0.38, 20, 10, colour)
          break
        default:
          addTeapot(scene.mesh, place, size * 1.3, colour)
      }
    }
  }

  static setCamera(s: IdleSettings, scene: Scene, depth: number) {
    scene.depthTest = true
    scene.shading = s.shading === Shading.Flat ? Shading.Lit : s.shading
    const back = 0.5 + s.camDistance * 3
    scene.view = mat4LookAt(v3(0, Math.sin(s.camTilt) * back, back), v3(0, 0, -depth * 0.4), UP)
    scene.proj = mat4Perspective(s.fov, Math.max(0.01, s.aspect), 0.05, depth * 4 + 10)
    if (s.fog > 0.001) {
      scene.fogStart = back + depth * (0.2 + (1 - s.fog) * 0.6)
      scene.fogEnd = back + depth * 1.3
    }
  }
}

// ---------------------------------------------------------------------------
// 3D FlowerBox
// ---------------------------------------------------------------------------

/**
 * A solid on the spot, turning over, its surface swelling between a box, a ball
 * and a many-lobed flower. Idler picks two morph rates that do not divide into
 * each other so the pair never returns to one pose; in a loop they must, so
 * here both do whole cycles and the camera does whole turns.
 *
 * Complexity = lobes. Size. Length = how far the morph goes. Density = surface
 * resolution. Variation = the first morph's rate.
 */
export class FlowerBox implements Saver {
  build(s: IdleSettings, scene: Scene) {
    FlowerBox.setCamera(s, scene)
    const segments = 12 + Math.trunc(s.density * 36 + 0.5)
    const rings = Math.trunc(segments / 2) + 2
    const lobes = 2 + s.complexity * 7
    const reach = s.length * 0.55
    const scale = 0.4 + s.size * 0.9
    const flower = Math.sin(radians(s, 0.11 * (0.6 + s.variation))) * reach
    const boxness = (Math.sin(radians(s, 0.077)) * 0.5 + 0.5) * reach
    const hue = turns(s, 0.03)
    const start = scene.mesh.mark()

    for (let r = 0; r <= rings; r++) {
      const phi = (PI * r) / rings
      const sp = Math.sin(phi)
      const cp = Math.cos(phi)
      for (let a = 0; a <= segments; a++) {
        const theta = (TAU * (a % segments)) / segments
        const direction = v3(sp * Math.cos(theta), cp, sp * Math.sin(theta))
        let radius = 1 + flower * Math.sin(lobes * theta) * Math.sin(lobes * phi)
        // Over the Chebyshev norm pushes the unit sphere onto the unit cube: a morph continuous at the corners.
        const chebyshev = Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z))
        if (chebyshev > 1e-4) radius = radius * (1 - boxness) + (radius / chebyshev) * boxness
        // Colour follows direction, so it stays put on the surface as the shape swells.
        const classic = hsvToRgb(theta / TAU + hue, 0.55 + 0.35 * Math.abs(cp), 1)
        scene.mesh.addVertex(mul3(direction, radius * scale), direction, settingsColour(s, classic, a, segments))
      }
    }
    const stride = segments + 1
    for (let r = 0; r < rings; r++) {
      for (let a = 0; a < segments; a++) {
        const v = start + r * stride + a
        scene.mesh.addQuad(v, v + stride, v + stride + 1, v + 1)
      }
    }
    // Accumulated rather than analytic: where the morph folds through itself the analytic normal points into the fold.
    scene.mesh.smoothNormals(start)
  }

  static setCamera(s: IdleSettings, scene: Scene) {
    scene.depthTest = true
    scene.shading = s.shading === Shading.Flat ? Shading.Lit : s.shading
    const distance = 2.4 + s.camDistance * 3
    // Turning over is the point of this one, so it gets whole turns even on a short loop.
    const angle = radians(s, 0.13)
    const eye = v3(Math.sin(angle) * distance, Math.sin(s.camTilt) * distance, Math.cos(angle) * distance)
    scene.view = mat4LookAt(eye, v3(0, 0, 0), UP)
    scene.proj = mat4Perspective(s.fov, Math.max(0.01, s.aspect), 0.05, 40)
    if (s.fog > 0.001) {
      scene.fogStart = distance * 0.7
      scene.fogEnd = distance * (1.4 + (1 - s.fog) * 2)
    }
  }
}

// ---------------------------------------------------------------------------
// 3D Text
// ---------------------------------------------------------------------------

/** Load-bearing: an unlimited mitre on the apex of an A drags a solid spike across the frame. */
const TEXT_MITRE_LIMIT = 4

function offsetStroke(stroke: V2[], half: number): { left: V2[]; right: V2[] } {
  const count = stroke.length
  const left: V2[] = []
  const right: V2[] = []
  for (let i = 0; i < count; i++) {
    const here = stroke[i]!
    const prev = stroke[i - 1]
    const next = stroke[i + 1]
    const prevDir = prev
      ? normaliseSafe2({ x: here.x - prev.x, y: here.y - prev.y })
      : normaliseSafe2({ x: stroke[1]!.x - here.x, y: stroke[1]!.y - here.y })
    const nextDir = next
      ? normaliseSafe2({ x: next.x - here.x, y: next.y - here.y })
      : normaliseSafe2({ x: here.x - prev!.x, y: here.y - prev!.y })
    const nPrev = perp2(prevDir)
    const nNext = perp2(nextDir)
    let mitre = normaliseSafe2({ x: nPrev.x + nNext.x, y: nPrev.y + nNext.y })
    const cosHalf = mitre.x * nPrev.x + mitre.y * nPrev.y
    let scale = Math.abs(cosHalf) < 1e-4 ? TEXT_MITRE_LIMIT : 1 / cosHalf
    if (scale > TEXT_MITRE_LIMIT || scale < -TEXT_MITRE_LIMIT) {
      mitre = nNext
      scale = 1
    }
    const ox = mitre.x * half * scale
    const oy = mitre.y * half * scale
    left.push({ x: here.x + ox, y: here.y + oy })
    right.push({ x: here.x - ox, y: here.y - oy })
  }
  return { left, right }
}

/** A stroke as a closed slab in the XY plane, extruded to +-`depth`: faces, walls and end caps. */
function addSlab(mesh: Mesh, transform: M4, stroke: V2[], half: number, depth: number, colour: V4) {
  const { left, right } = offsetStroke(stroke, half)
  const count = left.length
  if (count < 2) return
  const place = (p: V2, z: number) => mat4Point(transform, v3(p.x, p.y, z))
  const front = normalise3(mat4Direction(transform, v3(0, 0, 1)))
  const back = mul3(front, -1)
  const quad = (a: V3, b: V3, c: V3, d: V3, n: V3) => {
    const base = mesh.mark()
    mesh.addVertex(a, n, colour)
    mesh.addVertex(b, n, colour)
    mesh.addVertex(c, n, colour)
    mesh.addVertex(d, n, colour)
    mesh.addQuad(base, base + 1, base + 2, base + 3)
  }

  for (let i = 0; i + 1 < count; i++) {
    quad(place(left[i]!, depth), place(right[i]!, depth), place(right[i + 1]!, depth), place(left[i + 1]!, depth), front)
    quad(place(left[i]!, -depth), place(left[i + 1]!, -depth), place(right[i + 1]!, -depth), place(right[i]!, -depth), back)
  }

  const wall = (edge: V2[], flip: boolean) => {
    for (let i = 0; i + 1 < count; i++) {
      const a = edge[i]!
      const b = edge[i + 1]!
      let out = perp2(normaliseSafe2({ x: b.x - a.x, y: b.y - a.y }))
      if (flip) out = { x: -out.x, y: -out.y }
      quad(place(a, -depth), place(b, -depth), place(b, depth), place(a, depth), normalise3(mat4Direction(transform, v3(out.x, out.y, 0))))
    }
  }
  wall(left, false)
  wall(right, true)

  // End caps, or a letter reads as hollow the moment it turns edge-on.
  const cap = (index: number, atStart: boolean) => {
    const a = atStart ? stroke[0]! : stroke[count - 1]!
    const b = atStart ? stroke[1]! : stroke[count - 2]!
    const along = normaliseSafe2({ x: a.x - b.x, y: a.y - b.y })
    const l = left[index]!
    const r = right[index]!
    quad(place(l, -depth), place(r, -depth), place(r, depth), place(l, depth), normalise3(mat4Direction(transform, v3(along.x, along.y, 0))))
  }
  cap(0, true)
  cap(count - 1, false)
}

/**
 * Lettering with real depth, turning on the spot. The font is strokes down the
 * middle of each letter, so each stroke becomes a slab: offset either side by
 * half the weight, then given faces, walls and caps.
 *
 * Size = cap height. Line Width = weight. Length = depth. Complexity = how far
 * it rolls beyond a plain spin. Density = copies in depth. Variation = their hue spread.
 */
export class Text3D implements Saver {
  build(s: IdleSettings, scene: Scene) {
    scene.depthTest = true
    scene.shading = s.shading === Shading.Flat ? Shading.Lit : s.shading
    const message = s.text.length > 0 ? s.text : 'Test Card'
    const capHeight = 0.35 + s.size * 1.1
    const weight = (0.05 + s.lineWidth * 0.16) * capHeight
    const depth = (0.03 + s.length * 0.35) * capHeight
    const textWidth = measureText(message) * capHeight
    // Framed off the text's own width, so a long message is pulled back to fit.
    const distance = (1.2 + s.camDistance * 2.5) * Math.max(1, textWidth / (2.2 * Math.max(0.5, s.aspect))) + capHeight

    scene.view = mat4LookAt(v3(0, Math.sin(s.camTilt) * distance * 0.5, distance), v3(0, 0, 0), UP)
    scene.proj = mat4Perspective(s.fov, Math.max(0.01, s.aspect), 0.05, distance * 6)
    if (s.fog > 0.001) {
      scene.fogStart = distance * 0.6
      scene.fogEnd = distance * (1.5 + (1 - s.fog) * 3)
    }

    const copies = countFromDensity(s.density, 1, 8)
    const roll = s.complexity
    const tumble = mat4Mul(
      mat4Mul(mat4RotateY(orbit(s, 0.5)), mat4RotateX(Math.sin(radians(s, 0.31)) * roll * 0.6)),
      mat4RotateZ(Math.sin(radians(s, 0.23)) * roll * 0.4),
    )
    const hue = turns(s, 0.05)

    for (let copy = 0; copy < copies; copy++) {
      const place = mat4Mul(tumble, mat4Translate(v3(-textWidth * 0.5, -capHeight * 0.5, -copy * capHeight * 0.9)))
      const fraction = copies > 1 ? copy / (copies - 1) : 0
      const colour = settingsColour(s, hsvToRgb(hue + fraction * s.variation, 0.55, 1 - fraction * 0.5), copy, copies)
      let pen = 0
      for (const c of message) {
        const scale = capHeight * (isSmall(c) ? SMALL_CAP_SCALE : 1)
        const glyph = getGlyph(c)
        for (const stroke of glyph.strokes) {
          // The scale goes in the transform, which keeps the extrusion in the letter's units.
          const glyphPlace = mat4Mul(mat4Mul(place, mat4Translate(v3(pen, 0, 0))), mat4Scale(v3(scale, scale, scale)))
          addSlab(scene.mesh, glyphPlace, stroke, (weight / scale) * 0.5, depth / scale, colour)
        }
        pen += glyph.advance * scale
      }
    }
  }
}
