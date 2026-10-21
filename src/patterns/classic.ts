/**
 * The classic test card: a grey grid with castellated edges and a big circle in
 * the middle, the way test cards looked when a test card was something the
 * whole country saw at breakfast.
 *
 * It borrows the furniture of that tradition, not anyone's card. Inside the
 * circle, top to bottom: colour bars, gratings of 8 down to 1 pixel lines, a
 * panel with the Stoatworks logo (or your picture, or your words) where the
 * famous ones had a photograph, six greyscale steps, and a box naming the
 * output. Outside it: the grid, castellations along every edge, a circle in
 * each corner and pixel checkers either side.
 *
 * What each part is for, briefly: the circle and corner circles show a wrong
 * aspect ratio at a glance; the castellations show how much of the edge is
 * lost to overscan or a mask; the gratings show where resolution runs out
 * (the 1 px one goes grey through anything that scales); the steps show crushed
 * blacks or clipped whites.
 *
 * Geometry is pure (`classicLayout`) and tested; the painter only fills it in.
 * Always drawn in full range: it is a card, not a level reference.
 */

import type { CentreOptions, ClassicCardOptions, Output, Rect } from '../types'
import { greyCss } from '../lib/colour'
import { drawChecker, paintBands, type Ctx } from './draw'
import type { PaintEnv } from './env'
import { ebuBarsLayout, layOut } from './rp219'
import { drawCentrepiece, fitTextSize } from './centre'

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const GREY = '#808080'

/** Grating line widths, in pixels, left to right. */
export const GRATING_LINES = [8, 6, 4, 3, 2, 1]
/** Greyscale steps, percent, left to right. */
export const STEP_PCT = [0, 20, 40, 60, 80, 100]

export type Circle = { cx: number; cy: number; r: number }

export type ClassicLayout = {
  /** One grid square, in pixels: a twelfth of the height. */
  cell: number
  /** Grid line width. */
  line: number
  /** Left edge of each vertical grid line, and top edge of each horizontal one. */
  columns: number[]
  rows: number[]
  castellations: (Rect & { black: boolean })[]
  circle: Circle
  bars: Rect
  gratingLabels: Rect
  gratings: (Rect & { linePx: number })[]
  panel: Rect
  steps: (Rect & { pct: number })[]
  ident: Rect
  corners: Circle[]
  checkers: (Rect & { cellPx: number })[]
}

const positive = (n: number, m: number) => ((n % m) + m) % m

/**
 * Where everything goes on a `w` x `h` raster. The grid is centred, so a line
 * runs through the middle both ways whatever the aspect; everything else is
 * placed from the circle, whose radius follows the height unless the picture
 * is too narrow for it.
 */
export function classicLayout(w: number, h: number): ClassicLayout {
  const cell = h / 12
  const line = Math.max(1, Math.round(cell / 32))
  const cx = w / 2
  const cy = h / 2

  const lines = (extent: number, centre: number) => {
    const out: number[] = []
    for (let k = Math.ceil(-centre / cell); centre + k * cell <= extent; k++) {
      const at = Math.round(centre + k * cell - line / 2)
      if (at > -line && at < extent) out.push(at)
    }
    return out
  }

  // Castellations: half-cell blocks along every edge, alternating, lined up on the grid.
  const t = Math.max(2, Math.round(cell * 0.3))
  const half = cell / 2
  const blocks = (extent: number, centre: number): { start: number; size: number; black: boolean }[] => {
    const out: { start: number; size: number; black: boolean }[] = []
    for (let k = Math.floor(-centre / half); centre + k * half < extent; k++) {
      const start = Math.max(0, Math.round(centre + k * half))
      const end = Math.min(extent, Math.round(centre + (k + 1) * half))
      if (end > start) out.push({ start, size: end - start, black: positive(k, 2) === 0 })
    }
    return out
  }
  const castellations: ClassicLayout['castellations'] = []
  for (const b of blocks(w, cx)) {
    castellations.push({ x: b.start, y: 0, width: b.size, height: t, black: b.black })
    castellations.push({ x: b.start, y: h - t, width: b.size, height: t, black: !b.black })
  }
  for (const b of blocks(h, cy)) {
    // Between the top and bottom bands, which already own the corners.
    const y0 = Math.max(b.start, t)
    const y1 = Math.min(b.start + b.size, h - t)
    if (y1 <= y0) continue
    castellations.push({ x: 0, y: y0, width: t, height: y1 - y0, black: !b.black })
    castellations.push({ x: w - t, y: y0, width: t, height: y1 - y0, black: b.black })
  }

  // From the height, unless the picture is too narrow: then clear of the side castellations and their stroke.
  const r = Math.max(1, Math.round(Math.min(h * 0.42, w * 0.46, w / 2 - t - line * 4)))
  const X = (f: number) => Math.round(cx + f * r)
  const Y = (f: number) => Math.round(cy + f * r)
  const span = (x0: number, x1: number, y0: number, y1: number): Rect => ({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })

  const gx0 = X(-0.78)
  const gx1 = X(0.78)
  const gratings = layOut(GRATING_LINES.map(() => 1), gx1 - gx0).map((s, i) => ({
    ...span(gx0 + s.start, gx0 + s.start + s.size, Y(-0.53), Y(-0.4)),
    linePx: GRATING_LINES[i]!,
  }))
  const steps = layOut(STEP_PCT.map(() => 1), gx1 - gx0).map((s, i) => ({
    ...span(gx0 + s.start, gx0 + s.start + s.size, Y(0.4), Y(0.6)),
    pct: STEP_PCT[i]!,
  }))

  // A circle in each corner, if there's room for one clear of the big circle.
  const rc = Math.round(cell * 0.7)
  const inset = Math.round(cell * 1.5)
  const corners = [
    { cx: inset, cy: inset, r: rc },
    { cx: w - inset, cy: inset, r: rc },
    { cx: inset, cy: h - inset, r: rc },
    { cx: w - inset, cy: h - inset, r: rc },
  ].filter((c) => w >= cell * 5 && Math.hypot(c.cx - cx, c.cy - cy) > r + rc + cell * 0.25)

  // Pixel checkers in the middle of the space between the castellations and the circle, if a
  // checker, its white border and a margin fit there.
  const side = cx - r - t
  const size = Math.round(cell)
  const checkers =
    side >= size + line * 4 + cell * 0.3
      ? [
          { x: Math.round(t + (side - size) / 2), y: Math.round(cy - size / 2), width: size, height: size, cellPx: 1 },
          { x: w - Math.round(t + (side + size) / 2), y: Math.round(cy - size / 2), width: size, height: size, cellPx: 2 },
        ]
      : []

  return {
    cell,
    line,
    columns: lines(w, cx),
    rows: lines(h, cy),
    castellations,
    circle: { cx, cy, r },
    // In line with the gratings and steps; the circle takes the top corners off the outer two.
    bars: span(gx0, gx1, Y(-0.78), Y(-0.6)),
    gratingLabels: span(gx0, gx1, Y(-0.6), Y(-0.53)),
    gratings,
    panel: span(X(-0.82), X(0.82), Y(-0.37), Y(0.37)),
    steps,
    ident: span(X(-1), X(1), Y(0.62), Y(0.86)),
    corners,
    checkers,
  }
}

