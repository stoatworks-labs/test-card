/**
 * The three moving scenes: the sea, the scrolling Cretaceous, and the volcano
 * with its comet.
 *
 * All three are drawn in WORLD pixels — the whole spanned surface — and the
 * canvas is a window onto it (`env.view`), so a scene carries on across the
 * join between two outputs. Everything that moves is periodic in the loop:
 *
 *  - a scrolling layer moves a whole number of its own periods per loop;
 *  - anything that cycles (a wave, a wingbeat, a stride, a puff of smoke) does
 *    a whole number of cycles per loop.
 *
 * Get either wrong and the exported MP4 jumps once per loop where it wraps.
 * The pure parts are exported so the tests can check frame 0 against frame N.
 */

import type { OceanOptions, SceneOptions } from '../types'
import type { Ctx } from './draw'
import type { PaintEnv } from './env'
import { between, hash, pick, rng } from './random'
import { cyclesPerLoop, freeCycles, lapNumber, phase } from './loop'
import { fillShapes, mapShapes, type Pt, type Shape } from './art/shapes'
import {
  cloud,
  conifer,
  fern,
  grass,
  lavaFlow,
  makeRidge,
  mix,
  palm,
  pterosaur,
  ridgeShape,
  silhouette,
  snowShape,
  volcano,
} from './art/scenery'
import { poseDinosaur, shapesBounds, SPECIES, type Species } from './art/dinosaurs'
import type { DinosaurId } from '../types'

const TAU = Math.PI * 2

/** Visible world x-range for this canvas, with a margin. */
function visible(env: PaintEnv, w: number, margin: number): [number, number] {
  return [env.view.x - margin, env.view.x + w + margin]
}

// ---------------------------------------------------------------------------
// The sea
// ---------------------------------------------------------------------------

const SEA_PALETTES: Record<OceanOptions['time'], { skyTop: string; skyLow: string; far: string; near: string; crest: string; foam: string; sun: string; glint: string }> = {
  day: { skyTop: '#2f7fd0', skyLow: '#bfe3f5', far: '#6fb2d8', near: '#0f4a78', crest: '#9fd4ef', foam: '#f4fbff', sun: '#fff6cf', glint: '#ffffff' },
  sunset: { skyTop: '#2a2f6b', skyLow: '#f6a25b', far: '#c98a7a', near: '#1e2c56', crest: '#f0a77a', foam: '#ffe7d0', sun: '#ffd27a', glint: '#ffe2a0' },
  night: { skyTop: '#060b1f', skyLow: '#1d2c52', far: '#2a3d66', near: '#050c22', crest: '#5a77a8', foam: '#c7d6f2', sun: '#eef2ff', glint: '#dfe8ff' },
}

/** How many wave bands are on screen, horizon to foreground. */
export const SEA_BANDS = 30

/** One wave band: its curve, how near it is (0 horizon .. 1 foreground), and its rest line. */
export type SeaBand = { pts: Pt[]; depth: number; y: number }

/**
 * The wave bands at time t, far to near, as polylines across [x0, x1].
 *
 * A band's depth u rolls continuously toward the viewer: band k sits at
 * u = k + τ, and τ goes 0 → 1 a whole number of times per loop. Everything
 * about a band — height, wavelength, phase — is a smooth function of u, not
 * of k, so when τ wraps band k lands exactly where band k+1 started and the
 * sea is identical. That is what makes the loop seamless.
 *
 * Endless, the roll and the waves go at their own speeds, and each band also
 * takes a phase of its own from which band it is (k less the rolls so far,
 * which stays the same as it rolls in), so every band born at the horizon is a
 * new one and the sea never comes round. Its waves travel by its own age (u, in
 * rolls) rather than the clock: their speed changes with depth, and a speed
 * that changes times the time since 2026 would spin them faster every year.
 */
