/**
 * The scale-aware patterns (rulers, bananas, life-size dinosaurs) and the
 * hamsters.
 *
 * Scale-aware means drawn from the output's pixel pitch: a 190 mm banana is
 * 190 / pitch pixels long, a 12.3 m Tyrannosaurus is 12 300 / pitch. The
 * layout maths is pure and lives next to its painter, so the tests can ask
 * where things go without a canvas.
 */

import type {
  BananaOptions,
  DinosaurId,
  DinosaurOptions,
  HamsterOptions,
  RulerOptions,
  ScaleOptions,
} from '../types'
import type { Ctx } from './draw'
import type { EnvTile, PaintEnv } from './env'
import { bananaBunch, BANANA_LENGTH_MM } from './art/bananas'
import {
  bananasOnTheGround,
  HUMAN_HEIGHT_M,
  human,
  LINEUP_ORDER,
  poseDinosaur,
  shapesBounds,
  SPECIES,
} from './art/dinosaurs'
import { DANCES, FRAMES, hamsterFrame, PALETTE, SPRITE_SIZE } from './art/hamster'
import { fillShapes, mapShapes, type Shape } from './art/shapes'
import { cyclesPerLoop, lapNumber, phase } from './loop'
import { hash, pick, rng } from './random'
import { formatLength, rulerTicks } from './scale'

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

/** A short line of text on a dark plate, so it reads on any picture. */
function plate(ctx: Ctx, text: string, x: number, y: number, size: number, align: 'left' | 'center' = 'center', colour = '#ffffff') {
  ctx.save()
  ctx.font = `${Math.round(size)}px ${SANS}`
  ctx.textBaseline = 'middle'
  const w = ctx.measureText(text).width
  const pad = size * 0.45
  const left = align === 'center' ? x - w / 2 - pad : x - pad
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
  ctx.fillRect(left, y - size * 0.75, w + pad * 2, size * 1.5)
  ctx.fillStyle = colour
  ctx.textAlign = 'left'
  ctx.fillText(text, left + pad, y)
  ctx.restore()
}

/**
 * What a per-tile pattern draws instead of itself when the tile size would make
 * an absurd number of tiles. Returns true when it has drawn it.
 */
export function drawTooManyTiles(ctx: Ctx, w: number, h: number, env: PaintEnv): boolean {
  if (!env.tooManyTiles) return false
  ctx.fillStyle = '#202020'
  ctx.fillRect(0, 0, w, h)
  const size = Math.max(12, Math.min(w, h) / 28)
  plate(ctx, `That tile size makes about ${env.tooManyTiles.toLocaleString('en-GB')} tiles. Check the tile width and height.`, w / 2, h / 2, size, 'center', '#ffcc33')
  return true
}

/** The stamp every scale-aware pattern carries when it had to guess the pitch. */
export function drawPitchWarning(ctx: Ctx, w: number, h: number, env: PaintEnv) {
  if (!env.pitchAssumed) return
  const size = Math.max(12, Math.min(w, h) / 34)
  plate(
    ctx,
    `Pitch assumed: ${round(env.mmPerPx, 3)} mm — this output has none of its own, so sizes are only as right as that guess`,
    w / 2,
    h - size * 1.6,
    size,
    'center',
    '#ffcc33',
  )
}

function round(v: number, places: number): number {
  const f = 10 ** places
  return Math.round(v * f) / f
}

// ---------------------------------------------------------------------------
// Rulers
// ---------------------------------------------------------------------------

/** Band thickness for a ruler, in painter pixels. */
export function rulerBand(w: number, h: number): number {
  return Math.round(Math.max(36, Math.min(220, Math.min(w, h) * 0.075)))
}

