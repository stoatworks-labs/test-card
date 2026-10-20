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

import type { Output, PatternKind, PatternSettings, RenderMode, Rect } from '../types'
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
  ledTiles,
  MAX_TILES,
  uniformTileCount,
  type Ctx,
} from './draw'
import { isAnimated, plainEnv, type PaintEnv, type PatternImage } from './env'
import { drawBananas, drawDinosaurs, drawHamsters, drawRulers } from './novelty'
import { drawDinoScroll, drawOcean, drawVolcano } from './scenes'
import { drawBrokenWall } from './broken'
import { drawImagePattern } from './image'
import { loopTiming } from './loop'
import { resolvePitch } from './scale'

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
  env: PaintEnv = plainEnv(w, h),
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
    case 'rulers':
      drawRulers(ctx, w, h, settings.rulers, settings.scale, env)
      break
    case 'bananas':
      drawBananas(ctx, w, h, settings.bananas, settings.scale, env)
      break
    case 'dinosaurs':
      drawDinosaurs(ctx, w, h, settings.dinosaurs, settings.scale, env)
      break
    case 'hamsters':
      drawHamsters(ctx, w, h, settings.hamsters, env)
      break
    case 'ocean':
      drawOcean(ctx, w, h, settings.ocean, env)
      break
    case 'dino-scroll':
      drawDinoScroll(ctx, w, h, settings.scene, env)
      break
    case 'volcano':
      drawVolcano(ctx, w, h, settings.scene, env)
      break
    case 'image':
      drawImagePattern(ctx, w, h, settings.image, env)
      break
    case 'broken-wall': {
      const base: PatternSettings = { ...settings, kind: settings.broken.base }
      drawBrokenWall(
        ctx,
        w,
        h,
        settings.broken,
        env,
        (c, bw, bh, t) => paintPattern(c, bw, bh, base, output, { ...env, t }),
        isAnimated(base),
      )
      break
    }
  }
}

// ---------------------------------------------------------------------------
// The paint environment: time, scale, and where a canvas sits on the surface
// ---------------------------------------------------------------------------

/**
 * The patterns that are drawn on the SURFACE rather than per output, and so
 * carry on across the join between outputs when spanning is on. The measurement
 * patterns are deliberately not among them: bars and grids belong to one
 * output's raster, exactly.
 */
const SURFACE_KINDS: ReadonlySet<PatternKind> = new Set<PatternKind>([
  'rulers',
  'bananas',
  'dinosaurs',
  'hamsters',
  'ocean',
  'dino-scroll',
  'volcano',
  'image',
])

export function spansSurface(settings: PatternSettings): boolean {
  const k = settings.kind === 'broken-wall' ? settings.broken.base : settings.kind
  return settings.scale.span && SURFACE_KINDS.has(k)
}

/**
 * Where an output sits on the spanned surface, or null if it should be drawn
 * as its own world. A region that the output stretches (a different aspect
 * from its raster — Resolume's slice bounding box can be) is not spanned: on a
 * stretched mapping nothing can be life-size in both directions at once, and a
 * scene would arrive squashed. Such an output gets its own pattern instead.
 */
export function spanPlace(
  output: Output | undefined,
  settings: PatternSettings,
  region: Rect | undefined,
  composition: { widthPx: number; heightPx: number } | undefined,
): { rect: Rect; composition: { widthPx: number; heightPx: number } } | null {
  if (!spansSurface(settings) || !composition || !region || !(region.width > 0) || !(region.height > 0)) return null
  if (output) {
    const sx = output.widthPx / region.width
    const sy = output.heightPx / region.height
    if (Math.abs(sx / sy - 1) > 0.005) return null
  }
  return { rect: region, composition }
}

/** A stable number for an output, so outputs that are each their own world do not all break alike. */
function outputKey(output: Output | undefined): number {
  const id = output?.id ?? ''
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0
  return h
}

function needsTiles(settings: PatternSettings): boolean {
  return (
    settings.kind === 'hamsters' ||
    settings.kind === 'broken-wall' ||
    (settings.kind === 'bananas' && settings.bananas.layout === 'per-tile')
  )
}

/** The patterns whose colours follow the level-range setting. The rest are drawn in full range. */
const LEVELLED: ReadonlySet<PatternKind> = new Set<PatternKind>(['smpte-rp219', 'ebu-bars', 'solid', 'greyscale', 'pixel-check'])

/**
 * The range the canvas's RGB codes are in, which is what the MP4 encoder must
 * read them as. Artwork is always drawn 0–255; only the measurement patterns
 * that honour the level setting can be in 16–235.
 */
export function canvasRange(settings: PatternSettings): PatternSettings['levels'] {
  const k = settings.kind === 'broken-wall' ? settings.broken.base : settings.kind
  return LEVELLED.has(k) ? settings.levels : 'full'
}

/** The image the `image` pattern draws. Held outside the store: it is never persisted. */
let patternImage: PatternImage | null = null
export function setPatternImage(img: PatternImage | null) {
  patternImage = img
}
export function getPatternImage(): PatternImage | null {
  return patternImage
}

