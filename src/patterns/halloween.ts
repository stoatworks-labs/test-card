/**
 * The Halloween patterns: a jack-o'-lantern on every LED tile, a spooky forest
 * scrolling past in parallax, and a haunted house with the dead walking in
 * front of it.
 *
 * Same rules as the other scenes (see scenes.ts). The two scenes are drawn in
 * WORLD pixels with the canvas as a window onto them, so they carry on across
 * the join between outputs. Everything that moves is periodic in the loop: a
 * flicker, a blink, a wingbeat or a stride does a whole number of cycles, and
 * a thing that crosses the sky or the graveyard does one whole lap. The pure
 * parts are exported so the tests can check frame 0 against frame N.
 *
 * Endless (live output only, `env.endless`), nothing is fitted, and each bat,
 * witch, vampire and walker is a new one every time it crosses: its looks come
 * from which crossing it is (`eachRepeatIndexed`), not from its slot. The
 * scenery scrolls on its own period as before; what moves through it is new.
 */

import type { PumpkinFace, PumpkinOptions, SceneOptions } from '../types'
import type { Ctx } from './draw'
import type { EnvTile, PaintEnv } from './env'
import { between, hash, pick, rng } from './random'
import { cyclesPerLoop, freeCycles, lapNumber, phase, wholeCycles } from './loop'
import { fillShapes, mapShapes, tracePath, type Pt, type Shape } from './art/shapes'
import { grass, makeRidge, mix, ridgeShape, silhouette } from './art/scenery'
import {
  bat,
  deadTree,
  ghost,
  gravestone,
  hauntedHouse,
  ironFence,
  pumpkin,
  PUMPKIN_BOTTOM,
  PUMPKIN_FACES,
  PUMPKIN_TOP,
  skeleton,
  SKELETON_WALK,
  stoneInscription,
  STONE_KINDS,
  strideOf,
  vampire,
  witch,
  zombie,
  ZOMBIE_WALK,
} from './art/halloween'
import { drawTooManyTiles } from './novelty'
import { eachRepeat, eachRepeatIndexed, lapX, layerOffset, layerWidths } from './scenes'

const TAU = Math.PI * 2

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** A modulo that stays positive: tiles left of a spanned wall's origin have negative columns. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

// ---------------------------------------------------------------------------
// Timing, pure
// ---------------------------------------------------------------------------

/**
 * A candle's brightness, 0..1, at time t: three flickers at about 1.3, 3.1 and
 * 5.3 Hz, each a whole number of cycles per loop. `key` makes every candle
 * flicker in its own way.
 */
export function candleLevel(t: number, loopSeconds: number, key: number, endless = false): number {
  const r = rng(hash(key, 501))
  let v = 0.72
  for (const [hz, amp] of [[1.3, 0.13], [3.1, 0.09], [5.3, 0.05]] as const) {
    const cycles = cyclesPerLoop(loopSeconds * hz * between(r, 0.85, 1.15), endless)
    v += amp * Math.sin(TAU * phase(t, loopSeconds, cycles) + r() * TAU)
  }
  return clamp01(v)
}

/**
 * How far into a blink, a wink or a chomp a face is, 0..1. Brief, every three
 * or four seconds, in a whole number of goes per loop and at a time of its own.
 */
export function expressionLevel(t: number, loopSeconds: number, key: number, endless = false): number {
  const r = rng(hash(key, 502))
  const goes = cyclesPerLoop(loopSeconds / between(r, 2.5, 4), endless)
  const p = (phase(t, loopSeconds, goes) + r()) % 1
  const len = 0.14
  return p < len ? Math.sin((Math.PI * p) / len) : 0
}

export type Walker = {
  kind: 'zombie' | 'skeleton'
  /** Where it is at t = 0, in world pixels. */
  x: number
  /** Feet, in world pixels. */
  y: number
  heightPx: number
  dir: 1 | -1
  look: number
}

/**
 * Where a walker is, and how far through its stride, at time t. It goes once
 * round a lap of `lap` pixels per loop, in a whole number of strides fitted to
 * that distance so its feet keep pace with the ground. A zombie lurches —
 * quick, then slow, once a stride — and still does exactly one lap. Endless,
 * the strides are its own and `x` is not wrapped into the lap (see `lapX`).
 */
export function walkerAt(w: Walker, lap: number, t: number, loopSeconds: number, endless = false): { x: number; gait: number } {
  const style = w.kind === 'zombie' ? ZOMBIE_WALK : SKELETON_WALK
  const strides = cyclesPerLoop(lap / (strideOf(style) * w.heightPx), endless)
  const gait = phase(t, loopSeconds, strides)
  const lurch = w.kind === 'zombie' ? (0.5 * Math.sin(TAU * gait)) / (TAU * strides) : 0
  return { x: w.x + w.dir * lap * ((endless ? t / loopSeconds : phase(t, loopSeconds, 1)) + lurch), gait }
}

/**
 * How far anything that crosses the picture goes per loop: a walker, a witch, a
 * vampire, a bat. The whole world on anything up to about one and a half 16:9
 * screens wide. On a wider surface it is 1.3 screens, so things keep their pace
 * instead of sprinting across a span of six, and the copies that repeat every lap
 * don't land in the same place on every output (a lap of exactly one output
 * width would show each output the same six zombies in the same poses).
 */
export function walkLap(world: { widthPx: number; heightPx: number }): number {
  const screen = (world.heightPx * 16) / 9
  return world.widthPx <= screen * 1.5 ? world.widthPx : screen * 1.3
}

// ---------------------------------------------------------------------------
// Shared painting
// ---------------------------------------------------------------------------

/** Every closed polygon wound the same way, so one fill of them all is their union. */
function wound(pts: Pt[]): Pt[] {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % pts.length]!
    a += p[0] * q[1] - q[0] * p[1]
  }
  return a < 0 ? pts.slice().reverse() : pts
}