export function drawRulers(ctx: Ctx, w: number, h: number, opts: RulerOptions, scale: ScaleOptions, env: PaintEnv) {
  const mm = env.mmPerPx
  ctx.fillStyle = opts.background
  ctx.fillRect(0, 0, w, h)
  const band = rulerBand(w, h)
  const fontSize = Math.max(10, Math.round(band * 0.27))

  // Ticks are worked out a little past each end of the canvas, so a label
  // whose tick sits just over the join on the next output is still drawn here
  // where its text runs on. The overhang is only ever clipped, never placed.
  const over = band * 4
  const shift = (r: ReturnType<typeof rulerTicks>) => ({
    ...r,
    ticks: r.ticks.map((t) => ({ ...t, px: t.px - over })),
  })
  const horizontal = (fromMm: number) =>
    shift(rulerTicks({ lengthPx: w + 2 * over, mmPerPx: mm, startMm: fromMm - over * mm, direction: 1, units: scale.units }))
  const worldBottomMm = (env.world.heightPx - env.view.y) * mm
  const vertical = () =>
    opts.fromFloor
      ? shift(rulerTicks({ lengthPx: h + 2 * over, mmPerPx: mm, startMm: scale.floorMm + worldBottomMm + over * mm, direction: -1, units: scale.units }))
      : shift(rulerTicks({ lengthPx: h + 2 * over, mmPerPx: mm, startMm: (env.view.y - over) * mm, direction: 1, units: scale.units }))

  const xTicks = horizontal(env.view.x * mm)
  const yTicks = vertical()

  // Faint lines across the field at every labelled distance.
  if (opts.gridLines) {
    ctx.fillStyle = opts.colour
    ctx.globalAlpha = 0.18
    for (const t of xTicks.ticks) if (t.label) ctx.fillRect(t.px, 0, 1, h)
    for (const t of yTicks.ticks) if (t.label) ctx.fillRect(0, t.px, w, 1)
    ctx.globalAlpha = 1
  }

  // On a spanned surface the rulers run along the SURFACE's edges, so only
  // the outputs that hold an edge show that ruler — two projectors blending
  // over one another must not each draw their own.
  const top = -env.view.y
  const bottom = env.world.heightPx - env.view.y
  const left = -env.view.x
  const right = env.world.widthPx - env.view.x
  const lengths = [0.22, 0.38, 0.58, 0.82]
  const drawH = (atTop: boolean) => {
    const edge = atTop ? top : bottom
    if (atTop ? edge + band <= 0 || edge >= h : edge <= 0 || edge - band >= h) return
    ctx.save()
    ctx.translate(0, atTop ? edge : edge - h)
    const y0 = atTop ? 0 : h - band
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, y0, w, band)
    ctx.fillStyle = opts.colour
    ctx.font = `${fontSize}px ${MONO}`
    ctx.textBaseline = atTop ? 'top' : 'bottom'
    ctx.textAlign = 'left'
    for (const t of xTicks.ticks) {
      const len = Math.round(band * (lengths[t.level] ?? 0.82))
      ctx.fillRect(t.px, atTop ? 0 : h - len, 1, len)
      if (t.label) ctx.fillText(t.label, t.px + 4, atTop ? band * 0.5 : h - band * 0.5)
    }
    // The edge the ruler measures from.
    ctx.fillRect(0, atTop ? band - 1 : h - band, w, 1)
    ctx.restore()
  }
  const drawV = (atLeft: boolean) => {
    const edge = atLeft ? left : right
    if (atLeft ? edge + band <= 0 || edge >= w : edge <= 0 || edge - band >= w) return
    ctx.save()
    ctx.translate(atLeft ? edge : edge - w, 0)
    const x0 = atLeft ? 0 : w - band
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(x0, 0, band, h)
    ctx.fillStyle = opts.colour
    ctx.font = `${fontSize}px ${MONO}`
    ctx.textBaseline = 'bottom'
    ctx.textAlign = atLeft ? 'left' : 'right'
    for (const t of yTicks.ticks) {
      const len = Math.round(band * (lengths[t.level] ?? 0.82))
      ctx.fillRect(atLeft ? 0 : w - len, t.px, len, 1)
      if (t.label) ctx.fillText(t.label, atLeft ? band * 0.42 : w - band * 0.42, t.px - 2)
    }
    ctx.fillRect(atLeft ? band - 1 : w - band, 0, 1, h)
    ctx.restore()
  }

  if (opts.top) drawH(true)
  if (opts.bottom) drawH(false)
  if (opts.left) drawV(true)
  if (opts.right) drawV(false)

  // What it all adds up to, in the middle of the surface.
  const W = env.world.widthPx
  const H = env.world.heightPx
  const size = Math.max(14, Math.min(W, H) / 16)
  const lines = [
    `${formatLength(W * mm, scale.units)} × ${formatLength(H * mm, scale.units)}`,
    `${Math.round(W)} × ${Math.round(H)} px at ${round(mm, 3)} mm`,
    `ticks within ±${round(mm / 2, 3)} mm of true`,
  ]
  const cx = W / 2 - env.view.x
  const cy = H / 2 - env.view.y
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = opts.colour
  ctx.font = `600 ${Math.round(size)}px ${SANS}`
  ctx.fillText(lines[0]!, cx, cy - size * 0.7)
  ctx.font = `${Math.round(size * 0.42)}px ${MONO}`
  ctx.globalAlpha = 0.85
  ctx.fillText(lines[1]!, cx, cy + size * 0.25)
  ctx.fillText(lines[2]!, cx, cy + size * 0.85)
  ctx.restore()

  drawPitchWarning(ctx, w, h, env)
}

