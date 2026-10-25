/**
 * The broken wall: what a wall with things wrong with it looks like.
 *
 * For training and for showing a client what "one dead module" means before it
 * happens on their show. Any other pattern is drawn first, as the picture, and
 * then a seeded share of the tiles get one fault each: dead tiles and modules,
 * calibration and batch mismatches, a lost colour channel, a scrambled colour
 * order, scan-line failures, dead pixels, swapped and shifted tiles, a module
 * mounted upside down, seams, a frozen tile, flicker and data noise.
 *
 * WHAT IS PURE
 * ============
 * Which tile gets which fault (`assignFaults`) and what each fault does to the
 * pixels (`applyFault`, on a plain RGBA array) are both pure and tested. The
 * canvas part only renders the base pattern, hands its pixels over, and puts
 * them back.
 *
 * The faults are applied at the canvas's real device resolution, read from the
 * context's transform, so the preview shows the same dead pixels the export
 * does, only fewer of them.
 */

import type { BrokenFault, BrokenWallOptions } from '../types'
import type { Ctx } from './draw'
import type { EnvTile, PaintEnv } from './env'
import { hash, rng } from './random'
import { cyclesPerLoop, phase, wholeCycles } from './loop'
import { drawTooManyTiles } from './novelty'

export const FAULT_LABELS: Record<BrokenFault, string> = {
  'dead-tile': 'Dead tile',
  'dead-module': 'Dead module',
  calibration: 'Calibration off',
  batch: 'Different batch',
  'missing-channel': 'Lost a colour',
  'colour-order': 'Wrong RGB order',
  'scan-lines': 'Scan fault',
  'dead-pixels': 'Dead pixels',
  swapped: 'Mapped to the wrong place',
  offset: 'Mapping offset',
  'upside-down': 'Module upside down',
  seams: 'Seam',
  frozen: 'Frozen',
  flicker: 'Flicker',
  noise: 'Data noise',
}

export const ALL_FAULTS = Object.keys(FAULT_LABELS) as BrokenFault[]

export type FaultPlan = {
  fault: BrokenFault
  /** Fault-specific numbers, all drawn from the seed. */
  a: number
  b: number
  c: number
  /** For `swapped`: the tile whose picture this one shows. */
  partner?: number
}

/** Where a tile is, for deciding its fault. Only position and size matter. */
export type TileKey = { x: number; y: number; width: number; height: number }

/**
 * Which tiles are faulty and how.
 *
 * Each tile decides for itself, from the seed and its own position: whether it
 * is one of the `faultyPct` that are broken, which of the enabled faults it
 * has, and that fault's numbers. Deciding by position rather than by a tile's
 * place in a list is what makes outputs agree — on a span, a tile cut by the
 * join gets the same fault on both outputs, and a tile is only ever broken
 * once. `origin` is where this canvas sits on the surface; `key` separates
 * outputs that are not spanned, so six identical projectors do not all lose
 * the same tile. `frozen` is dropped on a still picture, where it would look
 * exactly like a working tile.
 */
export function assignFaults(
  tiles: TileKey[],
  opts: Pick<BrokenWallOptions, 'seed' | 'faultyPct' | 'faults'>,
  baseMoves: boolean,
  origin: { x: number; y: number } = { x: 0, y: 0 },
  key = 0,
): Map<number, FaultPlan> {
  const plan = new Map<number, FaultPlan>()
  const faults = opts.faults.filter((f) => f !== 'frozen' || baseMoves)
  if (!faults.length || !tiles.length) return plan
  const share = Math.max(0, Math.min(100, opts.faultyPct)) / 100
  tiles.forEach((t, i) => {
    const r = rng(hash(opts.seed, 0xb40c, key, Math.round(t.x + origin.x), Math.round(t.y + origin.y)))
    if (r() >= share) return
    const fault = faults[Math.min(faults.length - 1, Math.floor(r() * faults.length))]!
    const p: FaultPlan = { fault, a: r(), b: r(), c: r() }
    if (fault === 'swapped') {
      // A mapping error: this tile shows its neighbour's picture.
      const right = tiles.findIndex((n) => Math.abs(n.x - (t.x + t.width)) < 0.5 && Math.abs(n.y - t.y) < 0.5)
      const left = tiles.findIndex((n) => Math.abs(n.x + n.width - t.x) < 0.5 && Math.abs(n.y - t.y) < 0.5)
      const partner = right >= 0 ? right : left
      if (partner < 0) return
      p.partner = partner
    }
    plan.set(i, p)
  })
  return plan
}

/** A plain RGBA buffer, the shape of an ImageData. */
export type Pixels = { data: Uint8ClampedArray; width: number; height: number }