/**
 * Dead trees are hundreds of polygons each and never change, so each is built
 * once into a single path at its own origin and filled in one go. Keyed by its
 * seed, size and forking, so a different raster or seed builds afresh.
 */
const treeCache = new Map<string, Path2D>()
/** Trees drawn so far this frame, and the most the cache may hold: twice the last frame's. */
let treesThisFrame = 0
let treeLimit = 400

/** Call at the start of each frame, so a very wide raster's thousand trees aren't rebuilt every frame. */
function treeFrame() {
  treeLimit = Math.max(400, treesThisFrame * 2)
  treesThisFrame = 0
}

function drawTree(ctx: Ctx, x: number, y: number, h: number, seed: number, depth: number, colour: string) {
  const size = Math.round(h * 4) / 4
  const key = `${seed}:${size}:${depth}`
  treesThisFrame++
  let path = treeCache.get(key)
  if (!path) {
    if (treeCache.size >= treeLimit) treeCache.clear()
    path = new Path2D()
    for (const s of deadTree(0, 0, size, seed, colour, depth)) tracePath(path, wound(s.pts), s.smooth !== false, true)
    treeCache.set(key, path)
  }
  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle = colour
  ctx.fill(path)
  ctx.restore()
}

function drawSky(ctx: Ctx, env: PaintEnv, w: number, h: number, until: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(0, 0, 0, until)
  for (const [at, colour] of stops) g.addColorStop(at, colour)
  ctx.fillStyle = g
  ctx.fillRect(env.view.x, env.view.y, w, h)
}

/** Stars above `bottom`, each twinkling a whole number of times per loop. */
function drawStars(ctx: Ctx, env: PaintEnv, seed: number, bottom: number) {
  const { widthPx: WW, heightPx: WH } = env.world
  const r = rng(hash(seed, 61))
  const n = Math.round((WW * bottom) / 5000)
  const s = Math.max(1, WH / 900)
  ctx.fillStyle = '#ffffff'
  for (let i = 0; i < n; i++) {
    const x = r() * WW
    const y = r() * bottom
    const bright = between(r, 0.35, 1)
    const big = r() < 0.08 ? 1.8 : 1
    ctx.globalAlpha = bright * (0.55 + 0.45 * Math.sin(TAU * phase(env.t, env.loopSeconds, freeCycles(1 + (i % 3), env.endless, i)) + i)) * (1 - (y / bottom) * 0.7)
    ctx.fillRect(x, y, s * big, s * big)
  }
  ctx.globalAlpha = 1
}

function drawMoon(ctx: Ctx, x: number, y: number, radius: number, seed: number) {
  const glow = ctx.createRadialGradient(x, y, radius * 0.8, x, y, radius * 4)
  glow.addColorStop(0, 'rgba(220, 215, 255, 0.35)')
  glow.addColorStop(0.35, 'rgba(160, 150, 230, 0.12)')
  glow.addColorStop(1, 'rgba(120, 110, 200, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(x - radius * 4, y - radius * 4, radius * 8, radius * 8)
  ctx.fillStyle = '#f3ecd2'
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, TAU)
  ctx.fill()
  const r = rng(hash(seed, 77))
  ctx.fillStyle = '#cbc19f'
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU
    const d = Math.sqrt(r()) * radius * 0.72
    const cr = radius * between(r, 0.06, 0.17)
    ctx.globalAlpha = between(r, 0.3, 0.55)
    ctx.beginPath()
    ctx.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, cr, cr * 0.85, a, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  const limb = ctx.createRadialGradient(x, y, radius * 0.55, x, y, radius)
  limb.addColorStop(0, 'rgba(140, 130, 110, 0)')
  limb.addColorStop(1, 'rgba(140, 130, 110, 0.35)')
  ctx.fillStyle = limb
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, TAU)
  ctx.fill()
}