// ---------------------------------------------------------------------------
// Bananas
// ---------------------------------------------------------------------------

let bunchCache: { shapes: Shape[]; cx: number; cy: number; w: number; h: number } | null = null

/** The bunch, centred on its own bounding box, in millimetres with y DOWN. */
function bunchCentred() {
  if (bunchCache) return bunchCache
  const raw = bananaBunch(1)
  const b = shapesBounds(raw)
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  bunchCache = {
    shapes: mapShapes(raw, ([x, y]) => [x - cx, -(y - cy)]),
    cx: 0,
    cy: 0,
    w: b.x1 - b.x0,
    h: b.y1 - b.y0,
  }
  return bunchCache
}

/** Size of the bunch, in millimetres. */
export function bunchSizeMm(): { w: number; h: number } {
  const b = bunchCentred()
  return { w: b.w, h: b.h }
}

/** How many bananas, laid end to end, a length is. */
export function inBananas(mm: number): number {
  return mm / BANANA_LENGTH_MM
}

export function drawBananas(ctx: Ctx, w: number, h: number, opts: BananaOptions, scale: ScaleOptions, env: PaintEnv) {
  if (opts.layout === 'per-tile' && drawTooManyTiles(ctx, w, h, env)) return
  ctx.fillStyle = opts.background
  ctx.fillRect(0, 0, w, h)
  const b = bunchCentred()
  const k = 1 / env.mmPerPx

  const at = (x: number, y: number, clip?: EnvTile) => {
    ctx.save()
    if (clip) {
      ctx.beginPath()
      ctx.rect(clip.x, clip.y, clip.width, clip.height)
      ctx.clip()
    }
    ctx.translate(x, y)
    ctx.scale(k, k)
    fillShapes(ctx, b.shapes)
    ctx.restore()
  }

  if (opts.layout === 'per-tile' && env.tiles.length) {
    for (const t of env.tiles) at(t.x + t.width / 2, t.y + t.height / 2, t)
  } else {
    // Once, in the middle of the whole surface when spanned.
    at(env.world.widthPx / 2 - env.view.x, env.world.heightPx / 2 - env.view.y)
  }

  if (opts.caption) {
    const W = env.world.widthPx
    const H = env.world.heightPx
    const size = Math.max(12, Math.min(W, H) / 30)
    const wide = inBananas(W * env.mmPerPx)
    const high = inBananas(H * env.mmPerPx)
    plate(
      ctx,
      `Banana for scale — a bunch of five, each ${BANANA_LENGTH_MM / 10} cm. ` +
        `This is ${wide.toFixed(1)} bananas wide and ${high.toFixed(1)} high (${formatLength(W * env.mmPerPx, scale.units)} × ${formatLength(H * env.mmPerPx, scale.units)}).`,
      W / 2 - env.view.x,
      H - env.view.y - size * (env.pitchAssumed ? 3.8 : 1.6),
      size,
    )
  }
  drawPitchWarning(ctx, w, h, env)
}

// ---------------------------------------------------------------------------
// Life-size dinosaurs
// ---------------------------------------------------------------------------

export type LineupItem = {
  kind: DinosaurId | 'human' | 'banana'
  label: string
  /** Left edge, metres from the lineup's origin. */
  xM: number
  widthM: number
  heightM: number
  /** Shapes in metres, y up, left edge at x = 0. */
  shapes: () => Shape[]
}