export type IRect = { x: number; y: number; w: number; h: number }

function clampRect(r: IRect, px: Pixels): IRect {
  const x0 = Math.max(0, Math.floor(r.x))
  const y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(px.width, Math.ceil(r.x + r.w))
  const y1 = Math.min(px.height, Math.ceil(r.y + r.h))
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
}

function forEach(px: Pixels, r: IRect, f: (i: number, x: number, y: number) => void) {
  const c = clampRect(r, px)
  for (let y = c.y; y < c.y + c.h; y++) {
    for (let x = c.x; x < c.x + c.w; x++) f((y * px.width + x) * 4, x, y)
  }
}

/** One module of a tile, by index, in a modulesX x modulesY split. */
export function moduleRect(tile: IRect, modulesX: number, modulesY: number, index: number): IRect {
  const mx = Math.max(1, Math.round(modulesX))
  const my = Math.max(1, Math.round(modulesY))
  const i = Math.abs(Math.floor(index)) % (mx * my)
  const cx = i % mx
  const cy = Math.floor(i / mx)
  const x0 = tile.x + (tile.w * cx) / mx
  const y0 = tile.y + (tile.h * cy) / my
  return {
    x: Math.round(x0),
    y: Math.round(y0),
    w: Math.round(tile.x + (tile.w * (cx + 1)) / mx) - Math.round(x0),
    h: Math.round(tile.y + (tile.h * (cy + 1)) / my) - Math.round(y0),
  }
}

/**
 * Apply one fault to one tile's pixels, in place.
 *
 * `source` is the unbroken picture, for the faults that move pixels rather than
 * change them; `frozen` is the picture at t = 0. `noiseState` is the frame's
 * noise seed, and `flickerOn` whether a flickering tile is lit this frame.
 */
