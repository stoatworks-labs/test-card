/**
 * Turning an Output plus a PatternSettings into pixels, and then into a PNG.
 *
 * CANVAS LIMITS
 * =============
 * Browsers cap canvas size, and they do it by SILENTLY producing a blank or
 * transparent canvas rather than throwing — so an 8K-wide LED wall can export a
 * folder of empty PNGs that look fine in a file listing and are discovered to be
 * blank on site. `canvasLimitProblem` checks the raster before anything is drawn
 * and the UI refuses the export with an explanation. The area limit bites long
 * before the per-side one on wide walls: 16384 x 16384 is the widely supported
 * ceiling, and total area is capped around 268 megapixels on Chrome.
 */

import type { Output, PatternSettings, RenderMode, Rect } from '../types'
import { greyCss } from '../lib/colour'
import {
  drawAlignment,
  drawEbuBars,
  drawGreyscale,
  drawGrid,
  drawLedTiles,
  drawPixelCheck,
  drawSmpteBars,
  drawSolid,
  groupColour,
  type Ctx,
} from './draw'

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

/** Conservative ceilings that hold across current Chrome, Safari and Firefox. */
export const MAX_SIDE_PX = 16384
export const MAX_AREA_PX = 268_435_456 // 16384^2

export function canvasLimitProblem(width: number, height: number): string | null {
  if (!(width > 0) || !(height > 0)) {
    return 'Raster must be at least 1x1.'
  }
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return 'Raster is not a number.'
  }
  if (width > MAX_SIDE_PX || height > MAX_SIDE_PX) {
    return `${width}x${height} exceeds the ${MAX_SIDE_PX}px per-side canvas limit; browsers return a blank image rather than an error.`
  }
  if (width * height > MAX_AREA_PX) {
    return `${width}x${height} is ${(
      (width * height) /
      1_000_000
    ).toFixed(0)} megapixels, over the ~${(MAX_AREA_PX / 1_000_000).toFixed(
      0,
    )} megapixel canvas area limit; browsers return a blank image rather than an error.`
  }
  return null
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** Paint the chosen pattern across the whole of `w` x `h`. */
export function paintPattern(
  ctx: Ctx,
  w: number,
  h: number,
  settings: PatternSettings,
  output?: Output,
) {
  const range = settings.levels
  switch (settings.kind) {
    case 'smpte-rp219':
      drawSmpteBars(ctx, w, h, range)
      break
    case 'ebu-bars':
      drawEbuBars(ctx, w, h, range)
      break
    case 'grid':
      drawGrid(ctx, w, h, settings.grid)
      break
    case 'alignment':
      drawAlignment(ctx, w, h, settings.alignment)
      break
    case 'led-tiles':
      drawLedTiles(ctx, w, h, settings.led, output?.regions ?? [])
      break
    case 'solid':
      drawSolid(ctx, w, h, settings.solid, range)
      break
    case 'greyscale':
      drawGreyscale(ctx, w, h, settings.greyscale, range)
      break
    case 'pixel-check':
      drawPixelCheck(ctx, w, h, settings.pixelCheck, range)
      break
  }
}

