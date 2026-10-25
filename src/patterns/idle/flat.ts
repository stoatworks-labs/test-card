/**
 * The flat savers, the ones that shipped with Windows: Mystify, Beziers, Curves
 * and Colors, Flying Through Space, Flying Windows and Scrolling Marquee. A port
 * of Idler's, with every rate fitted to the loop (see `common.ts`).
 *
 * They draw through an orthographic camera where X runs -aspect..+aspect and Y
 * runs -1..+1: ONE UNIT IS HALF THE SURFACE'S HEIGHT, so a circle is round on
 * any aspect and a span of three outputs is one wide picture, not three.
 */

import { countFromDensity, fit, fitSpread, settingsColour, turns, type IdleSettings, type Saver } from './common'
import { getGlyph, isSmall, measureText, SMALL_CAP_SCALE } from './font'
import { hash2, hash3, hsvToRgb, mat4Identity, mat4Ortho, mul3, TAU, triangleWave, unit, v3, v4, type V2, type V3, type V4 } from './maths'
import { Shading, type Scene } from './scene'

export function setFlatCamera(s: IdleSettings, scene: Scene) {
  const halfWidth = Math.max(0.01, s.aspect)
  scene.proj = mat4Ortho(-halfWidth, halfWidth, -1, 1, -1, 1)
  scene.view = mat4Identity()
  scene.depthTest = false
  scene.shading = Shading.Flat
}

/**
 * A point bouncing inside the flat camera's box: each axis an independent
 * triangle wave, at a rate from the hash spread over about 3:2 and fitted to
 * the loop by chance (`fitSpread`), so the corners of one polygon do not all
 * keep step.
 */
function bouncePoint(s: IdleSettings, seed: number, index: number, time: number, rate: number, margin: number): V2 {
  const i = index >>> 0
  const rateX = fitSpread(s, rate * (0.8 + unit(hash3(i, seed, 0x1111)) * 0.5), unit(hash3(i, seed, 0x5151)))
  const rateY = fitSpread(s, rate * (0.8 + unit(hash3(i, seed, 0x2222)) * 0.5), unit(hash3(i, seed, 0x6161)))
  const phaseX = unit(hash3(i, seed, 0x3333))
  const phaseY = unit(hash3(i, seed, 0x4444))
  const halfWidth = Math.max(0.05, s.aspect - margin)
  const halfHeight = Math.max(0.05, 1 - margin)
  return {
    x: (triangleWave(time * rateX + phaseX) * 2 - 1) * halfWidth,
    y: (triangleWave(time * rateY + phaseY) * 2 - 1) * halfHeight,
  }
}

/**
 * One object flying out of the middle toward the viewer, as in Flying Through
 * Space and Flying Windows. Its depth wraps, so the field is full from frame 0.
 * Every object shares nearly one speed — in a real flight the perspective
 * divide supplies the difference — so the fitting rounds to the nearest rather
 * than spreading: on a short loop they all make the same number of runs.
 */
function flyingPoint(s: IdleSettings, index: number, time: number, rate: number) {
  const h = hash2(index >>> 0, s.seed)
  const angle = unit(h) * TAU
  const radius = 0.15 + unit(hash2(h, 0x5555)) * 0.85
  const offset = unit(hash2(h, 0x6666))
  const speed = fit(s, rate * (0.85 + unit(hash2(h, 0x7777)) * 0.3))
  let age = time * speed + offset
  age -= Math.floor(age)
  // Far to near, never reaching zero: an object of infinite size for one frame is a full-screen flash.
  const z = 1 + (0.06 - 1) * age
  const scale = 0.35 / z
  return { screen: { x: Math.cos(angle) * radius * scale, y: Math.sin(angle) * radius * scale }, scale, age }
}

const fade = (c: V4, by: number): V4 => v4(c.x, c.y, c.z, c.w * by)

/** Seconds between Mystify's and Beziers' trail steps, at Idler's own speed. */
const TRAIL_STEP = 1 / 15