export function seaBands(
  seed: number,
  opts: OceanOptions,
  world: { widthPx: number; heightPx: number },
  x0: number,
  x1: number,
  t: number,
  loopSeconds: number,
  step: number,
  endless = false,
): SeaBand[] {
  const W = world.heightPx
  const horizon = world.heightPx * 0.42
  const r = rng(hash(seed, 7))
  const comps = [0, 1, 2].map((i) => ({
    lam: [1, 0.47, 0.23][i]! * between(r, 0.9, 1.1),
    amp: [1, 0.5, 0.22][i]!,
    dir: r() < 0.5 ? -1 : 1,
    // Phase drifts smoothly with depth, so neighbouring bands are not copies.
    p1: r() * TAU,
    p2: between(r, 0.6, 1.4),
    p3: r() * TAU,
  }))
  const roll = cyclesPerLoop(loopSeconds / 1.6, endless)
  const tau = phase(t, loopSeconds, roll)
  const rolled = endless ? lapNumber(t, loopSeconds, roll) : 0
  const bands: SeaBand[] = []
  // A band is born at the horizon with no height at all, and kept until even
  // its highest crest is below the bottom edge. Dropping one any earlier makes
  // a sliver vanish once per roll on a rough sea; starting one with height
  // makes it pop out of the horizon.
  const peak = comps.reduce((a, c) => a + c.amp, 0)
  for (let k = 0; k < SEA_BANDS * 4; k++) {
    const u = k + tau
    const f = u / SEA_BANDS
    const y = horizon + (world.heightPx - horizon) * 1.12 * f ** 1.75
    const s = Math.max(0, (y - horizon) / (world.heightPx - horizon))
    const amp = W * 0.022 * opts.swell * (s + 0.05 * Math.min(1, u))
    if (y - amp * peak > world.heightPx) break
    const lambda = W * (0.04 + 0.75 * s)
    const own = endless ? rng(hash(seed, 9, k - rolled)) : null
    const shift = comps.map(() => (own ? own() * TAU : 0))
    const pts: Pt[] = []
    // Sample on a grid anchored to the world, not to this canvas, so two
    // outputs of one surface draw the same curve through the same points.
    for (let x = Math.floor(x0 / step) * step; x <= x1 + step; x += step) {
      let v = 0
      comps.forEach((c, i) => {
        const cyc = cyclesPerLoop(loopSeconds / (1.4 + 2.2 * Math.sqrt(c.lam * (0.3 + s))), endless)
        const ph = c.p1 + Math.sin(u * 0.37 * c.p2 + c.p3) * 2.5 + u * 1.3 * (i + 1) + shift[i]!
        const travel = endless ? (cyc * u) / roll : phase(t, loopSeconds, cyc)
        v += c.amp * Math.sin((TAU * x) / (lambda * c.lam) + ph + c.dir * TAU * travel)
      })
      pts.push([x, y - amp * v])
    }
    bands.push({ pts, depth: s, y })
  }
  return bands
}

