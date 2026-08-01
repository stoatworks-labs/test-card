/**
 * The pattern painters.
 *
 * Every function here draws into a 2D context whose coordinate space is the
 * output's real raster in pixels — 1 unit = 1 pixel, always. The preview scales
 * by transforming the context before calling in, so nothing here needs to know
 * whether it is drawing a preview or the real export. The one consequence to
 * remember is that a "1px" line really is one pixel on the export and will be
 * sub-pixel (and therefore blurred) in a scaled-down preview; that is a
 * property of the preview, not of the file, and the UI says so.
 *
 * Canvas strokes straddle the path, so a 1px line on an integer coordinate lands
 * half in each neighbouring pixel and renders as two grey rows instead of one
 * black one. `crispLine` offsets by half a pixel for odd line widths, which is
 * the standard fix and matters here more than in most drawing code — the whole
 * point of an alignment pattern is that a 1px line is exactly 1px.
 */

import type {
  AlignmentOptions,
  GreyscaleOptions,
  GridOptions,
  LedTileOptions,
  LevelRange,
  PixelCheckOptions,
  Region,
  SolidOptions,
} from '../types'
import { greyCss, rgbToCss, unitToCode } from '../lib/colour'
import { ebuBarsLayout, rp219Layout, type Band } from './rp219'

export type Ctx = CanvasRenderingContext2D

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

/** Snap a stroke coordinate so an odd-width line covers whole pixels. */
function crispLine(v: number, lineWidth: number): number {
  return lineWidth % 2 === 1 ? Math.round(v) + 0.5 : Math.round(v)
}

function strokeRect(ctx: Ctx, x: number, y: number, w: number, h: number, lw: number) {
  ctx.lineWidth = lw
  ctx.strokeRect(crispLine(x, lw), crispLine(y, lw), Math.round(w), Math.round(h))
}