export function applyFault(
  px: Pixels,
  source: Pixels,
  tile: IRect,
  plan: FaultPlan,
  ctx: {
    modulesX: number
    modulesY: number
    /** Device pixels per painter unit, so faults keep their size in the preview. */
    scale: number
    partnerRect?: IRect
    frozen?: Pixels
    noiseState?: number
    flickerLevel?: number
  },
) {
  const d = px.data
  const moduleIndex = Math.floor(plan.a * ctx.modulesX * ctx.modulesY)
  switch (plan.fault) {
    case 'dead-tile':
      forEach(px, tile, (i) => {
        d[i] = d[i + 1] = d[i + 2] = 0
      })
      return
    case 'dead-module':
      forEach(px, moduleRect(tile, ctx.modulesX, ctx.modulesY, moduleIndex), (i) => {
        d[i] = d[i + 1] = d[i + 2] = 0
      })
      return
    case 'calibration': {
      // Brightness and white point both off: dimmer and tinted, or hot.
      const gain = 0.72 + plan.b * 0.5
      const tint = [1 + (plan.c - 0.5) * 0.35, 1 - (plan.c - 0.5) * 0.15, 1 - (plan.c - 0.5) * 0.35]
      forEach(px, tile, (i) => {
        d[i] = d[i]! * gain * tint[0]!
        d[i + 1] = d[i + 1]! * gain * tint[1]!
        d[i + 2] = d[i + 2]! * gain * tint[2]!
      })
      return
    }
    case 'batch': {
      // Subtle on purpose: a different LED bin is a few percent, not a disaster.
      const shift = plan.b < 0.5 ? [0.96, 1.04, 0.95] : [1.05, 0.96, 1.02]
      forEach(px, tile, (i) => {
        d[i] = d[i]! * shift[0]!
        d[i + 1] = d[i + 1]! * shift[1]!
        d[i + 2] = d[i + 2]! * shift[2]!
      })
      return
    }
    case 'missing-channel': {
      const ch = Math.floor(plan.b * 3)
      forEach(px, tile, (i) => {
        d[i + ch] = 0
      })
      return
    }
    case 'colour-order': {
      // R and B swapped (BGR), or a rotation (GBR) — the receiving card's data group order.
      const rotate = plan.b < 0.5
      forEach(px, tile, (i) => {
        const r = d[i]!
        const g = d[i + 1]!
        const b = d[i + 2]!
        if (rotate) {
          d[i] = g
          d[i + 1] = b
          d[i + 2] = r
        } else {
          d[i] = b
          d[i + 2] = r
        }
      })
      return
    }
    case 'scan-lines': {
      // One module loses every Nth line, or its whole lower half.
      const m = moduleRect(tile, ctx.modulesX, ctx.modulesY, moduleIndex)
      if (plan.b < 0.5) {
        const every = Math.max(2, Math.round((2 + Math.floor(plan.c * 6)) * ctx.scale))
        const lw = Math.max(1, Math.round(ctx.scale))
        forEach(px, m, (i, _x, y) => {
          if ((y - m.y) % every < lw) d[i] = d[i + 1] = d[i + 2] = 0
        })
      } else {
        forEach(px, { x: m.x, y: m.y + m.h / 2, w: m.w, h: m.h / 2 }, (i) => {
          d[i] = d[i]! * 0.15
          d[i + 1] = d[i + 1]! * 0.15
          d[i + 2] = d[i + 2]! * 0.15
        })
      }
      return
    }
    case 'dead-pixels': {
      const r = rng(hash(Math.floor(plan.a * 1e9), tile.x, tile.y))
      const count = Math.max(6, Math.round((tile.w * tile.h) / (ctx.scale * ctx.scale) / 600))
      const s = Math.max(1, Math.round(ctx.scale))
      for (let k = 0; k < count; k++) {
        const x = Math.floor(tile.x + r() * tile.w)
        const y = Math.floor(tile.y + r() * tile.h)
        const stuck = r()
        const c: [number, number, number] =
          stuck < 0.55 ? [0, 0, 0] : stuck < 0.7 ? [255, 0, 0] : stuck < 0.85 ? [0, 255, 0] : [0, 0, 255]
        forEach(px, { x, y, w: s, h: s }, (i) => {
          d[i] = c[0]
          d[i + 1] = c[1]
          d[i + 2] = c[2]
        })
      }
      return
    }
    case 'swapped':
      if (ctx.partnerRect) copyRect(source, ctx.partnerRect, px, tile)
      return
    case 'offset': {
      const dx = Math.round((plan.b - 0.5) * tile.w * 0.3) || Math.round(4 * ctx.scale)
      const dy = Math.round((plan.c - 0.5) * tile.h * 0.2)
      forEach(px, tile, (i, x, y) => {
        const sx = x - dx
        const sy = y - dy
        const inside = sx >= tile.x && sx < tile.x + tile.w && sy >= tile.y && sy < tile.y + tile.h
        if (!inside || sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) {
          d[i] = d[i + 1] = d[i + 2] = 0
          return
        }
        const j = (sy * source.width + sx) * 4
        d[i] = source.data[j]!
        d[i + 1] = source.data[j + 1]!
        d[i + 2] = source.data[j + 2]!
      })
      return
    }
    case 'upside-down': {
      const m = clampRect(moduleRect(tile, ctx.modulesX, ctx.modulesY, moduleIndex), px)
      forEach(px, m, (i, x, y) => {
        const sx = m.x + m.w - 1 - (x - m.x)
        const sy = m.y + m.h - 1 - (y - m.y)
        const j = (sy * source.width + sx) * 4
        d[i] = source.data[j]!
        d[i + 1] = source.data[j + 1]!
        d[i + 2] = source.data[j + 2]!
      })
      return
    }
    case 'frozen':
      if (ctx.frozen) copyRect(ctx.frozen, tile, px, tile)
      return
    case 'flicker': {
      const level = ctx.flickerLevel ?? 1
      forEach(px, tile, (i) => {
        d[i] = d[i]! * level
        d[i + 1] = d[i + 1]! * level
        d[i + 2] = d[i + 2]! * level
      })
      return
    }
    case 'noise': {
      const r = rng(hash(ctx.noiseState ?? 0, tile.x, tile.y))
      const block = Math.max(1, Math.round(ctx.scale * 2))
      const c = clampRect(tile, px)
      for (let y = c.y; y < c.y + c.h; y += block) {
        for (let x = c.x; x < c.x + c.w; x += block) {
          if (r() > 0.25) continue
          const v = [r() * 255, r() * 255, r() * 255]
          forEach(px, { x, y, w: block, h: block }, (i) => {
            d[i] = v[0]!
            d[i + 1] = v[1]!
            d[i + 2] = v[2]!
          })
        }
      }
      return
    }
    case 'seams':
      // Drawn as lines afterwards; nothing to do to the pixels.
      return
  }
}

function copyRect(from: Pixels, fromRect: IRect, to: Pixels, toRect: IRect) {
  const a = clampRect(fromRect, from)
  const b = clampRect(toRect, to)
  const w = Math.min(a.w, b.w)
  const h = Math.min(a.h, b.h)
  for (let y = 0; y < h; y++) {
    const si = ((a.y + y) * from.width + a.x) * 4
    const di = ((b.y + y) * to.width + b.x) * 4
    to.data.set(from.data.subarray(si, si + w * 4), di)
  }
}