export function drawOcean(ctx: Ctx, w: number, h: number, opts: OceanOptions, env: PaintEnv) {
  const pal = SEA_PALETTES[opts.time] ?? SEA_PALETTES.day
  const { widthPx: WW, heightPx: WH } = env.world
  const horizon = WH * 0.42
  const r = rng(hash(opts.seed, 1))
  ctx.save()
  ctx.translate(-env.view.x, -env.view.y)

  const sky = ctx.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, pal.skyTop)
  sky.addColorStop(1, pal.skyLow)
  ctx.fillStyle = sky
  ctx.fillRect(env.view.x, env.view.y, w, h)

  const sunX = WW * between(r, 0.25, 0.75)
  const sunY = horizon - WH * (opts.time === 'sunset' ? 0.06 : 0.2)
  const sunR = WH * (opts.time === 'night' ? 0.045 : 0.06)

  if (opts.time === 'night') {
    // Stars that twinkle a whole number of times per loop.
    const sr = rng(hash(opts.seed, 3))
    const stars = Math.round((WW * horizon) / 9000)
    for (let i = 0; i < stars; i++) {
      const x = sr() * WW
      const y = sr() * horizon * 0.95
      const tw = 0.55 + 0.45 * Math.sin(TAU * phase(env.t, env.loopSeconds, freeCycles(1 + (i % 4), env.endless, i)) + i)
      ctx.globalAlpha = tw * between(sr, 0.4, 1)
      ctx.fillStyle = '#ffffff'
      const s = between(sr, 0.6, 1.8) * Math.max(1, WH / 1080)
      ctx.fillRect(x, y, s, s)
    }
    ctx.globalAlpha = 1
  }

  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 6)
  glow.addColorStop(0, pal.sun)
  glow.addColorStop(0.18, pal.sun + 'aa')
  glow.addColorStop(1, pal.sun + '00')
  ctx.fillStyle = glow
  ctx.fillRect(sunX - sunR * 6, sunY - sunR * 6, sunR * 12, sunR * 12)
  ctx.fillStyle = pal.sun
  ctx.beginPath()
  ctx.arc(sunX, sunY, sunR, 0, TAU)
  ctx.fill()

  // A few clouds, bobbing in place: a drifting cloud would have to cross the
  // whole sky every loop to come back round.
  if (opts.time !== 'night') {
    const cr = rng(hash(opts.seed, 4))
    const n = 3 + Math.floor(cr() * 3)
    for (let i = 0; i < n; i++) {
      const bob = Math.sin(TAU * phase(env.t, env.loopSeconds, freeCycles(1, env.endless, 80 + i)) + i) * WH * 0.004
      fillShapes(ctx, cloud(cr() * WW, horizon * between(cr, 0.25, 0.75) + bob, WH * between(cr, 0.18, 0.32), opts.seed + i, mix(pal.skyLow, '#ffffff', 0.55)))
    }
  }

  // The sea itself, then the bands rolling in over it.
  const [x0, x1] = visible(env, w, 4)
  const sea = ctx.createLinearGradient(0, horizon, 0, WH)
  sea.addColorStop(0, pal.far)
  sea.addColorStop(1, pal.near)
  ctx.fillStyle = sea
  ctx.fillRect(env.view.x, horizon, w, WH - horizon + 1)

  const step = Math.max(3, Math.round(WH / 270))
  const bands = seaBands(opts.seed, opts, env.world, x0, x1, env.t, env.loopSeconds, step, env.endless)
  for (const band of bands) {
    const body = mix(pal.far, pal.near, Math.min(1, band.depth * 1.1))
    const face = mix(body, pal.crest, 0.35 + 0.25 * (1 - band.depth))
    const thick = WH * 0.03 * band.depth
    ctx.fillStyle = body
    ctx.beginPath()
    ctx.moveTo(band.pts[0]![0], WH + 2)
    for (const p of band.pts) ctx.lineTo(p[0], p[1])
    ctx.lineTo(band.pts[band.pts.length - 1]![0], WH + 2)
    ctx.closePath()
    ctx.fill()
    // The face of the wave catches the light just below its crest.
    ctx.fillStyle = face
    ctx.beginPath()
    band.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
    for (let i = band.pts.length - 1; i >= 0; i--) ctx.lineTo(band.pts[i]![0], band.pts[i]![1] + thick)
    ctx.closePath()
    ctx.fill()
    // Foam on the near crests.
    if (band.depth > 0.35) {
      ctx.strokeStyle = pal.foam
      ctx.globalAlpha = Math.min(0.9, (band.depth - 0.35) * 1.6)
      ctx.lineWidth = Math.max(1, thick * 0.22)
      ctx.lineCap = 'round'
      ctx.beginPath()
      // From the band's rest line, not the visible points' average, so two
      // outputs of a span agree on where the foam is.
      const base = band.y
      const crest = WH * 0.008 * band.depth * opts.swell
      let drawing = false
      for (const p of band.pts) {
        if (p[1] < base - crest) {
          if (!drawing) ctx.moveTo(p[0], p[1])
          else ctx.lineTo(p[0], p[1])
          drawing = true
        } else drawing = false
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }
  }

  // Sun glitter on the water under the sun.
  const gr = rng(hash(opts.seed, 5))
  const glints = Math.round(WH / 4)
  ctx.fillStyle = pal.glint
  for (let i = 0; i < glints; i++) {
    const f = gr()
    const y = horizon + (WH - horizon) * f ** 1.6
    const spread = WH * (0.02 + 0.3 * f)
    const x = sunX + between(gr, -1, 1) * spread
    const a = Math.sin(TAU * phase(env.t, env.loopSeconds, freeCycles(2 + (i % 5), env.endless, 100 + i)) + gr() * TAU)
    if (a <= 0.2 || x < x0 || x > x1) continue
    ctx.globalAlpha = (a - 0.2) * 1.2
    const len = WH * (0.004 + 0.02 * f)
    ctx.fillRect(x - len / 2, y, len, Math.max(1, len * 0.12))
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// ---------------------------------------------------------------------------
// The scrolling Cretaceous
// ---------------------------------------------------------------------------

/**
 * How far each depth layer scrolls per loop, in whole world widths. The world
 * width is each layer's period, so whole widths are the only legal distances.
 */
export const LAYER_DEPTHS = [0.25, 0.45, 0.7, 1.0, 1.3] as const

export function layerWidths(speed: number, endless = false): number[] {
  const s = Math.max(1, Math.min(20, speed))
  // Endless, nothing has to come round, so each layer scrolls at its depth's own speed.
  return LAYER_DEPTHS.map((d) => (endless ? s * d : Math.max(1, Math.round(s * d))))
}

/** A layer's scroll offset at time t, in world pixels, 0 <= offset < period. */
export function layerOffset(widthsPerLoop: number, period: number, t: number, loopSeconds: number): number {
  return phase(t, loopSeconds, widthsPerLoop) * period
}

/** Draw a periodic thing at every repeat that could be on screen. */
export function eachRepeat(x: number, period: number, x0: number, x1: number, draw: (x: number) => void) {
  const first = x - Math.ceil((x - x0) / period) * period
  for (let p = first; p <= x1; p += period) draw(p)
}

/**
 * As `eachRepeat`, numbering the repeats: `k` is how many periods from `x`
 * this one is. With `x` from `lapX` on an endless pattern, a thing crossing
 * the picture keeps its `k` all the way across and the next one has the next,
 * so whatever is seeded from `k` is a new one each time round.
 */
export function eachRepeatIndexed(x: number, period: number, x0: number, x1: number, draw: (x: number, k: number) => void) {
  const before = Math.ceil((x - x0) / period)
  for (let k = -before; x + k * period <= x1; k++) draw(x + k * period, k)
}

/**
 * Where something that laps the world once a loop is, `baseX` at t = 0 and going
 * `dir`. Looping, wrapped into one lap. Endless, NOT wrapped: it is where the
 * first of its repeats has got to, so `eachRepeatIndexed` can tell them apart.
 */
export function lapX(env: Pick<PaintEnv, 't' | 'loopSeconds' | 'endless'>, baseX: number, dir: number, lap: number): number {
  return baseX + dir * lap * (env.endless ? env.t / env.loopSeconds : phase(env.t, env.loopSeconds, 1))
}

type Walker = { id: DinosaurId; x: number; layer: number; drift: number }

/**
 * Metres to pixels for each layer the animals walk in, as a fraction of the
 * scene's height. One scale per layer, so a Velociraptor is a Velociraptor's
 * size next to the Tyrannosaurus rather than whatever size reads best alone.
 */
const LAYER_M = [0, 0, 0.0085, 0.03, 0]

export function drawDinoScroll(ctx: Ctx, w: number, h: number, opts: SceneOptions, env: PaintEnv) {
  const { widthPx: WW, heightPx: WH } = env.world
  const T = env.loopSeconds
  const widths = layerWidths(opts.speed, env.endless)
  const r = rng(hash(opts.seed, 11))
  const haze = '#d9ecf2'
  ctx.save()
  ctx.translate(-env.view.x, -env.view.y)
  const [x0, x1] = visible(env, w, WH * 0.5)

  const g = ctx.createLinearGradient(0, 0, 0, WH * 0.7)
  g.addColorStop(0, '#4a9be0')
  g.addColorStop(1, haze)
  ctx.fillStyle = g
  ctx.fillRect(env.view.x, env.view.y, w, h)

  const sunX = WW * between(r, 0.6, 0.85)
  const sunGlow = ctx.createRadialGradient(sunX, WH * 0.16, 0, sunX, WH * 0.16, WH * 0.25)
  sunGlow.addColorStop(0, '#fffbe8')
  sunGlow.addColorStop(0.2, '#fff2b8aa')
  sunGlow.addColorStop(1, '#fff2b800')
  ctx.fillStyle = sunGlow
  ctx.fillRect(sunX - WH * 0.25, 0, WH * 0.5, WH * 0.5)

  const cr = rng(hash(opts.seed, 12))
  for (let i = 0; i < 4; i++) {
    const bob = Math.sin(TAU * phase(env.t, T, freeCycles(1, env.endless, 80 + i)) + i * 1.7) * WH * 0.004
    fillShapes(ctx, cloud(cr() * WW, WH * between(cr, 0.1, 0.32) + bob, WH * between(cr, 0.15, 0.28), opts.seed * 7 + i, '#ffffff'))
  }

  // Pterosaurs, crossing the sky once per loop and wrapping. Endless, a new one each crossing.
  const pr = rng(hash(opts.seed, 13))
  for (let i = 0; i < 3; i++) {
    const baseX = pr() * WW
    const y = WH * between(pr, 0.12, 0.35)
    const span = WH * between(pr, 0.05, 0.09)
    const beat = between(pr, 0.6, 0.9)
    const colour = mix('#3d3a5a', haze, 0.25)
    const draw = (px: number, cy: number, cs: number, cBeat: number) => {
      const flap = phase(env.t, T, cyclesPerLoop(T / cBeat, env.endless))
      fillShapes(ctx, pterosaur(px, cy + Math.sin(TAU * flap) * cs * 0.08, cs, flap, colour))
    }
    if (env.endless) {
      eachRepeatIndexed(lapX(env, baseX, 1, WW), WW, x0, x1, (px, k) => {
        const c = rng(hash(opts.seed, 14, i, k))
        draw(px, WH * between(c, 0.12, 0.35), WH * between(c, 0.05, 0.09), between(c, 0.6, 0.9))
      })
    } else {
      eachRepeat(baseX + phase(env.t, T, 1) * WW, WW, x0, x1, (px) => draw(px, y, span, beat))
    }
  }

  // Layer 0: far mountains with snow. Layer 1: nearer hills.
  const far = makeRidge(hash(opts.seed, 20), WW, { base: 3 })
  const off0 = layerOffset(widths[0]!, WW, env.t, T)
  fillShapes(ctx, [ridgeShape(far, x0, x1, WH * 0.55, WH * 0.32, WH, mix('#7d86b8', haze, 0.25), off0)])
  fillShapes(ctx, snowShape(far, x0, x1, WH * 0.55, WH * 0.32, WH * 0.34, '#f4f6ff', off0))

  const hills = makeRidge(hash(opts.seed, 21), WW, { base: 2, rough: 0.35, octaves: 4 })
  const off1 = layerOffset(widths[1]!, WW, env.t, T)
  fillShapes(ctx, [ridgeShape(hills, x0, x1, WH * 0.66, WH * 0.16, WH, mix('#6c9a72', haze, 0.3), off1)])

  // Layer 2: a far tree line, a herd walking along it, and its ground.
  const off2 = layerOffset(widths[2]!, WW, env.t, T)
  const treeColours2 = { trunk: mix('#6e5a44', haze, 0.4), leaf: mix('#4f8a54', haze, 0.4), dark: mix('#3f7146', haze, 0.4) }
  const trees2 = treeLine(hash(opts.seed, 30), WW, WH * 0.12, WH * 0.2)
  const ground2 = WH * 0.72
  ctx.fillStyle = mix('#7f9a5a', haze, 0.35)
  ctx.fillRect(env.view.x, ground2 - 1, w, WH - ground2 + 1)
  for (const tr of trees2) {
    eachRepeat(tr.x - off2, WW, x0, x1, (x) => fillShapes(ctx, tr.kind === 'palm' ? palm(x, ground2, tr.h, tr.seed, treeColours2) : conifer(x, ground2, tr.h, tr.seed, treeColours2)))
  }

  // Walkers: whose layer, where, and how they drift. Positions are in the
  // layer's own scrolling frame plus a whole number of widths of drift.
  const walkers: Walker[] = [
    { id: 'brachiosaurus', x: WW * 0.18, layer: 2, drift: -1 },
    { id: 'brachiosaurus', x: WW * 0.31, layer: 2, drift: -1 },
    { id: 'stegosaurus', x: WW * 0.08, layer: 3, drift: 0 },
    { id: 'triceratops', x: WW * 0.42, layer: 3, drift: 0 },
    { id: 'tyrannosaurus', x: WW * 0.76, layer: 3, drift: 0 },
    { id: 'velociraptor', x: WW * 0.55, layer: 3, drift: 1 },
    { id: 'velociraptor', x: WW * 0.6, layer: 3, drift: 1 },
    { id: 'compsognathus', x: WW * 0.28, layer: 3, drift: 1 },
  ]
  // Endless, an animal that crosses the picture (one that drifts) is a new one each
  // time: a species from those that walk with it, from which crossing it is.
  const crossers: Record<number, DinosaurId[]> = { 2: ['brachiosaurus', 'stegosaurus', 'triceratops'], 3: ['velociraptor', 'compsognathus'] }
  // A drifting animal's pace over the ground is the loop's whatever the scroll does:
  // endless, its layer scrolls at its own speed, so its drift across the picture is
  // the loop's walk less that. (Kept at the loop's whole -1, the herd at Speed 1
  // walked 0.3 widths backwards a loop and slid with its legs still.)
  const loopWidths = layerWidths(opts.speed)
  const driftOf = (wk: Walker) => (env.endless && wk.drift !== 0 ? loopWidths[wk.layer]! + wk.drift - widths[wk.layer]! : wk.drift)
  const drawWalkers = (layer: number, groundY: number) => {
    walkers.forEach((wk, i) => {
      if (wk.layer !== layer) return
      const pxPerM = WH * LAYER_M[layer]!
      // Distance walked over the ground per loop: the layer's scroll plus the drift.
      const walked = (widths[layer]! + driftOf(wk)) * WW
      const shapesOf = (id: DinosaurId) => {
        const sp = SPECIES[id]
        const strides = walked > 0 ? cyclesPerLoop(walked / (sp.stride * pxPerM), env.endless) : 0
        const gait = strides ? phase(env.t, T, strides) : null
        const strideM = strides ? walked / strides / pxPerM : sp.stride
        const shapes = scaleDino(poseDinosaur(sp, gait, strideM), pxPerM)
        return layer < 3 ? mapColours(shapes, haze, 0.35) : shapes
      }
      const place = (px: number, shapes: Shape[]) => {
        ctx.save()
        ctx.translate(px, groundY)
        fillShapes(ctx, shapes)
        ctx.restore()
      }
      if (env.endless && wk.drift !== 0) {
        eachRepeatIndexed(lapX(env, wk.x, driftOf(wk), WW), WW, x0 - 30 * pxPerM, x1 + 30 * pxPerM, (px, k) => {
          const pool = crossers[layer] ?? [wk.id]
          place(px, shapesOf(pick(rng(hash(opts.seed, 15, i, k)), pool)))
        })
      } else {
        const shapes = shapesOf(wk.id)
        eachRepeat(wk.x + wk.drift * phase(env.t, T, 1) * WW, WW, x0 - 30 * pxPerM, x1 + 30 * pxPerM, (px) => place(px, shapes))
      }
    })
  }
  drawWalkers(2, ground2)

  // Layer 3: the ground the main animals walk on, with ferns and trees.
  const off3 = layerOffset(widths[3]!, WW, env.t, T)
  const ground3 = WH * 0.86
  ctx.fillStyle = '#8aa055'
  ctx.fillRect(env.view.x, ground3 - 1, w, WH - ground3 + 1)
  ctx.fillStyle = '#7a8f48'
  ctx.fillRect(env.view.x, ground3 + WH * 0.03, w, WH * 0.02)
  const plantColours = { trunk: '#7a5a3a', leaf: '#3f8040', dark: '#2f6432' }
  const pr3 = rng(hash(opts.seed, 40))
  const plants3: { x: number; kind: number; h: number; seed: number }[] = []
  const n3 = Math.max(3, Math.round(WW / (WH * 0.55)))
  for (let i = 0; i < n3; i++) plants3.push({ x: ((i + between(pr3, 0.1, 0.9)) / n3) * WW, kind: Math.floor(pr3() * 3), h: WH * between(pr3, 0.28, 0.42), seed: hash(opts.seed, 41, i) })
  for (const p of plants3) {
    eachRepeat(p.x - off3, WW, x0, x1, (x) => fillShapes(ctx, p.kind === 0 ? palm(x, ground3 + WH * 0.01, p.h, p.seed, plantColours) : fern(x, ground3 + WH * 0.01, p.h * 0.35, p.seed, plantColours)))
  }
  drawWalkers(3, ground3 + WH * 0.012)

  // Layer 4: foreground ferns and grass, fastest of all.
  const off4 = layerOffset(widths[4]!, WW, env.t, T)
  const pr4 = rng(hash(opts.seed, 50))
  const n4 = Math.max(4, Math.round(WW / (WH * 0.22)))
  const fg = { trunk: '#3f5a2a', leaf: '#2e5f2a', dark: '#234a20' }
  ctx.fillStyle = '#6b8a3d'
  ctx.fillRect(env.view.x, WH * 0.95, w, WH * 0.05 + 1)
  for (let i = 0; i < n4; i++) {
    const x = ((i + between(pr4, 0, 1)) / n4) * WW
    const kind = pr4()
    const size = WH * between(pr4, 0.1, 0.2)
    const seed = hash(opts.seed, 51, i)
    eachRepeat(x - off4, WW, x0, x1, (px) =>
      fillShapes(ctx, kind < 0.55 ? fern(px, WH * 1.0, size, seed, fg) : grass(px, WH * 1.0, size * 0.7, seed, '#3f7a30')),
    )
  }
  ctx.restore()
}

function treeLine(seed: number, period: number, minH: number, maxH: number) {
  const r = rng(seed)
  const n = Math.max(4, Math.round(period / (minH * 1.4)))
  return Array.from({ length: n }, (_, i) => ({
    x: ((i + between(r, 0, 1)) / n) * period,
    h: between(r, minH, maxH),
    kind: r() < 0.6 ? 'palm' : 'conifer',
    seed: hash(seed, i),
  }))
}

/** Metres, y up -> pixels, y down, feet at 0. */
function scaleDino(shapes: Shape[], pxPerM: number): Shape[] {
  return mapShapes(shapes, ([x, y]) => [x * pxPerM, -y * pxPerM], pxPerM)
}

function mapColours(shapes: Shape[], toward: string, t: number): Shape[] {
  return shapes.map((s) => ({
    ...s,
    fill: s.fill ? mix(s.fill, toward, t) : undefined,
    stroke: s.stroke ? mix(s.stroke, toward, t) : undefined,
  }))
}

// ---------------------------------------------------------------------------
// The volcano and the comet
// ---------------------------------------------------------------------------

export function drawVolcano(ctx: Ctx, w: number, h: number, opts: SceneOptions, env: PaintEnv) {
  const { widthPx: WW, heightPx: WH } = env.world
  const T = env.loopSeconds
  const r = rng(hash(opts.seed, 60))
  ctx.save()
  ctx.translate(-env.view.x, -env.view.y)
  const [x0, x1] = visible(env, w, WH * 0.3)

  const sky = ctx.createLinearGradient(0, 0, 0, WH * 0.8)
  sky.addColorStop(0, '#120a2a')
  sky.addColorStop(0.45, '#4a1f4f')
  sky.addColorStop(0.8, '#c4482c')
  sky.addColorStop(1, '#f08a3a')
  ctx.fillStyle = sky
  ctx.fillRect(env.view.x, env.view.y, w, h)

  // Stars in the dark top of the sky.
  const sr = rng(hash(opts.seed, 61))
  const stars = Math.round(WW / 6)
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < stars; i++) {
    const x = sr() * WW
    const y = sr() * WH * 0.35
    ctx.globalAlpha = (0.5 + 0.5 * Math.sin(TAU * phase(env.t, T, freeCycles(1 + (i % 3), env.endless, i)) + i)) * (1 - y / (WH * 0.35))
    const s = Math.max(1, WH / 900)
    ctx.fillRect(x, y, s, s)
  }
  ctx.globalAlpha = 1

  // The comet: head low on the right, tail streaming up and back to the left.
  const head: Pt = [WW * between(r, 0.62, 0.78), WH * between(r, 0.16, 0.24)]
  const tailDir = Math.atan2(-0.42, -1)
  const tailLen = WW * 0.55
  for (let layer = 0; layer < 5; layer++) {
    const spread = 0.05 + layer * 0.035
    const flick = 1 + 0.05 * Math.sin(TAU * phase(env.t, T, freeCycles(2 + layer, env.endless, 120 + layer)) + layer)
    const end: Pt = [head[0] + Math.cos(tailDir) * tailLen * flick * (1 - layer * 0.08), head[1] + Math.sin(tailDir) * tailLen * flick * (1 - layer * 0.08)]
    const nrm: Pt = [-Math.sin(tailDir), Math.cos(tailDir)]
    const wHead = WH * (0.008 + layer * 0.006)
    const wEnd = tailLen * spread
    const g2 = ctx.createLinearGradient(head[0], head[1], end[0], end[1])
    g2.addColorStop(0, `rgba(255, 244, 214, ${0.55 - layer * 0.08})`)
    g2.addColorStop(1, 'rgba(255, 200, 160, 0)')
    ctx.fillStyle = g2
    ctx.beginPath()
    ctx.moveTo(head[0] + nrm[0] * wHead, head[1] + nrm[1] * wHead)
    ctx.quadraticCurveTo(
      (head[0] + end[0]) / 2 + nrm[0] * wEnd * 0.4,
      (head[1] + end[1]) / 2 + nrm[1] * wEnd * 0.4,
      end[0] + nrm[0] * wEnd,
      end[1] + nrm[1] * wEnd,
    )
    ctx.lineTo(end[0] - nrm[0] * wEnd * 0.6, end[1] - nrm[1] * wEnd * 0.6)
    ctx.quadraticCurveTo((head[0] + end[0]) / 2, (head[1] + end[1]) / 2, head[0] - nrm[0] * wHead, head[1] - nrm[1] * wHead)
    ctx.closePath()
    ctx.fill()
  }
  const pulse = 1 + 0.08 * Math.sin(TAU * phase(env.t, T, freeCycles(3, env.endless, 130)))
  const cg = ctx.createRadialGradient(head[0], head[1], 0, head[0], head[1], WH * 0.06 * pulse)
  cg.addColorStop(0, '#ffffff')
  cg.addColorStop(0.15, '#fff2d0')
  cg.addColorStop(0.4, 'rgba(255, 210, 150, 0.45)')
  cg.addColorStop(1, 'rgba(255, 180, 120, 0)')
  ctx.fillStyle = cg
  ctx.fillRect(head[0] - WH * 0.07, head[1] - WH * 0.07, WH * 0.14, WH * 0.14)

  // Far ridges, dark against the glow.
  const far = makeRidge(hash(opts.seed, 62), WW, { base: 3 })
  fillShapes(ctx, [ridgeShape(far, x0, x1, WH * 0.72, WH * 0.16, WH, '#3a1a34')])

  // The volcano, its glow, its plume and its lava.
  const vx = WW * between(r, 0.3, 0.45)
  const vy = WH * 0.8
  const vw = WH * 0.95
  const vh = WH * 0.42
  const crater: Pt = [vx, vy - vh]
  const glowPulse = 0.75 + 0.25 * Math.sin(TAU * phase(env.t, T, freeCycles(2, env.endless, 131)))
  const vg = ctx.createRadialGradient(crater[0], crater[1], 0, crater[0], crater[1], WH * 0.35)
  vg.addColorStop(0, `rgba(255, 150, 60, ${0.75 * glowPulse})`)
  vg.addColorStop(1, 'rgba(255, 90, 30, 0)')
  ctx.fillStyle = vg
  ctx.fillRect(crater[0] - WH * 0.35, crater[1] - WH * 0.35, WH * 0.7, WH * 0.7)

  // Smoke puffs, each rising and swelling over one whole cycle, staggered.
  // Endless, each puff is a new one: its size and lean from which puff it is.
  const puffs = 9
  const puffCycles = cyclesPerLoop(T / 6, env.endless)
  for (let i = 0; i < puffs; i++) {
    const p = (phase(env.t, T, puffCycles) + i / puffs) % 1
    const own = env.endless ? rng(hash(opts.seed, 64, i, lapNumber(env.t, T, puffCycles, i / puffs))) : null
    const rise = p * WH * 0.55
    const lean = p * p * WH * 0.25 * (own ? between(own, 0.5, 1.4) : 1)
    const size = WH * (0.035 + p * 0.12) * (own ? between(own, 0.75, 1.3) : 1)
    ctx.globalAlpha = Math.sin(p * Math.PI) * 0.85
    ctx.fillStyle = mix('#5a4a52', '#2a1e2a', p)
    ctx.beginPath()
    ctx.arc(crater[0] + lean + Math.sin(i * 2.3) * size * 0.3, crater[1] - rise, size, 0, TAU)
    ctx.arc(crater[0] + lean + size * 0.7, crater[1] - rise + size * 0.2, size * 0.7, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  fillShapes(ctx, volcano(vx, vy, vw, vh, { rock: '#2a1620', light: '#5a2a26', dark: '#ffb050' }))

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let k = 0; k < 4; k++) {
    const flow = lavaFlow([crater[0] + (k - 1.5) * vw * 0.025, crater[1] + vh * 0.02], vh * between(r, 0.45, 0.85), (k - 1.5) * 0.45, hash(opts.seed, 70, k))
    const flick = 0.7 + 0.3 * Math.sin(TAU * phase(env.t, T, freeCycles(3 + k, env.endless, 140 + k)) + k)
    ctx.strokeStyle = `rgba(255, 120, 30, ${0.35 * flick})`
    ctx.lineWidth = WH * 0.022
    strokeLine(ctx, flow)
    ctx.strokeStyle = '#ff7a1a'
    ctx.lineWidth = WH * 0.008
    strokeLine(ctx, flow)
    ctx.strokeStyle = `rgba(255, 230, 140, ${flick})`
    ctx.lineWidth = WH * 0.003
    strokeLine(ctx, flow)
  }

  // Lava bombs on parabolas, each landing and relaunching a whole number of times.
  const bombs = 14
  const br = rng(hash(opts.seed, 80))
  for (let i = 0; i < bombs; i++) {
    const cyc = cyclesPerLoop(T / between(br, 1.4, 2.6), env.endless)
    const at = br()
    const p = (phase(env.t, T, cyc) + at) % 1
    let vxB = between(br, -1, 1) * WH * 0.25
    let up = WH * between(br, 0.25, 0.45)
    if (env.endless) {
      // A new throw every launch: which way and how high, from which launch it is.
      const c = rng(hash(opts.seed, 81, i, lapNumber(env.t, T, cyc, at)))
      vxB = between(c, -1, 1) * WH * 0.25
      up = WH * between(c, 0.25, 0.45)
    }
    const x = crater[0] + vxB * p
    const y = crater[1] - up * 4 * p * (1 - p)
    ctx.globalAlpha = 1 - p * 0.6
    ctx.fillStyle = p < 0.5 ? '#ffe08a' : '#ff8a3a'
    ctx.beginPath()
    ctx.arc(x, y, Math.max(1.5, WH * 0.004), 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // Foreground: dark ground, palms and the animals in silhouette, rim-lit.
  const ground = WH * 0.86
  const front = makeRidge(hash(opts.seed, 90), WW, { base: 2, rough: 0.3, octaves: 3 })
  fillShapes(ctx, [ridgeShape(front, x0, x1, ground, WH * 0.05, WH + 2, '#150a12')])
  const plant = { trunk: '#150a12', leaf: '#150a12', dark: '#150a12' }
  const pr = rng(hash(opts.seed, 91))
  const n = Math.max(3, Math.round(WW / (WH * 0.6)))
  for (let i = 0; i < n; i++) {
    // Every random number is drawn before anything is skipped as off-screen,
    // or the sequence depends on where this canvas sits and two outputs of a
    // span grow different forests.
    const x = ((i + between(pr, 0, 1)) / n) * WW
    const kind = pr()
    const palmH = WH * between(pr, 0.25, 0.4)
    const fernH = WH * between(pr, 0.08, 0.14)
    if (x < x0 || x > x1) continue
    if (kind < 0.5) fillShapes(ctx, palm(x, ground + WH * 0.02, palmH, hash(opts.seed, 92, i), plant, Math.sin(TAU * phase(env.t, T, freeCycles(1, env.endless, 150 + i)) + i)))
    else fillShapes(ctx, fern(x, ground + WH * 0.03, fernH, hash(opts.seed, 93, i), plant))
  }

  const cast: { id: DinosaurId; x: number; scale: number; flip?: boolean }[] = [
    { id: 'tyrannosaurus', x: WW * 0.6, scale: 0.12 },
    { id: 'triceratops', x: WW * 0.97, scale: 0.11, flip: true },
    { id: 'brachiosaurus', x: WW * 0.08, scale: 0.075 },
  ]
  for (const c of cast) {
    const sp: Species = SPECIES[c.id]
    const pxPerM = (WH * c.scale) / sp.hipM
    let shapes = mapShapes(poseDinosaur(sp), ([x, y]) => [x * pxPerM * (c.flip ? -1 : 1), -y * pxPerM], pxPerM)
    const b = shapesBounds(shapes)
    if (c.x + b.x1 < x0 || c.x + b.x0 > x1) continue
    // Rim light first, offset toward the glow, then the silhouette over it.
    const rim = silhouette(shapes, '#ff9a4a')
    shapes = silhouette(shapes, '#120810')
    ctx.save()
    ctx.translate(c.x + WH * 0.0035, ground + WH * 0.03 - WH * 0.0035)
    fillShapes(ctx, rim)
    ctx.translate(-WH * 0.0035, WH * 0.0035)
    fillShapes(ctx, shapes)
    ctx.restore()
  }

  // Pterosaurs crossing in silhouette. Endless, a new one each crossing.
  const fr = rng(hash(opts.seed, 95))
  for (let i = 0; i < 4; i++) {
    const span = WH * between(fr, 0.04, 0.07)
    const beat = between(fr, 0.6, 0.9)
    const baseX = fr() * WW
    const y = WH * between(fr, 0.32, 0.5)
    const flapAt = (b: number) => phase(env.t, T, cyclesPerLoop(T / b, env.endless))
    if (env.endless) {
      eachRepeatIndexed(lapX(env, baseX, 1, WW), WW, x0, x1, (px, k) => {
        const c = rng(hash(opts.seed, 96, i, k))
        const cs = WH * between(c, 0.04, 0.07)
        fillShapes(ctx, pterosaur(px, WH * between(c, 0.32, 0.5), cs, flapAt(between(c, 0.6, 0.9)), '#1a0c18'))
      })
    } else {
      eachRepeat(baseX + phase(env.t, T, 1) * WW, WW, x0, x1, (px) => fillShapes(ctx, pterosaur(px, y, span, flapAt(beat), '#1a0c18')))
    }
  }
  ctx.restore()
}

function strokeLine(ctx: Ctx, pts: Pt[]) {
  ctx.beginPath()
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
  ctx.stroke()
}