function centredText(ctx: Ctx, text: string, box: Rect, colour: string, weight = 600) {
  const size = fitTextSize([text], box.width * 0.9, box.height * 0.8, (line, s) => {
    ctx.font = `${weight} ${s}px ${SANS}`
    return ctx.measureText(line).width
  })
  if (size <= 0) return
  ctx.font = `${weight} ${size}px ${SANS}`
  ctx.fillStyle = colour
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, box.x + box.width / 2, box.y + box.height / 2)
}

export function drawClassicCard(
  ctx: Ctx,
  w: number,
  h: number,
  opts: ClassicCardOptions,
  centre: CentreOptions,
  env: PaintEnv,
  output?: Output,
) {
  const L = classicLayout(w, h)
  const white = '#ffffff'
  const black = '#000000'

  ctx.fillStyle = GREY
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = white
  for (const x of L.columns) ctx.fillRect(x, 0, L.line, h)
  for (const y of L.rows) ctx.fillRect(0, y, w, L.line)

  for (const c of L.castellations) {
    ctx.fillStyle = c.black ? black : white
    ctx.fillRect(c.x, c.y, c.width, c.height)
  }

  ctx.lineWidth = L.line * 2
  for (const c of L.corners) {
    ctx.fillStyle = black
    ctx.beginPath()
    ctx.arc(c.cx, c.cy, c.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = white
    ctx.stroke()
    ctx.fillStyle = white
    // On whole pixels: an odd line width centred on a whole pixel would straddle two rows.
    ctx.fillRect(Math.round(c.cx - c.r), Math.round(c.cy - L.line / 2), c.r * 2, L.line)
    ctx.fillRect(Math.round(c.cx - L.line / 2), Math.round(c.cy - c.r), L.line, c.r * 2)
  }
  for (const c of L.checkers) {
    ctx.fillStyle = white
    ctx.fillRect(c.x - L.line * 2, c.y - L.line * 2, c.width + L.line * 4, c.height + L.line * 4)
    drawChecker(ctx, c.x, c.y, c.width, c.height, c.cellPx, white, black)
  }

  // The circle and everything in it.
  const { cx, cy, r } = L.circle
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.clip()
  ctx.fillStyle = GREY
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)

  const bars = ebuBarsLayout(L.bars.width, L.bars.height, opts.barsPct)
  paintBands(ctx, bars.map((b) => ({ ...b, x: b.x + L.bars.x, y: b.y + L.bars.y })), 'full')

  ctx.fillStyle = black
  ctx.fillRect(L.gratingLabels.x, L.gratingLabels.y, L.gratingLabels.width, L.gratingLabels.height)
  for (const g of L.gratings) {
    centredText(ctx, `${g.linePx} px`, { x: g.x, y: L.gratingLabels.y, width: g.width, height: L.gratingLabels.height }, white)
    ctx.fillStyle = black
    ctx.fillRect(g.x, g.y, g.width, g.height)
    ctx.fillStyle = white
    // Black first and whole white lines only, so each band is edged in black and never runs into the next.
    for (let x = g.x + g.linePx; x + g.linePx <= g.x + g.width; x += g.linePx * 2) ctx.fillRect(x, g.y, g.linePx, g.height)
  }

  drawCentrepiece(ctx, L.panel, centre, env)

  for (const s of L.steps) {
    ctx.fillStyle = greyCss(s.pct, 'full')
    ctx.fillRect(s.x, s.y, s.width, s.height)
  }

  if (opts.ident) {
    ctx.fillStyle = black
    ctx.fillRect(L.ident.x, L.ident.y, L.ident.width, L.ident.height)
    const name = output?.name?.trim()
    const box = { x: L.ident.x + r * 0.35, y: L.ident.y, width: L.ident.width - r * 0.7, height: L.ident.height }
    // The output's own raster: in composition mode the card is drawn at the size of its region.
    const raster = `${output?.widthPx ?? w} × ${output?.heightPx ?? h}`
    centredText(ctx, name ? `${name}  ·  ${raster}` : raster, box, white)
  }
  ctx.restore()

  ctx.strokeStyle = white
  ctx.lineWidth = Math.max(2, L.line * 2)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
}