/**
 * Where everything stands, left to right, in metres. Pure, so the UI can jump
 * the pan to a particular animal and the tests can check nothing overlaps.
 */
export function lineup(opts: DinosaurOptions): LineupItem[] {
  const items: Omit<LineupItem, 'xM'>[] = []
  const add = (kind: LineupItem['kind'], label: string, raw: () => Shape[]) => {
    const shapes = raw()
    const b = shapesBounds(shapes)
    items.push({
      kind,
      label,
      widthM: b.x1 - b.x0,
      heightM: b.y1,
      shapes: () => mapShapes(raw(), ([x, y]) => [x - b.x0, y]),
    })
  }
  const chosen = LINEUP_ORDER.filter((id) => opts.species.includes(id))
  if (opts.banana) add('banana', 'Banana, 19 cm', bananasOnTheGround)
  for (const id of chosen) {
    const sp = SPECIES[id]
    add(id, `${sp.name} — ${sp.lengthM} m long`, () => poseDinosaur(sp))
    if (id === 'velociraptor' && opts.human) add('human', `Human, ${HUMAN_HEIGHT_M} m`, () => human())
  }
  if (opts.human && !chosen.includes('velociraptor')) {
    // No raptor to stand next to: stand at the front of the queue instead.
    const raw = () => human()
    const b = shapesBounds(raw())
    items.splice(opts.banana ? 1 : 0, 0, {
      kind: 'human',
      label: `Human, ${HUMAN_HEIGHT_M} m`,
      widthM: b.x1 - b.x0,
      heightM: b.y1,
      shapes: () => mapShapes(raw(), ([x, y]) => [x - b.x0, y]),
    })
  }
  const gap = Math.max(0, opts.gapM)
  let x = gap
  return items.map((it) => {
    const placed = { ...it, xM: x }
    x += it.widthM + gap
    return placed
  })
}

/** The pan that centres one item on a surface `widthM` wide. */
export function panToCentre(items: LineupItem[], kind: LineupItem['kind'], widthM: number): number {
  const it = items.find((i) => i.kind === kind)
  if (!it) return 0
  return it.xM + it.widthM / 2 - widthM / 2
}

export function drawDinosaurs(ctx: Ctx, w: number, h: number, opts: DinosaurOptions, scale: ScaleOptions, env: PaintEnv) {
  const mm = env.mmPerPx
  const pxPerM = 1000 / mm
  // The floor, in painter pixels: the surface's bottom edge is floorMm above it.
  const floorY = env.world.heightPx - env.view.y + scale.floorMm / mm
  const leftM = env.view.x * mm / 1000 + opts.panM

  if (opts.scenery) {
    const g = ctx.createLinearGradient(0, floorY - 25 * pxPerM, 0, floorY)
    g.addColorStop(0, '#3d7fc4')
    g.addColorStop(0.75, '#9fd0ea')
    g.addColorStop(1, '#f0e2b8')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    if (floorY < h) {
      ctx.fillStyle = '#7a8a4a'
      ctx.fillRect(0, floorY, w, h - floorY)
      ctx.fillStyle = '#5f6e38'
      ctx.fillRect(0, floorY, w, Math.max(1, Math.round(0.03 * pxPerM)))
    }
  } else {
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, w, h)
  }

  const items = lineup(opts)
  const W = env.world.widthPx
  const H = env.world.heightPx
  const labelSize = Math.max(12, Math.min(W, H) / 32)
  const labels: { text: string; x: number; y: number }[] = []
  for (const it of items) {
    const x0 = (it.xM - leftM) * pxPerM
    const x1 = x0 + it.widthM * pxPerM
    if (x1 < -env.view.x || x0 > W - env.view.x) continue
    ctx.save()
    ctx.translate(x0, floorY)
    ctx.scale(pxPerM, -pxPerM)
    fillShapes(ctx, it.shapes())
    ctx.restore()
    if (opts.labels) {
      // Placed on the SURFACE: over the visible part of the animal, kept
      // inside the surface's edges, so every output of a span agrees.
      const top = floorY - it.heightM * pxPerM
      const left = -env.view.x
      const right = W - env.view.x
      const cx = Math.min(right - labelSize * 6, Math.max(left + labelSize * 6, (Math.max(left, x0) + Math.min(right, x1)) / 2))
      labels.push({ text: it.label, x: cx, y: Math.max(labelSize * 1.5 - env.view.y, top - labelSize * 1.2) })
    }
  }
  for (const l of labels) plate(ctx, l.text, l.x, l.y, labelSize)

  if (opts.labels) {
    const visible = `${formatLength(W * mm, scale.units)} wide · bottom edge ${formatLength(scale.floorMm, scale.units)} off the floor`
    const size = labelSize * 0.7
    ctx.save()
    ctx.font = `${Math.round(size)}px ${SANS}`
    const tw = ctx.measureText(visible).width
    ctx.restore()
    plate(ctx, visible, W - env.view.x - tw / 2 - size, size * 1.4 - env.view.y, size)
  }
  drawPitchWarning(ctx, w, h, env)
}