/** Long thin clouds, bobbing in place across the moon. */
function drawWisps(ctx: Ctx, env: PaintEnv, seed: number, top: number, bottom: number, colour: string, n: number) {
  const { widthPx: WW, heightPx: WH } = env.world
  const r = rng(seed)
  ctx.fillStyle = colour
  for (let i = 0; i < n; i++) {
    const cx = r() * WW
    const cy = between(r, top, bottom)
    const len = WH * between(r, 0.25, 0.55)
    const th = WH * between(r, 0.01, 0.022)
    const bob = Math.sin(TAU * phase(env.t, env.loopSeconds, freeCycles(1, env.endless, 50 + i)) + i * 1.9) * WH * 0.012
    ctx.globalAlpha = 0.6
    ctx.beginPath()
    ctx.ellipse(cx + bob, cy, len / 2, th, 0, 0, TAU)
    ctx.ellipse(cx + bob + len * 0.18, cy - th * 0.9, len * 0.28, th * 0.8, 0, 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/**
 * A bank of mist: a soft ridge that drifts a whole number of its own periods per
 * loop on top of whatever its layer scrolls. Its period is a whole fraction of the
 * world, so it wraps with everything else.
 */
function drawMist(
  ctx: Ctx,
  env: PaintEnv,
  x0: number,
  x1: number,
  seed: number,
  scroll: number,
  y: number,
  depth: number,
  colour: string,
  alpha: number,
) {
  const { widthPx: WW, heightPx: WH } = env.world
  const period = WW / 3
  for (const [k, a] of [[0, alpha], [1, alpha * 0.7]] as const) {
    const h = makeRidge(hash(seed, k), period, { base: 1, octaves: 3, rough: 0.5 })
    const top = y - k * WH * 0.02
    const offset = scroll + phase(env.t, env.loopSeconds, freeCycles(1 + k, env.endless, seed % 997 + k)) * period
    // A sample step that divides the period, so the bank is cut the same way after it wraps.
    const step = period / Math.max(1, Math.round(period / 6))
    const band = ridgeShape(h, x0, x1, top, WH * 0.05, top + depth, colour, offset, step)
    // Thickest just under its crests, thinning to nothing at the bottom: no hard edge.
    const fade = ctx.createLinearGradient(0, top - WH * 0.05, 0, top + depth)
    fade.addColorStop(0, colour + '00')
    fade.addColorStop(0.35, colour + Math.round(a * 255).toString(16).padStart(2, '0'))
    fade.addColorStop(1, colour + '00')
    ctx.fillStyle = fade
    ctx.beginPath()
    tracePath(ctx, band.pts, false, true)
    ctx.fill()
  }
}

/** A jack-o'-lantern `size` wide, its body centred on (cx, cy), lit to `lit` 0..1. */
function drawLantern(ctx: Ctx, cx: number, cy: number, size: number, face: PumpkinFace | null, lit: number, expression: number) {
  const pk = pumpkin(face, expression)
  if (face) {
    const halo = ctx.createRadialGradient(cx, cy, size * 0.2, cx, cy, size * 1.1)
    halo.addColorStop(0, `rgba(255, 150, 50, ${0.42 * lit})`)
    halo.addColorStop(1, 'rgba(255, 120, 30, 0)')
    ctx.fillStyle = halo
    ctx.fillRect(cx - size * 1.1, cy - size * 1.1, size * 2.2, size * 2.2)
  }
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(size, size)
  fillShapes(ctx, pk.body)
  if (pk.holes.length) {
    ctx.fillStyle = mix('#7a3a10', '#ffd27a', lit)
    for (const w of pk.walls) {
      ctx.beginPath()
      tracePath(ctx, w.pts, w.smooth, true)
      ctx.fill()
    }
    const flame = ctx.createRadialGradient(0, 0.06, 0.02, 0, 0.06, 0.4)
    flame.addColorStop(0, mix('#c86a10', '#fff4b8', lit))
    flame.addColorStop(0.45, mix('#a84a08', '#ffc23a', lit))
    flame.addColorStop(1, mix('#6a2000', '#ff7212', lit))
    ctx.fillStyle = flame
    for (const hole of pk.holes) {
      ctx.beginPath()
      tracePath(ctx, hole.pts, hole.smooth, true)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** A jack-o'-lantern sitting on the ground at (x, ground), with a shadow. */
function drawLanternOnGround(ctx: Ctx, x: number, ground: number, size: number, face: PumpkinFace, key: number, env: PaintEnv) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.beginPath()
  ctx.ellipse(x, ground, size * 0.5, size * 0.07, 0, 0, TAU)
  ctx.fill()
  const lit = candleLevel(env.t, env.loopSeconds, key, env.endless)
  drawLantern(ctx, x, ground - size * PUMPKIN_BOTTOM, size, face, lit, expressionLevel(env.t, env.loopSeconds, key, env.endless))
}

/** Bats flapping across the sky, each crossing the world once per loop and weaving as it goes. */
function drawBats(
  ctx: Ctx,
  env: PaintEnv,
  x0: number,
  x1: number,
  seed: number,
  n: number,
  top: number,
  bottom: number,
  span: [number, number],
  colour: string,
) {
  const { heightPx: WH } = env.world
  const T = env.loopSeconds
  const lap = walkLap(env.world)
  const r = rng(seed)
  for (let i = 0; i < n; i++) {
    const baseX = r() * lap
    const y = between(r, top, bottom)
    const s = WH * between(r, span[0], span[1])
    const dir = r() < 0.5 ? -1 : 1
    const flapHz = between(r, 2.5, 4.5)
    const weaves = 1 + Math.floor(r() * 3)
    const weaveAt = r()
    const weave = between(r, 0.6, 1.6)
    if (env.endless) {
      // A new bat every crossing: where it flies, its size, its wingbeat and its weave.
      const most = WH * span[1]
      eachRepeatIndexed(lapX(env, baseX, dir, lap), lap, x0 - most, x1 + most, (px, k) => {
        const c = rng(hash(seed, 7, i, k))
        const cy = between(c, top, bottom)
        const cs = WH * between(c, span[0], span[1])
        const cHz = between(c, 2.5, 4.5)
        const cWeaves = between(c, 1, 3)
        const cAt = c()
        const cWeave = between(c, 0.6, 1.6)
        ctx.save()
        ctx.translate(px, cy + cs * cWeave * Math.sin(TAU * (phase(env.t, T, cWeaves) + cAt)))
        fillShapes(ctx, bat(cs, phase(env.t, T, T * cHz), colour))
        ctx.restore()
      })
      continue
    }
    const x = baseX + dir * phase(env.t, T, 1) * lap
    const yy = y + s * weave * Math.sin(TAU * (phase(env.t, T, weaves) + weaveAt))
    const shapes = bat(s, phase(env.t, T, wholeCycles(T * flapHz)), colour)
    eachRepeat(x, lap, x0 - s, x1 + s, (px) => {
      ctx.save()
      ctx.translate(px, yy)
      fillShapes(ctx, shapes)
      ctx.restore()
    })
  }
}

/** One thing flying across the sky: a whole lap (`walkLap`) per loop, swooping a whole number of times. */
type Flyer = { x: number; y: number; angle: number; dir: number }

function flight(
  env: PaintEnv,
  baseX: number,
  y: number,
  dir: number,
  swoops: number,
  swoopAt: number,
  swoopPx: number,
): Flyer {
  return { x: lapX(env, baseX, dir, walkLap(env.world)), ...swoop(env, y, dir, swoops, swoopAt, swoopPx), dir }
}

/** The up and down of a flight: `swoops` per loop, starting `swoopAt` of the way through one. */
function swoop(env: PaintEnv, y: number, dir: number, swoops: number, swoopAt: number, swoopPx: number): { y: number; angle: number } {
  const sw = TAU * (phase(env.t, env.loopSeconds, swoops) + swoopAt)
  // Nose down as it drops, nose up as it climbs.
  return { y: y + swoopPx * Math.sin(sw), angle: 0.15 * Math.cos(sw) * dir }
}

// ---------------------------------------------------------------------------
// Pumpkin patch
// ---------------------------------------------------------------------------

const TILE_NIGHTS = ['#1b1230', '#10201c', '#24122a', '#111a2c', '#20160e', '#170f22']

/**
 * Where a tile sits on the surface, which is what its pumpkin is keyed on. Not its
 * column and row: LED tiles start again at each output's own origin, so keying on
 * those gave every output of a span the same patch, flickering in step.
 */
export function tileKey(seed: number, tile: Pick<EnvTile, 'x' | 'y'>, env: Pick<PaintEnv, 'view' | 'localKey'>): number {
  return hash(seed, Math.round(tile.x + env.view.x), Math.round(tile.y + env.view.y), env.localKey)
}

/** The face carved on a tile, from the faces ticked; null when none are. */
export function tileFace(opts: PumpkinOptions, key: number): PumpkinFace | null {
  const faces = PUMPKIN_FACES.filter((f) => opts.faces.includes(f))
  return faces.length ? pick(rng(key), faces) : null
}

export function drawPumpkins(ctx: Ctx, w: number, h: number, opts: PumpkinOptions, env: PaintEnv) {
  if (drawTooManyTiles(ctx, w, h, env)) return
  ctx.fillStyle = '#0b0710'
  ctx.fillRect(0, 0, w, h)
  const T = env.loopSeconds
  const tiles = env.tiles.length ? env.tiles : [{ x: 0, y: 0, width: w, height: h, col: 0, row: 0, ref: 'A1' }]
  for (const t of tiles) {
    const key = tileKey(opts.seed, t, env)
    const face = tileFace(opts, key)
    const lit = !face ? 0 : opts.flicker ? candleLevel(env.t, T, key, env.endless) : 0.8
    const e = face && opts.expressions ? expressionLevel(env.t, T, key, env.endless) : 0
    ctx.save()
    ctx.beginPath()
    ctx.rect(t.x, t.y, t.width, t.height)
    ctx.clip()
    ctx.fillStyle = TILE_NIGHTS[mod(t.col + t.row * 2, TILE_NIGHTS.length)]!
    ctx.fillRect(t.x, t.y, t.width, t.height)
    const size = Math.min(t.width * 0.8, (t.height * 0.84) / (PUMPKIN_BOTTOM - PUMPKIN_TOP))
    const cx = t.x + t.width / 2
    const cy = t.y + t.height / 2 - size * ((PUMPKIN_TOP + PUMPKIN_BOTTOM) / 2)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.beginPath()
    ctx.ellipse(cx, cy + size * 0.35, size * 0.46, size * 0.07, 0, 0, TAU)
    ctx.fill()
    drawLantern(ctx, cx, cy, size, face, lit, e)
    ctx.restore()
  }
}

// ---------------------------------------------------------------------------
// The spooky forest
// ---------------------------------------------------------------------------

const FOREST = {
  hills: '#231b3e',
  far: '#2a2142',
  mid: '#150f24',
  near: '#09060f',
  front: '#030205',
  mist: '#8a80c0',
}

type Planted = { x: number; h: number; seed: number }

/** A row of trees, `n` of them spread over one period of the world, decided before any is drawn. */
function plant(seed: number, period: number, n: number, minH: number, maxH: number): Planted[] {
  const r = rng(seed)
  return Array.from({ length: n }, (_, i) => ({
    x: ((i + between(r, 0.1, 0.9)) / n) * period,
    h: between(r, minH, maxH),
    seed: hash(seed, i),
  }))
}

export function drawSpookyForest(ctx: Ctx, w: number, h: number, opts: SceneOptions, env: PaintEnv) {
  const { widthPx: WW, heightPx: WH } = env.world
  const T = env.loopSeconds
  const widths = layerWidths(opts.speed, env.endless)
  const off = widths.map((n) => layerOffset(n, WW, env.t, T))
  const r = rng(hash(opts.seed, 201))
  const per = (k: number) => Math.max(1, Math.round(WW / (WH * k)))
  const lap = walkLap(env.world)
  const perLap = (k: number) => Math.max(1, Math.round(lap / (WH * k)))
  treeFrame()
  ctx.save()
  ctx.translate(-env.view.x, -env.view.y)
  const x0 = env.view.x - WH * 0.6
  const x1 = env.view.x + w + WH * 0.6

  drawSky(ctx, env, w, h, WH * 0.78, [[0, '#04050e'], [0.5, '#16123a'], [1, '#43305f']])
  drawStars(ctx, env, opts.seed, WH * 0.62)
  const moon = { x: WW * between(r, 0.6, 0.8), y: WH * between(r, 0.17, 0.25), r: WH * 0.1 }
  drawMoon(ctx, moon.x, moon.y, moon.r, opts.seed)
  drawWisps(ctx, env, hash(opts.seed, 203), WH * 0.12, WH * 0.34, '#241c44', 4)

  // Bats far off, behind everything else.
  drawBats(ctx, env, x0, x1, hash(opts.seed, 204), Math.max(6, perLap(0.16)), WH * 0.08, WH * 0.5, [0.014, 0.03], '#0c0915')

  // Layer 0: far hills, and mist along their foot.
  const hills = makeRidge(hash(opts.seed, 220), WW, { base: 3, rough: 0.42 })
  fillShapes(ctx, [ridgeShape(hills, x0, x1, WH * 0.68, WH * 0.13, WH, FOREST.hills, off[0], WW / Math.max(1, Math.round(WW / 6)))])
  drawMist(ctx, env, x0, x1, hash(opts.seed, 221), off[0]!, WH * 0.67, WH * 0.08, FOREST.mist, 0.22)

  // Layer 1: the far wood.
  const g1 = WH * 0.74
  ctx.fillStyle = FOREST.far
  ctx.fillRect(env.view.x, g1 - 1, w, WH - g1 + 1)
  for (const tr of plant(hash(opts.seed, 230), WW, per(0.11), WH * 0.16, WH * 0.3)) {
    eachRepeat(tr.x - off[1]!, WW, x0, x1, (px) => drawTree(ctx, px, g1 + 1, tr.h, tr.seed, 3, FOREST.far))
  }

  // Layer 2: the middle wood, with eyes in it.
  const g2 = WH * 0.83
  ctx.fillStyle = FOREST.mid
  ctx.fillRect(env.view.x, g2 - 1, w, WH - g2 + 1)
  const mid = plant(hash(opts.seed, 250), WW, per(0.3), WH * 0.38, WH * 0.6)
  const er = rng(hash(opts.seed, 251))
  const eyes = mid.map((tr) => ({
    tree: tr,
    has: er() < 0.4,
    dx: between(er, -0.12, 0.12) * tr.h,
    dy: between(er, 0.4, 0.7) * tr.h,
    blinks: cyclesPerLoop(T / between(er, 2, 5), env.endless),
    at: er(),
  }))
  for (const tr of mid) eachRepeat(tr.x - off[2]!, WW, x0, x1, (px) => drawTree(ctx, px, g2 + 1, tr.h, tr.seed, 4, FOREST.mid))
  const eye = WH * 0.0055
  for (const e of eyes) {
    if (!e.has) continue
    const open = (phase(env.t, T, e.blinks) + e.at) % 1 < 0.06 ? 0.12 : 1
    eachRepeat(e.tree.x - off[2]! + e.dx, WW, x0, x1, (px) => {
      const y = g2 - e.dy
      const glow = ctx.createRadialGradient(px, y, 0, px, y, eye * 6)
      glow.addColorStop(0, `rgba(255, 210, 80, ${0.35 * open})`)
      glow.addColorStop(1, 'rgba(255, 210, 80, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(px - eye * 6, y - eye * 6, eye * 12, eye * 12)
      ctx.fillStyle = '#ffd54a'
      for (const s of [-1, 1]) {
        ctx.beginPath()
        ctx.ellipse(px + s * eye * 1.4, y, eye, eye * open, 0, 0, TAU)
        ctx.fill()
      }
    })
  }
  drawMist(ctx, env, x0, x1, hash(opts.seed, 252), off[2]!, g2 - WH * 0.03, WH * 0.07, FOREST.mist, 0.2)

  // Witches, in front of the middle wood and behind the near one.
  const wr = rng(hash(opts.seed, 240))
  for (let i = 0, n = perLap(0.6); i < n; i++) {
    const baseX = wr() * lap
    const y = WH * between(wr, 0.12, 0.4)
    const L = WH * between(wr, 0.15, 0.22)
    const dir = wr() < 0.65 ? 1 : -1
    const cat = wr() < 0.5
    const swoops = 1 + Math.floor(wr() * 2)
    const swoopAt = wr()
    const flutterHz = between(wr, 1.2, 2)
    const drawWitch = (px: number, fy: number, angle: number, size: number, shapes: Shape[]) => {
      // Moonlight catching her edge, then the witch over it.
      const rim = silhouette(shapes, '#6f62a8')
      ctx.save()
      ctx.translate(px, fy)
      ctx.rotate(angle)
      ctx.scale(dir, 1)
      ctx.save()
      ctx.translate(size * 0.008, -size * 0.008)
      fillShapes(ctx, rim)
      ctx.restore()
      fillShapes(ctx, shapes)
      ctx.restore()
    }
    if (env.endless) {
      // A new witch every crossing: her height, size, cat, swoops and broom's flutter.
      eachRepeatIndexed(lapX(env, baseX, dir, lap), lap, x0 - WH * 0.22, x1 + WH * 0.22, (px, k) => {
        const c = rng(hash(opts.seed, 241, i, k))
        const cy = WH * between(c, 0.12, 0.4)
        const cL = WH * between(c, 0.15, 0.22)
        const cCat = c() < 0.5
        const sw = swoop(env, cy, dir, between(c, 1, 2.5), c(), WH * 0.035)
        drawWitch(px, sw.y, sw.angle, cL, witch(cL, phase(env.t, T, T * between(c, 1.2, 2)), cCat, '#0a0710'))
      })
      continue
    }
    const f = flight(env, baseX, y, dir, swoops, swoopAt, WH * 0.035)
    const shapes = witch(L, phase(env.t, T, wholeCycles(T * flutterHz)), cat, '#0a0710')
    eachRepeat(f.x, lap, x0 - L, x1 + L, (px) => drawWitch(px, f.y, f.angle, L, shapes))
  }

  // Layer 3: the near wood — stones, great trunks, and lanterns at their feet.
  const g3 = WH * 0.92
  ctx.fillStyle = FOREST.near
  ctx.fillRect(env.view.x, g3 - 1, w, WH - g3 + 1)
  const sr = rng(hash(opts.seed, 260))
  const stoneCount = per(0.5)
  const stones = Array.from({ length: stoneCount }, (_, i) => ({
    x: ((i + between(sr, 0.1, 0.9)) / stoneCount) * WW,
    w: WH * between(sr, 0.035, 0.06),
    kind: pick(sr, STONE_KINDS),
    tilt: between(sr, -0.2, 0.2),
  }))
  for (const s of stones) {
    const shapes = gravestone(s.w, s.kind, s.tilt, { stone: '#3a3846', side: '#24222e' })
    eachRepeat(s.x - off[3]!, WW, x0, x1, (px) => {
      ctx.save()
      ctx.translate(px, g3 + WH * 0.004)
      fillShapes(ctx, shapes)
      ctx.restore()
    })
  }
  // Great trunks right in front, so tall their crowns are out of the picture.
  for (const tr of plant(hash(opts.seed, 270), WW, per(1.1), WH * 2.0, WH * 2.4)) {
    eachRepeat(tr.x - off[3]!, WW, x0, x1, (px) => drawTree(ctx, px, g3 + WH * 0.02, tr.h, tr.seed, 3, FOREST.near))
  }
  const lr = rng(hash(opts.seed, 280))
  for (let i = 0, n = per(1.1); i < n; i++) {
    const x = ((i + between(lr, 0.1, 0.9)) / n) * WW
    const size = WH * between(lr, 0.06, 0.085)
    const face = pick(lr, PUMPKIN_FACES)
    const key = hash(opts.seed, 281, i)
    eachRepeat(x - off[3]!, WW, x0 - size, x1 + size, (px) => drawLanternOnGround(ctx, px, g3 + WH * 0.012, size, face, key, env))
  }

  // Layer 4: brambles and grass right in front, fastest of all.
  const fr = rng(hash(opts.seed, 290))
  for (let i = 0, n = per(0.18); i < n; i++) {
    const x = ((i + between(fr, 0, 1)) / n) * WW
    const size = WH * between(fr, 0.06, 0.12)
    const seed = hash(opts.seed, 291, i)
    eachRepeat(x - off[4]!, WW, x0, x1, (px) => fillShapes(ctx, grass(px, WH + 1, size, seed, FOREST.front)))
  }
  ctx.fillStyle = FOREST.front
  ctx.fillRect(env.view.x, WH * 0.985, w, WH * 0.015 + 1)
  drawMist(ctx, env, x0, x1, hash(opts.seed, 295), off[4]!, WH * 0.95, WH * 0.06, FOREST.mist, 0.12)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// The haunted house
// ---------------------------------------------------------------------------

/** The hill the house stands on: flat-topped, falling away either side. */
function hillY(x: number, cx: number, top: number, foot: number, half: number): number {
  const d = (x - cx) / half
  return foot - (foot - top) / (1 + d ** 4)
}

export function drawHauntedHouse(ctx: Ctx, w: number, h: number, opts: SceneOptions, env: PaintEnv) {
  const { widthPx: WW, heightPx: WH } = env.world
  const T = env.loopSeconds
  const r = rng(hash(opts.seed, 301))
  ctx.save()
  ctx.translate(-env.view.x, -env.view.y)
  const x0 = env.view.x - WH * 0.6
  const x1 = env.view.x + w + WH * 0.6

  // Where everything is, decided before anything is drawn or skipped.
  treeFrame()
  const houseX = WW * between(r, 0.4, 0.6)
  // From the height on a landscape picture; held to the width on a portrait one, or both ends are cut off.
  const houseH = Math.min(WH * 0.5, WW * 0.68)
  const hillTop = WH * 0.6
  const hillFoot = WH * 0.8
  const hillHalf = WH * 0.55
  const treeSide = r() < 0.5 ? -1 : 1
  const moon = { x: houseX - treeSide * houseH * between(r, 0.24, 0.6), y: WH * between(r, 0.22, 0.28), r: WH * 0.15 }
  const house = hauntedHouse(houseX, hillTop + WH * 0.004, houseH, hash(opts.seed, 302))
  // The ghost haunts a dark window, where it shows; a lit one if every window is lit.
  const unlit = house.windows.map((win, i) => [win, i] as const).filter(([win, i]) => win.state === 'dark' && i < house.windows.length - 1)
  const lit = house.windows.map((win, i) => [win, i] as const).filter(([win, i]) => win.state === 'lit' && i < house.windows.length - 1)
  const choices = unlit.length ? unlit : lit
  let haunted = choices[Math.floor(r() * choices.length)]?.[1] ?? -1
  const ghostAt = r()
  // Endless, the ghost picks a window each time it comes, changing at the start of
  // a visit, when it has not yet appeared.
  if (env.endless && choices.length) {
    const visit = lapNumber(env.t, T, 1, ghostAt)
    haunted = choices[Math.floor(rng(hash(opts.seed, 304, visit))() * choices.length)]![1]
  }

  drawSky(ctx, env, w, h, WH * 0.8, [[0, '#05060f'], [0.55, '#1b1640'], [1, '#4a3462']])
  drawStars(ctx, env, opts.seed + 1, WH * 0.6)
  drawMoon(ctx, moon.x, moon.y, moon.r, opts.seed + 1)
  drawWisps(ctx, env, hash(opts.seed, 303), WH * 0.15, WH * 0.4, '#251d46', 4)

  // Vampires, in the back: they pass behind the tower and the hills.
  const lap = walkLap(env.world)
  const vr = rng(hash(opts.seed, 310))
  for (let i = 0, n = Math.max(2, Math.round(lap / (WH * 0.6))); i < n; i++) {
    const baseX = vr() * lap
    const y = WH * between(vr, 0.08, 0.36)
    const B = WH * between(vr, 0.15, 0.21)
    const dir = vr() < 0.5 ? 1 : -1
    const flapHz = between(vr, 0.7, 1.1)
    const swoops = 1 + Math.floor(vr() * 2)
    const swoopAt = vr()
    const swoopPx = WH * between(vr, 0.03, 0.06)
    const drawVampire = (px: number, fy: number, angle: number, shapes: Shape[]) => {
      ctx.save()
      ctx.translate(px, fy)
      ctx.rotate(angle)
      ctx.scale(dir, 1)
      fillShapes(ctx, shapes)
      ctx.restore()
    }
    if (env.endless) {
      // A new vampire every crossing: height, size, wingbeat and swoops.
      eachRepeatIndexed(lapX(env, baseX, dir, lap), lap, x0 - WH * 0.21, x1 + WH * 0.21, (px, k) => {
        const c = rng(hash(opts.seed, 311, i, k))
        const cy = WH * between(c, 0.08, 0.36)
        const cB = WH * between(c, 0.15, 0.21)
        const cHz = between(c, 0.7, 1.1)
        const sw = swoop(env, cy, dir, between(c, 1, 2.5), c(), WH * between(c, 0.03, 0.06))
        drawVampire(px, sw.y, sw.angle, vampire(cB, phase(env.t, T, T * cHz)))
      })
      continue
    }
    const f = flight(env, baseX, y, dir, swoops, swoopAt, swoopPx)
    const shapes = vampire(B, phase(env.t, T, wholeCycles(T * flapHz)))
    eachRepeat(f.x, lap, x0 - B, x1 + B, (px) => drawVampire(px, f.y, f.angle, shapes))
  }

  const far = makeRidge(hash(opts.seed, 320), WW, { base: 2, rough: 0.45 })
  fillShapes(ctx, [ridgeShape(far, x0, x1, WH * 0.72, WH * 0.1, WH, '#1a1430')])

  // Bats circling the spire: the far half of each orbit behind the house, the near half in front.
  const br = rng(hash(opts.seed, 330))
  const orbit = Array.from({ length: 7 }, () => ({
    rx: WH * between(br, 0.09, 0.2),
    ry: between(br, 0.25, 0.4),
    laps: cyclesPerLoop(T / between(br, 2.5, 4.5), env.endless) * (br() < 0.5 ? -1 : 1),
    at: br(),
    span: WH * between(br, 0.032, 0.045),
    flapHz: between(br, 3, 5),
  }))
  const centre: Pt = [house.spire[0], house.spire[1] + WH * 0.06]
  const drawOrbit = (front: boolean) => {
    for (const b of orbit) {
      const a = TAU * (phase(env.t, T, Math.abs(b.laps)) * Math.sign(b.laps) + b.at)
      if (Math.sin(a) > 0 !== front) continue
      const s = b.span * (0.85 + 0.15 * Math.sin(a))
      ctx.save()
      ctx.translate(centre[0] + b.rx * Math.cos(a), centre[1] + b.rx * b.ry * Math.sin(a))
      fillShapes(ctx, bat(s, phase(env.t, T, cyclesPerLoop(T * b.flapHz, env.endless)), '#0a0710'))
      ctx.restore()
    }
  }
  drawOrbit(false)

  // The hill, the dead tree and the house.
  const hill: Pt[] = [[x0, WH + 2]]
  const step = Math.max(4, WH / 200)
  for (let x = Math.floor(x0 / step) * step; x <= x1 + step; x += step) hill.push([x, hillY(x, houseX, hillTop, hillFoot, hillHalf)])
  hill.push([x1 + step, WH + 2])
  fillShapes(ctx, [{ pts: hill, fill: '#110d1c', smooth: false }])
  const treeX = houseX + treeSide * houseH * 0.94
  drawTree(ctx, treeX, hillY(treeX, houseX, hillTop, hillFoot, hillHalf) + WH * 0.01, houseH * 0.84, hash(opts.seed, 321), 5, '#0c0914')

  fillShapes(ctx, house.body)
  house.windows.forEach((win, i) => {
    const level = candleLevel(env.t, T, hash(opts.seed, 340, i), env.endless)
    if (win.state === 'lit') {
      const glow = ctx.createRadialGradient(win.cx, win.cy, 0, win.cx, win.cy, Math.max(win.w, win.h) * 2)
      glow.addColorStop(0, `rgba(255, 180, 90, ${0.22 * level})`)
      glow.addColorStop(1, 'rgba(255, 180, 90, 0)')
      ctx.fillStyle = glow
      ctx.fillRect(win.cx - win.w * 3, win.cy - win.h * 3, win.w * 6, win.h * 6)
    }
    // Someone at the window, once a loop, and a cold light with them.
    const a = i === haunted ? Math.max(0, Math.sin(TAU * (phase(env.t, T, 1) + ghostAt))) ** 2 : 0
    const pane = win.state === 'lit' ? mix('#b5521a', '#ffd772', level) : mix('#0b0812', '#2c3a66', a)
    fillShapes(ctx, [{ pts: win.pane, fill: pane, smooth: false }])
    if (i === haunted) {
      if (a > 0.01) {
        ctx.save()
        ctx.beginPath()
        tracePath(ctx, win.pane, false, true)
        ctx.clip()
        ctx.translate(win.cx, win.cy + win.h * 0.15)
        fillShapes(ctx, ghost(win.h * 0.95, phase(env.t, T, freeCycles(2, env.endless, 70))).map((s) => ({ ...s, alpha: (s.alpha ?? 1) * a })))
        ctx.restore()
      }
    }
    fillShapes(ctx, win.over)
  })
  drawOrbit(true)

  // The graveyard: ground, railings, a back row of stones, mist.
  const ground = ctx.createLinearGradient(0, WH * 0.76, 0, WH)
  ground.addColorStop(0, '#151124')
  ground.addColorStop(1, '#09070e')
  ctx.fillStyle = ground
  ctx.fillRect(env.view.x, WH * 0.79, w, WH * 0.21 + 1)
  fillShapes(ctx, ironFence(x0, x1, WH * 0.8, WH * 0.075, WH * 0.024, '#07050b'))

  const sr = rng(hash(opts.seed, 350))
  const stone = { stone: '#626777', side: '#3f4250' }
  const rowCount = Math.max(4, Math.round(WW / (WH * 0.17)))
  const row = Array.from({ length: rowCount }, (_, i) => ({
    x: ((i + between(sr, 0.15, 0.85)) / rowCount) * WW,
    w: WH * between(sr, 0.04, 0.06),
    kind: pick(sr, STONE_KINDS),
    tilt: between(sr, -0.18, 0.18),
  }))
  const front = Array.from({ length: Math.max(2, Math.round(WW / (WH * 0.7))) }, () => ({
    x: sr() * WW,
    w: WH * between(sr, 0.09, 0.13),
    kind: pick(sr, STONE_KINDS),
    tilt: between(sr, -0.12, 0.12),
  }))
  const placeStone = (s: (typeof row)[number], y: number) => {
    if (s.x + s.w * 2 < x0 || s.x - s.w * 2 > x1) return
    ctx.save()
    ctx.translate(s.x, y)
    fillShapes(ctx, gravestone(s.w, s.kind, s.tilt, stone))
    const at = stoneInscription(s.kind)
    const size = s.w * 0.22
    if (at !== null && size >= 6) {
      ctx.rotate(s.tilt)
      ctx.fillStyle = '#3a3d48'
      ctx.font = `bold ${Math.round(size)}px Georgia, "Times New Roman", serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('RIP', 0, -s.w * at)
    }
    ctx.restore()
  }
  for (const s of row) placeStone(s, WH * 0.84)
  drawMist(ctx, env, x0, x1, hash(opts.seed, 355), 0, WH * 0.83, WH * 0.06, '#9088c4', 0.22)

  // The dead, walking: zombies one way, skeletons the other, the nearer drawn last.
  const wkr = rng(hash(opts.seed, 360))
  const walkers: Walker[] = []
  for (let i = 0; i < 6; i++) {
    const kind = i % 2 ? 'skeleton' : 'zombie'
    const depth = between(wkr, -0.025, 0.035)
    walkers.push({
      kind,
      x: wkr() * lap,
      y: WH * (0.915 + depth),
      heightPx: WH * between(wkr, 0.18, 0.21) * (1 + depth * 3),
      dir: kind === 'zombie' ? 1 : -1,
      look: hash(opts.seed, 361, i),
    })
  }
  const drawWalker = (wk: Walker, px: number, gait: number) => {
    const k = wk.heightPx
    const shapes = mapShapes(wk.kind === 'zombie' ? zombie(gait, wk.look) : skeleton(gait), ([sx, sy]) => [sx * k * wk.dir, -sy * k], k)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
    ctx.beginPath()
    ctx.ellipse(px, wk.y, k * 0.16, k * 0.025, 0, 0, TAU)
    ctx.fill()
    ctx.save()
    ctx.translate(px, wk.y)
    fillShapes(ctx, shapes)
    ctx.restore()
  }
  if (env.endless) {
    // A new one every crossing: zombie or skeleton, how near, how tall and how it
    // looks come from which crossing it is (a skeleton has no looks of its own, so
    // only its kind can make it new). Each still walks its slot's way. All of them
    // are sorted together, nearest last.
    const crossing: { wk: Walker; x: number; gait: number }[] = []
    const most = WH * 0.21 * 1.11
    walkers.forEach((slot, i) => {
      eachRepeatIndexed(lapX(env, slot.x, slot.dir, lap), lap, x0 - most * 1.6, x1 + most * 1.6, (_px, k) => {
        const c = rng(hash(opts.seed, 362, i, k))
        const depth = between(c, -0.025, 0.035)
        const heightPx = WH * between(c, 0.18, 0.21) * (1 + depth * 3)
        const wk: Walker = {
          ...slot,
          kind: c() < 0.5 ? 'zombie' : 'skeleton',
          y: WH * (0.915 + depth),
          heightPx,
          look: hash(opts.seed, 363, i, k),
        }
        const { x, gait } = walkerAt(wk, lap, env.t, T, true)
        crossing.push({ wk, x: x + k * lap, gait })
      })
    })
    crossing.sort((a, b) => a.wk.y - b.wk.y)
    for (const c of crossing) drawWalker(c.wk, c.x, c.gait)
  } else {
    walkers.sort((a, b) => a.y - b.y)
    for (const wk of walkers) {
      const { x, gait } = walkerAt(wk, lap, env.t, T)
      eachRepeat(x, lap, x0 - wk.heightPx, x1 + wk.heightPx, (px) => drawWalker(wk, px, gait))
    }
  }

  // In front of them: big stones, lanterns, grass and a last wisp of mist.
  for (const s of front) placeStone(s, WH * 1.01)
  const lr = rng(hash(opts.seed, 370))
  for (let i = 0, n = Math.max(2, Math.round(WW / (WH * 0.9))); i < n; i++) {
    const x = ((i + between(lr, 0.1, 0.9)) / n) * WW
    const size = WH * between(lr, 0.08, 0.1)
    const face = pick(lr, PUMPKIN_FACES)
    if (x + size < x0 || x - size > x1) continue
    drawLanternOnGround(ctx, x, WH * 0.985, size, face, hash(opts.seed, 371, i), env)
  }
  const gr = rng(hash(opts.seed, 380))
  for (let i = 0, n = Math.max(6, Math.round(WW / (WH * 0.12))); i < n; i++) {
    const x = ((i + between(gr, 0, 1)) / n) * WW
    const size = WH * between(gr, 0.04, 0.08)
    const seed = hash(opts.seed, 381, i)
    if (x + size < x0 || x - size > x1) continue
    fillShapes(ctx, grass(x, WH + 1, size, seed, '#050409'))
  }
  drawMist(ctx, env, x0, x1, hash(opts.seed, 390), 0, WH * 0.95, WH * 0.06, '#9088c4', 0.12)
  ctx.restore()
}