/**
 * A time behind the head, `natural` seconds at Idler's speed, scaled by how much
 * the fitting sped things up: a slowed saver on a short loop is forced to at least
 * a cycle a loop, and a trail of fixed seconds behind a faster corner would grow
 * until it drew the whole path. Scaled, it covers the share of a cycle Idler's does.
 */
const behind = (s: IdleSettings, natural: number, rate: number): number => (natural * rate) / fit(s, rate)

/**
 * Mystify Your Mind: polygons whose corners bounce round the screen, each
 * trailing its own recent shapes. The trail is not a buffer: step i is the same
 * polygon at `time - i * dt`, so it is exact on frame 0 and periodic like the head.
 *
 * Density = polygons. Complexity = corners. Length = trail. Size = how near the
 * edge the corners go. Variation = how fast they travel.
 */
export class Mystify implements Saver {
  build(s: IdleSettings, scene: Scene) {
    setFlatCamera(s, scene)
    const polygons = countFromDensity(s.density, 1, 6)
    const corners = 2 + Math.trunc(s.complexity * 6 + 0.5)
    const trail = 1 + Math.trunc(s.length * 23 + 0.5)
    // Inside the box by half a stroke, or the line snags on the edge at every bounce.
    const width = 0.004 + s.lineWidth * 0.03
    const margin = width * 0.5 + (1 - s.size) * 0.6
    const rate = 0.09 * (0.4 + s.variation * 1.2)
    const trailStep = behind(s, TRAIL_STEP, rate)
    const hueRate = fit(s, 0.08)
    const points: V2[] = new Array(corners)
    const colours: V4[] = new Array(corners)

    for (let p = 0; p < polygons; p++) {
      const polygonSeed = hash2(p >>> 0, s.seed)
      // Oldest first, so the head lands on top: draw order is the only order a flat scene has.
      for (let step = trail - 1; step >= 0; step--) {
        const when = s.time - step * trailStep
        const along = trail > 1 ? step / (trail - 1) : 0
        const classic = hsvToRgb(p * 0.37 + when * hueRate, 1, 1)
        const colour = fade(settingsColour(s, classic, p, polygons), 1 - along * 0.75)
        for (let c = 0; c < corners; c++) {
          points[c] = bouncePoint(s, polygonSeed, c, when, rate, margin)
          colours[c] = colour
        }
        // A two-corner "polygon" is a line; closing it would draw it twice.
        scene.mesh.addPolyline(points, corners, corners > 2, width, colours)
      }
    }
  }
}

const BEZIER_SAMPLES = 48