/** Slice/cabinet outlines drawn over the pattern. */
export function paintRegionOverlay(ctx: Ctx, output: Output, settings: PatternSettings) {
  const opts = settings.regionOverlay
  if (!opts.enabled || !output.regions.length) return

  // On an LED tile pattern the cabinets ARE the pattern, so outlining every one
  // again just thickens the borders. Show only the port groups there.
  const regions =
    settings.kind === 'led-tiles'
      ? output.regions.filter((r) => r.order === undefined)
      : output.regions

  const groups = Array.from(new Set(regions.map((r) => r.group ?? ''))).sort()

  ctx.save()
  ctx.setLineDash([12, 8])
  for (const region of regions) {
    ctx.strokeStyle = groups.length > 1 ? groupColour(groups.indexOf(region.group ?? ''), groups.length) : opts.colour
    ctx.lineWidth = Math.max(1, opts.lineWidthPx)
    ctx.strokeRect(region.rect.x, region.rect.y, region.rect.width, region.rect.height)

    if (!opts.labels) continue
    const size = Math.max(12, Math.min(region.rect.width, region.rect.height) / 12)
    ctx.setLineDash([])
    ctx.font = `${Math.round(size)}px ${MONO}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    const label = region.detail ?? region.label
    const pad = Math.round(size * 0.3)
    const metrics = ctx.measureText(label)
    ctx.fillStyle = 'rgba(0,0,0,0.6)'
    ctx.fillRect(region.rect.x + pad, region.rect.y + pad, metrics.width + pad * 2, size + pad * 2)
    ctx.fillStyle = opts.colour
    ctx.fillText(label, region.rect.x + pad * 2, region.rect.y + pad * 2)
    ctx.setLineDash([12, 8])
  }
  ctx.restore()
}

/** The burn-in text block. */
export function paintOverlayText(
  ctx: Ctx,
  w: number,
  h: number,
  settings: PatternSettings,
  lines: string[],
) {
  const opts = settings.overlay
  if (!opts.enabled || !lines.length) return

  const size = opts.fontSizePx > 0 ? opts.fontSizePx : Math.max(14, Math.round(Math.min(w, h) / 24))
  const pad = Math.round(size * 0.5)
  ctx.save()
  ctx.font = `${size}px ${MONO}`
  ctx.textBaseline = 'top'

  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width))
  const blockW = widest + pad * 2
  const blockH = lines.length * size * 1.3 + pad * 2

  let x: number
  let y: number
  switch (opts.position) {
    case 'top-centre':
      x = (w - blockW) / 2
      y = pad
      break
    case 'centre':
      x = (w - blockW) / 2
      y = (h - blockH) / 2
      break
    case 'bottom-centre':
      x = (w - blockW) / 2
      y = h - blockH - pad
      break
    case 'bottom-left':
      x = pad
      y = h - blockH - pad
      break
    default:
      x = pad
      y = pad
  }

  if (opts.plate) {
    // Nearly opaque on purpose. At 0.65 the vivid per-port cabinet colours
    // underneath showed straight through and the output name became unreadable
    // over a saturated tile — which defeats the only reason the burn-in exists.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.88)'
    ctx.fillRect(x, y, blockW, blockH)
    ctx.strokeStyle = opts.colour
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, blockW - 1, blockH - 1)
  }

  ctx.fillStyle = opts.colour
  ctx.textAlign = 'left'
  lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * size * 1.3))
  ctx.restore()
}

export function overlayLines(output: Output, settings: PatternSettings): string[] {
  const opts = settings.overlay
  const lines: string[] = []
  if (opts.showName) lines.push(output.name)
  if (opts.showResolution) lines.push(`${output.widthPx} x ${output.heightPx}`)
  if (opts.showPattern) lines.push(`${PATTERN_LABELS[settings.kind]} · ${settings.levels} range`)
  if (opts.customText.trim()) lines.push(...opts.customText.split('\n').filter(Boolean))
  return lines
}

export const PATTERN_LABELS: Record<PatternSettings['kind'], string> = {
  'smpte-rp219': 'SMPTE RP 219',
  'ebu-bars': '75% bars',
  grid: 'Grid',
  alignment: 'Alignment',
  'led-tiles': 'LED tiles',
  solid: 'Solid field',
  greyscale: 'Greyscale',
  'pixel-check': 'Pixel check',
}

/** Draw one output's pattern into an existing context, at raster scale. */
export function renderOutputTo(ctx: Ctx, output: Output, settings: PatternSettings) {
  const { widthPx: w, heightPx: h } = output
  paintPattern(ctx, w, h, settings, output)
  paintRegionOverlay(ctx, output, settings)
  paintOverlayText(ctx, w, h, settings, overlayLines(output, settings))
}

export function renderOutput(output: Output, settings: PatternSettings): HTMLCanvasElement {
  const canvas = makeCanvas(output.widthPx, output.heightPx)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D canvas context.')
  renderOutputTo(ctx, output, settings)
  return canvas
}

/**
 * The composition canvas: one image at composition size with each output's
 * INPUT region filled with its own pattern and labelled.
 *
 * Play this through Resolume and every physical output should light up showing
 * its own name. That is the fastest possible check that the advanced output map
 * matches what you think it does — and unlike the per-output files, it needs no
 * way of getting a PNG to each output individually.
 */
export function renderComposition(
  outputs: Output[],
  composition: { widthPx: number; heightPx: number },
  settings: PatternSettings,
): HTMLCanvasElement {
  const canvas = makeCanvas(composition.widthPx, composition.heightPx)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D canvas context.')

  // Anything not covered by an output stays visibly dead, so gaps in the map
  // read as gaps rather than as black picture content.
  ctx.fillStyle = greyCss(0, settings.levels)
  ctx.fillRect(0, 0, composition.widthPx, composition.heightPx)
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'
  for (let x = 0; x < composition.widthPx; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, composition.heightPx)
    ctx.stroke()
  }

  const placed = outputs.filter((o) => o.enabled && o.compositionRect)
  placed.forEach((output, i) => {
    const r = output.compositionRect as Rect
    ctx.save()
    // Clip so a pattern can never bleed outside its own output's region, which
    // would make an overlap look like coverage it does not have.
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.width, r.height)
    ctx.clip()
    ctx.translate(r.x, r.y)

    paintPattern(ctx, r.width, r.height, settings, output)

    ctx.strokeStyle = groupColour(i, placed.length)
    ctx.lineWidth = 4
    ctx.strokeRect(2, 2, r.width - 4, r.height - 4)

    paintOverlayText(ctx, r.width, r.height, settings, [
      output.name,
      `${output.widthPx} x ${output.heightPx}`,
      `comp ${r.x},${r.y}`,
    ])
    ctx.restore()
  })

  return canvas
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas produced no image — the raster is probably over a browser limit.'))
        return
      }
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject)
    }, 'image/png')
  })
}

/** Outputs that cannot be rendered, with the reason. */
export function renderBlockers(
  outputs: Output[],
  mode: RenderMode,
  composition?: { widthPx: number; heightPx: number },
): { output: string; reason: string }[] {
  if (mode === 'composition') {
    if (!composition) {
      return [{ output: 'composition', reason: 'No composition size is known for this import.' }]
    }
    const problem = canvasLimitProblem(composition.widthPx, composition.heightPx)
    return problem ? [{ output: 'composition', reason: problem }] : []
  }
  return outputs
    .filter((o) => o.enabled)
    .map((o) => ({ output: o.name, reason: canvasLimitProblem(o.widthPx, o.heightPx) }))
    .filter((x): x is { output: string; reason: string } => x.reason !== null)
}