// ---------------------------------------------------------------------------
// Hamsters
// ---------------------------------------------------------------------------

/** Dance cycles per loop: whole cycles, so the loop has no seam; endless, exactly the BPM's. */
export function hamsterCycles(bpm: number, loopSeconds: number, endless = false): number {
  // One pose per half beat, FRAMES poses per cycle -> a cycle is FRAMES/2 beats.
  const beats = (Math.max(20, Math.min(300, bpm)) * loopSeconds) / 60
  return cyclesPerLoop(beats / (FRAMES / 2), endless)
}

/**
 * The dance a tile does. Looping, each tile has one, by where it is in the grid.
 * Endless, a tile picks a new one every time round the dance (`round`), keyed on
 * where the tile sits on the surface as the pumpkins are, so a span's outputs
 * don't all switch to the same dance.
 */
export function hamsterDance(tile: Pick<EnvTile, 'x' | 'y' | 'col' | 'row'>, env: Pick<PaintEnv, 'view' | 'localKey' | 'endless'>, round: number) {
  if (!env.endless) return DANCES[mod(tile.col + tile.row, DANCES.length)]!
  const key = hash(Math.round(tile.x + env.view.x), Math.round(tile.y + env.view.y), env.localKey, round)
  return pick(rng(hash(key, 431)), DANCES)
}

const TILE_HUES = ['#fde2f0', '#e2f0fd', '#e7fde2', '#fdf6e2', '#efe2fd', '#e2fdf8']

/** A modulo that stays positive: tiles left of a spanned wall's origin have negative columns. */
function mod(n: number, m: number): number {
  return ((n % m) + m) % m
}

export function drawHamsters(ctx: Ctx, w: number, h: number, opts: HamsterOptions, env: PaintEnv) {
  if (drawTooManyTiles(ctx, w, h, env)) return
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  const cycles = hamsterCycles(opts.bpm, env.loopSeconds, env.endless)
  const beat = Math.floor(phase(env.t, env.loopSeconds, cycles) * FRAMES)
  const round = lapNumber(env.t, env.loopSeconds, cycles)
  const tiles = env.tiles.length ? env.tiles : [{ x: 0, y: 0, width: w, height: h, col: 0, row: 0, ref: 'A1' }]

  for (const t of tiles) {
    ctx.fillStyle = TILE_HUES[mod(t.col + t.row * 2, TILE_HUES.length)]!
    ctx.fillRect(t.x, t.y, t.width, t.height)
    const dance = hamsterDance(t, env, round)
    // Every other tile is a beat behind, which is most of the charm.
    const frame = (beat + mod(t.col + t.row, 2) * 2) % FRAMES
    const rows = hamsterFrame(dance, frame)
    const px = Math.max(1, Math.floor((Math.min(t.width, t.height) * 0.86) / SPRITE_SIZE))
    const ox = Math.round(t.x + (t.width - px * SPRITE_SIZE) / 2)
    const oy = Math.round(t.y + (t.height - px * SPRITE_SIZE) / 2)
    ctx.save()
    ctx.beginPath()
    ctx.rect(t.x, t.y, t.width, t.height)
    ctx.clip()
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y]!
      for (let x = 0; x < row.length; x++) {
        const ch = row[x]!
        if (ch === '.') continue
        ctx.fillStyle = PALETTE[ch]!
        ctx.fillRect(ox + x * px, oy + y * px, px, px)
      }
    }
    ctx.restore()
  }
}