/** Flicker brightness at time t: hard on/off, fast, a whole number of times per loop (endless: its own rate). */
export function flickerLevel(t: number, loopSeconds: number, plan: FaultPlan, endless = false): number {
  const cycles = cyclesPerLoop(loopSeconds * (6 + plan.b * 8), endless)
  const p = phase(t, loopSeconds, cycles)
  return p < 0.35 + plan.c * 0.3 ? 0.2 : 1
}

/** Noise state at time t: a new pattern a dozen times a second, repeating with the loop (endless: never). */
export function noiseState(t: number, loopSeconds: number, seed: number, endless = false): number {
  if (endless) return hash(seed, Math.floor(t * 12))
  const states = wholeCycles(loopSeconds * 12)
  return hash(seed, Math.floor(phase(t, loopSeconds, 1) * states) % states)
}

export function drawBrokenWall(
  ctx: Ctx,
  w: number,
  h: number,
  opts: BrokenWallOptions,
  env: PaintEnv,
  paintBase: (c: Ctx, w: number, h: number, t: number) => void,
  baseMoves: boolean,
) {
  if (drawTooManyTiles(ctx, w, h, env)) return
  const m = ctx.getTransform()
  // Device pixels per painter unit, each way: a composition region can be
  // scaled differently across and down onto its output.
  const scale = Math.max(1e-3, Math.abs(m.a))
  const dw = Math.max(1, Math.round(w * scale))
  const dh = Math.max(1, Math.round(h * Math.max(1e-3, Math.abs(m.d))))
  const tiles = env.tiles.length ? env.tiles : [{ x: 0, y: 0, width: w, height: h, col: 0, row: 0, ref: 'A1' }]
  const plan = assignFaults(tiles, opts, baseMoves, env.view, env.localKey)

  const render = (t: number) => {
    const c = document.createElement('canvas')
    c.width = dw
    c.height = dh
    const cx = c.getContext('2d', { willReadFrequently: true })
    if (!cx) throw new Error('Could not get a 2D canvas context.')
    cx.scale(dw / w, dh / h)
    paintBase(cx, w, h, t)
    return { canvas: c, ctx: cx, pixels: cx.getImageData(0, 0, dw, dh) }
  }

  const now = render(env.t)
  const source: Pixels = { data: new Uint8ClampedArray(now.pixels.data), width: dw, height: dh }
  const needsFrozen = [...plan.values()].some((p) => p.fault === 'frozen')
  const frozen = needsFrozen ? render(0).pixels : undefined
  const toDevice = (t: EnvTile): IRect => ({
    x: Math.round(t.x * (dw / w)),
    y: Math.round(t.y * (dh / h)),
    w: Math.round((t.x + t.width) * (dw / w)) - Math.round(t.x * (dw / w)),
    h: Math.round((t.y + t.height) * (dh / h)) - Math.round(t.y * (dh / h)),
  })

  for (const [index, p] of plan) {
    const tile = tiles[index]!
    applyFault(now.pixels, source, toDevice(tile), p, {
      modulesX: opts.modulesX,
      modulesY: opts.modulesY,
      scale,
      partnerRect: p.partner !== undefined && tiles[p.partner] ? toDevice(tiles[p.partner]!) : undefined,
      frozen,
      noiseState: noiseState(env.t, env.loopSeconds, hash(opts.seed, index), env.endless),
      flickerLevel: flickerLevel(env.t, env.loopSeconds, p, env.endless),
    })
  }
  now.ctx.putImageData(now.pixels, 0, 0)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, m.e, m.f)
  ctx.drawImage(now.canvas, 0, 0)
  ctx.restore()

  // Seams: a bright line where cabinets sit too close, a dark one where they gap.
  for (const [index, p] of plan) {
    if (p.fault !== 'seams') continue
    const t = tiles[index]!
    const lw = Math.max(1, Math.round(2 / scale))
    ctx.fillStyle = p.b < 0.5 ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.85)'
    ctx.fillRect(t.x, t.y, lw, t.height)
    ctx.fillRect(t.x, t.y, t.width, lw)
  }

  if (opts.labels) {
    for (const [index, p] of plan) {
      const t = tiles[index]!
      const size = Math.max(8, Math.min(t.width / 9, t.height / 6))
      ctx.save()
      ctx.font = `600 ${Math.round(size)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const text = FAULT_LABELS[p.fault]
      const tw = ctx.measureText(text).width
      ctx.fillStyle = 'rgba(0,0,0,0.75)'
      ctx.fillRect(t.x + t.width / 2 - tw / 2 - size * 0.4, t.y + t.height - size * 1.9, tw + size * 0.8, size * 1.5)
      ctx.fillStyle = '#ffcc33'
      ctx.fillText(text, t.x + t.width / 2, t.y + t.height - size * 1.15)
      ctx.restore()
    }
  }
}