function line(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, lw: number) {
  ctx.lineWidth = lw
  ctx.beginPath()
  // Only snap the axis the line is constant along, so diagonals stay smooth.
  const vertical = Math.abs(x2 - x1) < 0.5
  const horizontal = Math.abs(y2 - y1) < 0.5
  ctx.moveTo(vertical ? crispLine(x1, lw) : x1, horizontal ? crispLine(y1, lw) : y1)
  ctx.lineTo(vertical ? crispLine(x2, lw) : x2, horizontal ? crispLine(y2, lw) : y2)
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// Colour bars
// ---------------------------------------------------------------------------

function paintBands(ctx: Ctx, bands: Band[], range: LevelRange) {
  for (const band of bands) {
    if (band.fill.kind === 'flat') {
      const { y, cb, cr } = band.fill.colour
      ctx.fillStyle = ycbcrCss({ y, cb, cr }, range)
      ctx.fillRect(band.x, band.y, band.width, band.height)
    } else {
      paintRamp(ctx, band, range)
    }
  }
}

function ycbcrCss(c: { y: number; cb: number; cr: number }, range: LevelRange): string {
  // Local import-free version of ycbcrToCss to keep this module's imports lean.
  const yy = (c.y - 16) / 219
  const pb = (c.cb - 128) / 224
  const pr = (c.cr - 128) / 224
  return rgbToCss({
    r: unitToCode(yy + 1.5748 * pr, range),
    g: unitToCode(yy - 0.1873 * pb - 0.4681 * pr, range),
    b: unitToCode(yy + 1.8556 * pb, range),
  })
}

/**
 * The luma ramp, drawn a column at a time rather than as a canvas gradient.
 *
 * A `createLinearGradient` would be interpolated by the canvas implementation in
 * whatever precision and colour space it likes, and dithered on some backends —
 * which is exactly what you do not want in a measurement pattern. Explicit
 * columns give an exact, reproducible code value at every x.
 */
function paintRamp(ctx: Ctx, band: Band, range: LevelRange) {
  for (let i = 0; i < band.width; i++) {
    const t = band.width <= 1 ? 0 : i / (band.width - 1)
    const code = unitToCode(t, range)
    ctx.fillStyle = `rgb(${code}, ${code}, ${code})`
    ctx.fillRect(band.x + i, band.y, 1, band.height)
  }
}

export function drawSmpteBars(ctx: Ctx, w: number, h: number, range: LevelRange) {
  paintBands(ctx, rp219Layout(w, h), range)
}

export function drawEbuBars(ctx: Ctx, w: number, h: number, range: LevelRange) {
  paintBands(ctx, ebuBarsLayout(w, h), range)
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/**
 * Grid line positions along one axis.
 *
 * In `divisions` mode the lines are spread across the full extent so the last
 * one lands exactly on the far edge — a grid whose right-hand column is a few
 * pixels narrower than the rest is the classic sign of accumulated rounding, and
 * it makes people distrust an otherwise correct alignment.
 */
export function gridLines(extent: number, opts: GridOptions, axis: 'x' | 'y'): number[] {
  const out: number[] = []
  if (opts.mode === 'divisions') {
    const n = Math.max(1, Math.round(axis === 'x' ? opts.divisionsX : opts.divisionsY))
    for (let i = 0; i <= n; i++) out.push(Math.round((extent * i) / n))
    return out
  }

  const step = Math.max(1, Math.round(opts.spacingPx))
  if (opts.originCentre) {
    const centre = extent / 2
    for (let v = centre; v <= extent; v += step) out.push(Math.round(v))
    for (let v = centre - step; v >= 0; v -= step) out.unshift(Math.round(v))
    // The raster edge is always worth a line even when the pitch misses it.
    if (out[0] !== 0) out.unshift(0)
    if (out[out.length - 1] !== extent) out.push(extent)
    return out
  }

  for (let v = 0; v <= extent; v += step) out.push(Math.round(v))
  if (out[out.length - 1] !== extent) out.push(extent)
  return out
}

export function drawGrid(ctx: Ctx, w: number, h: number, opts: GridOptions) {
  ctx.fillStyle = opts.background
  ctx.fillRect(0, 0, w, h)

  const xs = gridLines(w, opts, 'x')
  const ys = gridLines(h, opts, 'y')

  if (opts.diagonals) {
    ctx.strokeStyle = opts.colour
    line(ctx, 0, 0, w, h, opts.lineWidthPx)
    line(ctx, w, 0, 0, h, opts.lineWidthPx)
  }

  const major = Math.max(0, Math.round(opts.majorEvery))
  for (let i = 0; i < xs.length; i++) {
    const isMajor = major > 0 && i % major === 0
    ctx.strokeStyle = isMajor ? opts.majorColour : opts.colour
    line(ctx, xs[i]!, 0, xs[i]!, h, isMajor ? opts.majorLineWidthPx : opts.lineWidthPx)
  }
  for (let i = 0; i < ys.length; i++) {
    const isMajor = major > 0 && i % major === 0
    ctx.strokeStyle = isMajor ? opts.majorColour : opts.colour
    line(ctx, 0, ys[i]!, w, ys[i]!, isMajor ? opts.majorLineWidthPx : opts.lineWidthPx)
  }

  if (opts.labelCells && xs.length > 1 && ys.length > 1) {
    const cellW = (xs[1] ?? w) - (xs[0] ?? 0)
    const cellH = (ys[1] ?? h) - (ys[0] ?? 0)
    const size = Math.max(8, Math.min(cellW, cellH) / 5)
    // Below about 5px of cap height the labels are an unreadable smear that
    // just dirties the pattern, so skip them rather than draw noise.
    if (size >= 8) {
      ctx.fillStyle = opts.majorColour
      ctx.font = `${size}px ${MONO}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let cy = 0; cy < ys.length - 1; cy++) {
        for (let cx = 0; cx < xs.length - 1; cx++) {
          ctx.fillText(
            `${cx + 1},${cy + 1}`,
            (xs[cx]! + xs[cx + 1]!) / 2,
            (ys[cy]! + ys[cy + 1]!) / 2,
          )
        }
      }
    }
  }

  if (opts.centreMarks) drawCentreTarget(ctx, w, h, opts.majorColour, opts.majorLineWidthPx)
}

function drawCentreTarget(ctx: Ctx, w: number, h: number, colour: string, lw: number) {
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) / 2
  ctx.strokeStyle = colour
  line(ctx, cx, 0, cx, h, lw)
  line(ctx, 0, cy, w, cy, lw)
  ctx.lineWidth = lw
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath()
    ctx.arc(cx, cy, r * frac, 0, Math.PI * 2)
    ctx.stroke()
  }
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export function drawAlignment(ctx: Ctx, w: number, h: number, opts: AlignmentOptions) {
  ctx.fillStyle = opts.background
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = opts.colour
  ctx.fillStyle = opts.colour

  if (opts.diagonals) {
    line(ctx, 0, 0, w, h, 1)
    line(ctx, w, 0, 0, h, 1)
  }

  if (opts.centreTarget) drawCentreTarget(ctx, w, h, opts.colour, 1)

  for (const pct of opts.safeAreas) {
    const ix = Math.round((w * pct) / 200)
    const iy = Math.round((h * pct) / 200)
    strokeRect(ctx, ix, iy, w - ix * 2, h - iy * 2, 1)
    const size = Math.max(10, Math.min(w, h) / 60)
    ctx.font = `${size}px ${MONO}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`${100 - pct}%`, ix + 4, iy + 4)
  }

  if (opts.cornerMarkers) {
    const s = Math.max(8, Math.round(opts.cornerSizePx))
    const arms: [number, number, number, number][] = [
      [0, 0, 1, 1],
      [w, 0, -1, 1],
      [0, h, 1, -1],
      [w, h, -1, -1],
    ]
    for (const [x, y, dx, dy] of arms) {
      line(ctx, x, y + dy * 0.5, x + dx * s, y + dy * 0.5, 3)
      line(ctx, x + dx * 0.5, y, x + dx * 0.5, y + dy * s, 3)
    }
    const size = Math.max(10, Math.min(w, h) / 50)
    ctx.font = `${size}px ${MONO}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`${s}px`, s + 6, 6)
  }

  if (opts.pixelPatches) {
    // Single-pixel checkerboards in the four corners and the centre. If any
    // scaling is happening anywhere in the chain these turn into flat grey.
    const patch = Math.max(16, Math.round(Math.min(w, h) / 20))
    const spots: [number, number][] = [
      [Math.round(w * 0.25), Math.round(h * 0.25)],
      [Math.round(w * 0.75) - patch, Math.round(h * 0.25)],
      [Math.round(w * 0.25), Math.round(h * 0.75) - patch],
      [Math.round(w * 0.75) - patch, Math.round(h * 0.75) - patch],
    ]
    for (const [px, py] of spots) drawChecker(ctx, px, py, patch, patch, 1, opts.colour, opts.background)
  }

  if (opts.edgeBorder) {
    // Drawn last so nothing overlaps it: this is the line that proves the raster
    // is not being cropped or overscanned, and it must be exactly on the edge.
    strokeRect(ctx, 0, 0, w - 1, h - 1, 1)
  }
}

function drawChecker(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  cell: number,
  a: string,
  b: string,
) {
  const c = Math.max(1, Math.round(cell))
  for (let yy = 0; yy < h; yy += c) {
    for (let xx = 0; xx < w; xx += c) {
      ctx.fillStyle = ((xx / c + yy / c) | 0) % 2 === 0 ? a : b
      ctx.fillRect(x + xx, y + yy, Math.min(c, w - xx), Math.min(c, h - yy))
    }
  }
}

// ---------------------------------------------------------------------------
// LED tiles
// ---------------------------------------------------------------------------

/** Column letters: A..Z, then AA, AB … so a 30-wide wall still reads cleanly. */
export function columnRef(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** Distinct, evenly spaced hues for per-port colouring. */
export function groupColour(index: number, total: number): string {
  const hue = total <= 1 ? 200 : Math.round((360 * index) / Math.max(1, total))
  return `hsl(${hue}, 70%, 45%)`
}

export function drawLedTiles(
  ctx: Ctx,
  w: number,
  h: number,
  opts: LedTileOptions,
  regions: Region[],
) {
  ctx.fillStyle = opts.checkerColourA
  ctx.fillRect(0, 0, w, h)

  const tiles =
    opts.source === 'cabinets' && regions.length
      ? cabinetTiles(regions)
      : uniformTiles(w, h, opts)

  const groups = Array.from(new Set(tiles.map((t) => t.group ?? ''))).sort()

  for (const tile of tiles) {
    const parity = (tile.col + tile.row) % 2 === 0
    if (opts.colourByGroup && tile.group) {
      ctx.fillStyle = groupColour(groups.indexOf(tile.group), groups.length)
      ctx.globalAlpha = parity ? 0.85 : 0.55
      ctx.fillRect(tile.x, tile.y, tile.width, tile.height)
      ctx.globalAlpha = 1
    } else if (opts.checker) {
      ctx.fillStyle = parity ? opts.checkerColourA : opts.checkerColourB
      ctx.fillRect(tile.x, tile.y, tile.width, tile.height)
    }

    ctx.strokeStyle = opts.borderColour
    strokeRect(ctx, tile.x, tile.y, tile.width, tile.height, Math.max(1, opts.borderWidthPx))

    const labels: string[] = []
    if (opts.labelTiles) labels.push(tile.ref)
    if (opts.labelOrder && tile.order) labels.push(`#${tile.order}`)
    if (!labels.length) continue

    // Fit the longest label to ~70% of the tile width, capped by its height.
    const longest = Math.max(...labels.map((l) => l.length))
    const size = Math.min(tile.height / (labels.length + 1), (tile.width * 0.7) / (longest * 0.6))
    if (size < 7) continue

    ctx.fillStyle = opts.borderColour
    ctx.font = `${Math.round(size)}px ${MONO}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const cx = tile.x + tile.width / 2
    const cy = tile.y + tile.height / 2
    labels.forEach((label, i) => {
      const offset = (i - (labels.length - 1) / 2) * size * 1.2
      ctx.fillText(label, cx, cy + offset)
    })
  }
}

type Tile = {
  x: number
  y: number
  width: number
  height: number
  col: number
  row: number
  ref: string
  order?: number
  group?: string
}

function uniformTiles(w: number, h: number, opts: LedTileOptions): Tile[] {
  const tw = Math.max(1, Math.round(opts.tileWidthPx))
  const th = Math.max(1, Math.round(opts.tileHeightPx))
  const ox = Math.round(opts.originXPx)
  const oy = Math.round(opts.originYPx)
  const tiles: Tile[] = []

  // Start at or before the origin so a wall with a negative offset still gets
  // its partial first row and column drawn rather than silently skipped.
  const startX = ox - Math.ceil(Math.max(0, ox) / tw) * tw
  const startY = oy - Math.ceil(Math.max(0, oy) / th) * th

  let row = 0
  for (let y = startY; y < h; y += th, row++) {
    let col = 0
    for (let x = startX; x < w; x += tw, col++) {
      if (x + tw <= 0 || y + th <= 0) continue
      tiles.push({
        x,
        y,
        width: tw,
        height: th,
        col,
        row,
        ref: `${columnRef(col)}${row + 1}`,
      })
    }
  }
  return tiles
}

function cabinetTiles(regions: Region[]): Tile[] {
  // Only the cabinets, not the port bounding boxes that sit alongside them.
  const cabinets = regions.filter((r) => r.order !== undefined)
  const source = cabinets.length ? cabinets : regions

  // Recover a row/column index from position so the checker and the references
  // are stable even when cabinets are irregular or the wall has gaps.
  const xs = Array.from(new Set(source.map((r) => r.rect.x))).sort((a, b) => a - b)
  const ys = Array.from(new Set(source.map((r) => r.rect.y))).sort((a, b) => a - b)

  return source.map((r) => {
    const col = xs.indexOf(r.rect.x)
    const row = ys.indexOf(r.rect.y)
    return {
      x: r.rect.x,
      y: r.rect.y,
      width: r.rect.width,
      height: r.rect.height,
      col,
      row,
      ref: `${columnRef(col)}${row + 1}`,
      order: r.order,
      group: r.group,
    }
  })
}

// ---------------------------------------------------------------------------
// Solid, greyscale, pixel check
// ---------------------------------------------------------------------------

const FIELDS: Record<string, [number, number, number]> = {
  white: [1, 1, 1],
  black: [0, 0, 0],
  red: [1, 0, 0],
  green: [0, 1, 0],
  blue: [0, 0, 1],
  cyan: [0, 1, 1],
  magenta: [1, 0, 1],
  yellow: [1, 1, 0],
  grey50: [0.5, 0.5, 0.5],
  grey18: [0.18, 0.18, 0.18],
}

export function solidColour(opts: SolidOptions, range: LevelRange): string {
  if (opts.field === 'custom') return opts.custom
  const base = FIELDS[opts.field] ?? [1, 1, 1]
  const a = Math.max(0, Math.min(100, opts.levelPct)) / 100
  return rgbToCss({
    r: unitToCode(base[0] * a, range),
    g: unitToCode(base[1] * a, range),
    b: unitToCode(base[2] * a, range),
  })
}

export function drawSolid(ctx: Ctx, w: number, h: number, opts: SolidOptions, range: LevelRange) {
  ctx.fillStyle = solidColour(opts, range)
  ctx.fillRect(0, 0, w, h)
}

export function drawGreyscale(
  ctx: Ctx,
  w: number,
  h: number,
  opts: GreyscaleOptions,
  range: LevelRange,
) {
  const strips: [number, number, number][] = opts.perChannel
    ? [
        [1, 1, 1],
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]
    : [[1, 1, 1]]

  const along = opts.vertical ? h : w
  const across = opts.vertical ? w : h
  const stripSize = across / strips.length

  strips.forEach((mult, si) => {
    for (let i = 0; i < along; i++) {
      const raw = along <= 1 ? 0 : i / (along - 1)
      // A stepped wedge quantises the position, not the colour, so each step is
      // a flat patch of one exact code value.
      const t =
        opts.steps > 0
          ? Math.min(1, Math.floor(raw * opts.steps) / Math.max(1, opts.steps - 1))
          : raw
      ctx.fillStyle = rgbToCss({
        r: unitToCode(t * mult[0], range),
        g: unitToCode(t * mult[1], range),
        b: unitToCode(t * mult[2], range),
      })
      const s0 = Math.round(si * stripSize)
      const s1 = Math.round((si + 1) * stripSize)
      if (opts.vertical) ctx.fillRect(s0, i, s1 - s0, 1)
      else ctx.fillRect(i, s0, 1, s1 - s0)
    }
  })
}

export function drawPixelCheck(
  ctx: Ctx,
  w: number,
  h: number,
  opts: PixelCheckOptions,
  range: LevelRange,
) {
  const black = greyCss(0, range)
  const white = greyCss(100, range)
  const cell = Math.max(1, Math.round(opts.cellPx))

  if (!opts.lineBursts) {
    drawChecker(ctx, 0, 0, w, h, cell, white, black)
    return
  }

  // Left half checkerboard, right half split into horizontal and vertical 1px
  // bursts. On LED these three behave differently under a scan-rate problem.
  const half = Math.round(w / 2)
  drawChecker(ctx, 0, 0, half, h, cell, white, black)

  ctx.fillStyle = black
  ctx.fillRect(half, 0, w - half, h)
  ctx.fillStyle = white
  const mid = Math.round(h / 2)
  for (let y = 0; y < mid; y += cell * 2) ctx.fillRect(half, y, w - half, cell)
  for (let x = half; x < w; x += cell * 2) ctx.fillRect(x, mid, cell, h - mid)
}