/** The moment a still of a moving pattern shows, and the loop it belongs to. */
export function stillTime(settings: PatternSettings): { t: number; loopSeconds: number } {
  const timing = loopTiming(settings.animation)
  if (!isAnimated(settings)) return { t: 0, loopSeconds: timing.seconds }
  const t = Math.max(0, settings.animation.stillAtSeconds) % timing.seconds
  return { t, loopSeconds: timing.seconds }
}

/**
 * Work out the paint environment for one output drawn into a `pw` x `ph`
 * painter area. `place` is where that area sits in the composition, when the
 * surface is spanned; null means the output is its own world.
 */
export function makeEnv(
  output: Output | undefined,
  settings: PatternSettings,
  pw: number,
  ph: number,
  place: { rect: Rect; composition: { widthPx: number; heightPx: number } } | null,
  t?: number,
): PaintEnv {
  const still = stillTime(settings)
  const rasterW = output?.widthPx ?? pw
  // Painter units per raster pixel. 1 unless a composition region is scaled.
  const scale = pw / rasterW
  const pitch = resolvePitch(output, settings.scale)
  const view = place ? { x: place.rect.x, y: place.rect.y } : { x: 0, y: 0 }
  const wantTiles = needsTiles(settings)
  const usesUniform = settings.led.source === 'uniform' || !(output?.regions ?? []).some((r) => r.order !== undefined)
  const count = wantTiles && usesUniform ? uniformTileCount(pw, ph, settings.led, scale) : 0
  return {
    t: t ?? still.t,
    loopSeconds: still.loopSeconds,
    world: place ? { ...place.composition } : { widthPx: pw, heightPx: ph },
    view,
    mmPerPx: pitch.pitchMm / scale,
    pitchAssumed: pitch.assumed,
    // Tiles belong to the output, even on a span: a processor's cabinets start
    // at its own raster's origin, wherever the output sits in the composition.
    tiles: wantTiles ? ledTiles(pw, ph, settings.led, output?.regions ?? [], { x: 0, y: 0 }, scale) : [],
    ...(count > MAX_TILES ? { tooManyTiles: count } : {}),
    localKey: place ? 0 : outputKey(output),
    image: patternImage,
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
  rulers: 'Rulers',
  bananas: 'Banana for scale',
  dinosaurs: 'Life-size dinosaurs',
  hamsters: 'Hamster dance',
  ocean: 'Ocean waves',
  'dino-scroll': 'Dinosaur scroll',
  volcano: 'Volcano and comet',
  'broken-wall': 'Broken wall',
  image: 'Your image',
}

/**
 * Draw one output's pattern into an existing context, at raster scale.
 *
 * When the surface is spanned and the output knows where it sits in the
 * composition, the pattern is painted in composition units and scaled onto the
 * raster, so a scene is continuous across outputs. `t` is the moment to draw;
 * left out, a moving pattern shows its still frame.
 */
export function renderOutputTo(
  ctx: Ctx,
  output: Output,
  settings: PatternSettings,
  t?: number,
  composition?: { widthPx: number; heightPx: number },
) {
  const { widthPx: w, heightPx: h } = output
  const cr = output.compositionRect
  const place = spanPlace(output, settings, cr, composition)
  if (place && cr) {
    ctx.save()
    ctx.scale(w / cr.width, h / cr.height)
    const env = makeEnv(output, settings, cr.width, cr.height, place, t)
    paintPattern(ctx, cr.width, cr.height, settings, output, env)
    ctx.restore()
  } else {
    paintPattern(ctx, w, h, settings, output, makeEnv(output, settings, w, h, null, t))
  }
  paintRegionOverlay(ctx, output, settings)
  paintOverlayText(ctx, w, h, settings, overlayLines(output, settings))
}

export function renderOutput(
  output: Output,
  settings: PatternSettings,
  t?: number,
  composition?: { widthPx: number; heightPx: number },
): HTMLCanvasElement {
  const canvas = makeCanvas(output.widthPx, output.heightPx)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D canvas context.')
  renderOutputTo(ctx, output, settings, t, composition)
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
  t?: number,
): HTMLCanvasElement {
  const canvas = makeCanvas(composition.widthPx, composition.heightPx)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get a 2D canvas context.')
  renderCompositionTo(ctx, outputs, composition, settings, t)
  return canvas
}

/**
 * The composition, drawn into any context — at full size for the export, or
 * through a scaled context for the preview, which is what lets a moving
 * pattern animate in composition mode without a full-size canvas per frame.
 */
export function renderCompositionTo(
  ctx: Ctx,
  outputs: Output[],
  composition: { widthPx: number; heightPx: number },
  settings: PatternSettings,
  t?: number,
) {
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

    const place = spanPlace(output, settings, r, composition)
    paintPattern(ctx, r.width, r.height, settings, output, makeEnv(output, settings, r.width, r.height, place, t))

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