/** De Casteljau rather than the polynomial, which loses precision at nine control points. */
function deCasteljau(control: V2[], count: number, t: number): V2 {
  const n = Math.min(count, 9)
  const work = control.slice(0, n)
  for (let level = n - 1; level > 0; level--) {
    for (let i = 0; i < level; i++) {
      const a = work[i]!
      const b = work[i + 1]!
      work[i] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
  }
  return work[0]!
}

/** Mystify's motion with a curve through the bouncing points instead of straight edges. */
export class Beziers implements Saver {
  build(s: IdleSettings, scene: Scene) {
    setFlatCamera(s, scene)
    const curves = countFromDensity(s.density, 1, 5)
    const controls = 3 + Math.trunc(s.complexity * 6 + 0.5)
    const trail = 1 + Math.trunc(s.length * 23 + 0.5)
    const width = 0.004 + s.lineWidth * 0.03
    const margin = width * 0.5 + (1 - s.size) * 0.6
    const rate = 0.09 * (0.4 + s.variation * 1.2)
    const trailStep = behind(s, TRAIL_STEP, rate)
    const hueRate = fit(s, 0.06)
    const control: V2[] = new Array(controls)
    const points: V2[] = new Array(BEZIER_SAMPLES)
    const colours: V4[] = new Array(BEZIER_SAMPLES)

    for (let c = 0; c < curves; c++) {
      const curveSeed = hash2(c >>> 0, s.seed)
      for (let step = trail - 1; step >= 0; step--) {
        const when = s.time - step * trailStep
        const along = trail > 1 ? step / (trail - 1) : 0
        const classic = hsvToRgb(c * 0.29 + when * hueRate, 1, 1)
        const colour = fade(settingsColour(s, classic, c, curves), 1 - along * 0.75)
        for (let i = 0; i < controls; i++) control[i] = bouncePoint(s, curveSeed, i, when, rate, margin)
        for (let i = 0; i < BEZIER_SAMPLES; i++) {
          points[i] = deCasteljau(control, controls, i / (BEZIER_SAMPLES - 1))
          colours[i] = colour
        }
        scene.mesh.addPolyline(points, BEZIER_SAMPLES, false, width, colours)
      }
    }
  }
}

/** High, because a spirograph's curvature spikes at the cusps. */
const CURVE_SAMPLES = 512
/** Idler's drawing speed, radians of the outer circle per second. Deliberately slow. */
const CURVE_HEAD_RATE = 0.55

/**
 * Curves and Colors: a hypotrochoid drawing itself on a rotating palette.
 *
 * Idler leaves the ratio a hair off a whole number so the figure precesses and
 * never repeats, which is the opposite of a loop. Here the head does a whole
 * number of turns per loop, and the ratio's fractional part — the precession —
 * is measured from the head (`theta - head`) rather than from the clock, with
 * its drift through time fitted separately. Any one frame is a figure Idler
 * draws, with the same strands the same distance apart; it just precesses a
 * whole number of times a loop. The palette's drift along the drawing is split
 * the same way.
 *
 * Density = curves. Complexity = the ratio. Length = how much of the figure is
 * drawn. Size = radius. Variation = rosette to star.
 */
export class Curves implements Saver {
  build(s: IdleSettings, scene: Scene) {
    setFlatCamera(s, scene)
    const curves = countFromDensity(s.density, 1, 4)
    const ratio = 1 + s.complexity * 8
    const outer = 0.25 + s.size * 0.7
    const inner = outer / ratio
    const arm = inner * (0.4 + s.variation * 1.6)
    const width = 0.003 + s.lineWidth * 0.02
    const span = (0.08 + s.length * 0.92) * TAU * ratio

    const head = TAU * turns(s, CURVE_HEAD_RATE / TAU)
    const k = (outer - inner) / inner
    const whole = Math.floor(k)
    const part = k - whole
    // How often the strands precess round per loop: may be none, for a ratio that is nearly whole.
    const precession = s.period > 0 ? Math.round((part * CURVE_HEAD_RATE * s.period) / TAU) : 0
    const precess = s.period > 0 ? (TAU * precession * s.time) / s.period : part * head
    const hueDrift = turns(s, 0.05 + 0.02 * CURVE_HEAD_RATE)

    const points: V2[] = new Array(CURVE_SAMPLES)
    const colours: V4[] = new Array(CURVE_SAMPLES)
    for (let c = 0; c < curves; c++) {
      // Spaced round one figure, so they read as one drawing traced several times.
      const offset = (c / curves) * TAU * ratio
      for (let i = 0; i < CURVE_SAMPLES; i++) {
        const along = i / (CURVE_SAMPLES - 1)
        const fromHead = offset - span * (1 - along)
        const theta = head + fromHead
        points[i] = {
          x: (outer - inner) * Math.cos(theta) + arm * Math.cos(whole * theta + part * fromHead + precess),
          y: (outer - inner) * Math.sin(theta) - arm * Math.sin(whole * theta + part * fromHead + precess),
        }
        const classic = hsvToRgb(fromHead * 0.02 + hueDrift, 0.85, 1)
        // The tail fades rather than stopping dead, which is what makes it look drawn.
        colours[i] = fade(settingsColour(s, classic, c, curves), Math.min(1, along * 6))
      }
      scene.mesh.addPolyline(points, CURVE_SAMPLES, false, width, colours)
    }
  }
}

/**
 * Flying Through Space: white dots streaming out of the middle. The streak is
 * the same star a moment earlier, and a star that wrapped during the streak
 * gets a dot instead of a line straight across the frame.
 *
 * Density = stars. Size = how big a near star gets. Length = streak. Line Width
 * = streak thickness. Variation = brightness spread. Complexity = fade-in.
 */
export class Starfield implements Saver {
  build(s: IdleSettings, scene: Scene) {
    setFlatCamera(s, scene)
    const stars = countFromDensity(s.density, 20, 1200)
    const rate = 0.12
    const dotSize = 0.004 + s.size * 0.022
    const streakDt = behind(s, s.length * 0.55, rate)
    const streakWide = (0.5 + s.lineWidth) * dotSize
    const fadeIn = 0.02 + s.complexity * 0.35

    for (let i = 0; i < stars; i++) {
      const now = flyingPoint(s, i, s.time, rate)
      const vary = 1 - s.variation * unit(hash3(i >>> 0, s.seed, 0xabcd)) * 0.7
      const arrival = Math.min(1, now.age / Math.max(1e-4, fadeIn))
      const brightness = Math.min(1, 0.25 + now.scale * 0.9) * vary * arrival
      const colour = settingsColour(s, v3(brightness, brightness, brightness), i, stars)
      const r = dotSize * Math.min(3, now.scale)
      const dot = () =>
        scene.mesh.addRect({ x: now.screen.x - r, y: now.screen.y - r }, { x: now.screen.x + r, y: now.screen.y + r }, colour)

      if (streakDt <= 0.001) {
        dot()
        continue
      }
      const before = flyingPoint(s, i, s.time - streakDt, rate)
      if (before.age > now.age) {
        dot()
        continue
      }
      // The tail is dimmer, which is what reads as motion rather than a rod.
      scene.mesh.addLine(before.screen, now.screen, streakWide * Math.min(3, now.scale), fade(colour, 0.15), colour)
    }
  }
}

const PANE_COLOURS: V3[] = [v3(0.95, 0.28, 0.2), v3(0.4, 0.75, 0.25), v3(0.2, 0.5, 0.9), v3(0.98, 0.78, 0.18)]

/**
 * Flying Windows: Flying Through Space with a four-pane logo at each point,
 * sheared and tapered to fake the mark's perspective — a recognisable gesture,
 * not a copy of anybody's artwork.
 *
 * Density = logos. Size. Complexity = the gap between panes. Line Width = pane
 * inset. Variation = brightness spread.
 */
export class FlyingWindows implements Saver {
  build(s: IdleSettings, scene: Scene) {
    setFlatCamera(s, scene)
    const logos = countFromDensity(s.density, 4, 120)
    const rate = 0.1
    const logoUnit = 0.03 + s.size * 0.09
    const gap = 0.06 + s.complexity * 0.35
    const inset = s.lineWidth * 0.18
    const SHEAR = 0.22
    const TAPER = 0.78

    for (let i = 0; i < logos; i++) {
      const flight = flyingPoint(s, i, s.time, rate)
      const scale = logoUnit * flight.scale
      if (scale < 0.0005) continue
      const vary = 1 - s.variation * unit(hash3(i >>> 0, s.seed, 0x5a5a)) * 0.6
      // Fade in from the far plane and out at the near one, or a half-frame logo vanishes between frames.
      const alpha = Math.min(1, flight.age * 12) * Math.min(1, (1 - flight.age) * 6)

      for (let pane = 0; pane < 4; pane++) {
        const column = pane % 2
        const row = Math.trunc(pane / 2)
        const rowTaper = row === 0 ? TAPER : 1
        const cx = (column - 0.5) * (1 + gap) * rowTaper
        const cy = (0.5 - row) * (1 + gap)
        const halfW = 0.5 * rowTaper * (1 - inset)
        const halfH = 0.5 * (1 - inset)
        const colour = fade(settingsColour(s, mul3(PANE_COLOURS[pane]!, vary), i, logos), alpha)
        const base = scene.mesh.mark()
        for (const [x, y] of [
          [cx - halfW, cy - halfH],
          [cx + halfW, cy - halfH],
          [cx + halfW, cy + halfH],
          [cx - halfW, cy + halfH],
        ] as const) {
          scene.mesh.addVertex(
            v3((x + y * SHEAR) * scale + flight.screen.x, y * scale + flight.screen.y, 0),
            v3(0, 0, 1),
            colour,
          )
        }
        scene.mesh.addQuad(base, base + 1, base + 2, base + 3)
      }
    }
  }
}

/**
 * Scrolling Marquee: a line of text crossing the screen, bobbing, in a cycling
 * colour. The scroll is fitted to a whole number of repeats per loop, a repeat
 * being the text's own width plus a gap, so a long message keeps its gap.
 *
 * Size = cap height. Line Width = stroke. Density = copies. Length = bounce
 * height. Complexity = bounce rate. Variation = hue spread across copies.
 */
export class Marquee implements Saver {
  build(s: IdleSettings, scene: Scene) {
    setFlatCamera(s, scene)
    const message = s.text.length > 0 ? s.text : 'Test Card'
    const capHeight = 0.1 + s.size * 0.8
    const width = (0.02 + s.lineWidth * 0.12) * capHeight
    const copies = countFromDensity(s.density, 1, 6)
    const textWidth = measureText(message) * capHeight
    const repeat = textWidth + capHeight * 2 + s.aspect * 0.5

    let scroll = s.time * fit(s, 0.35 / repeat) * repeat
    scroll -= Math.floor(scroll / repeat) * repeat
    const bounceHeight = s.length * (1 - capHeight * 0.5)
    const bounceRate = fit(s, 0.05 + s.complexity * 0.35)
    const hueRate = fit(s, 0.07)
    // Enough copies to cover the frame, plus one entering and one leaving.
    const span = Math.trunc((s.aspect * 2 + repeat) / repeat) + 2
    // Idler's copies run from one repeat left of the entry point rightwards, and
    // everything right of the entry point is culled: on a surface wider than the
    // repeat (a span, a long LED strip, short text) the copies further left were
    // never drawn, and the leftmost visible one vanished each time the scroll
    // wrapped, which here is the loop's seam. These reach the left edge.
    const leftmost = -Math.ceil((2 * (s.aspect + capHeight) + textWidth) / repeat) - 1

    for (let copy = 0; copy < copies; copy++) {
      const copyFraction = copies > 1 ? copy / copies : 0
      const bounce = (triangleWave(s.time * bounceRate + copyFraction) * 2 - 1) * bounceHeight
      const baseline = bounce - capHeight * 0.5
      const classic = hsvToRgb(s.time * hueRate + copyFraction * s.variation, 0.9, 1)
      const colour = settingsColour(s, classic, copy, copies)
      const draw = (r: number) => {
        const x = s.aspect + capHeight - scroll + r * repeat - copyFraction * repeat
        // Inclusive, unlike Idler's: a copy exactly on the edge is off screen, and at t = 0 one is,
        // while at t = loop the same copy is a rounding error past it. Drawn in one and not the
        // other, the frames would agree in pixels and not in geometry.
        if (x >= s.aspect + capHeight || x + textWidth <= -s.aspect - capHeight) return
        drawText(scene, message, x, baseline, capHeight, width, colour)
      }
      // Left to right, so a copy keeps its place in the mesh when the wrap renumbers it;
      // where Idler's copies covered the surface, the extra ones are culled and this is Idler's order.
      for (let r = leftmost; r < span; r++) draw(r)
    }
  }
}

function drawText(scene: Scene, message: string, x: number, baseline: number, capHeight: number, width: number, colour: V4) {
  for (const c of message) {
    const scale = capHeight * (isSmall(c) ? SMALL_CAP_SCALE : 1)
    const glyph = getGlyph(c)
    for (const stroke of glyph.strokes) {
      const points = stroke.map((p) => ({ x: x + p.x * scale, y: baseline + p.y * scale }))
      scene.mesh.addPolyline(points, points.length, false, width, points.map(() => colour))
    }
    x += glyph.advance * scale
  }
}
