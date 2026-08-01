/**
 * Blend Calc importer — the `.blendcalc.json` design file.
 *
 * THE XML EXPORT IS THE BETTER PATH, AND THE UI SAYS SO
 * ====================================================
 * Blend Calc also exports a Resolume advanced output, and that file is fully
 * resolved: every projector's slice geometry is already computed and it is read
 * by `import/resolume.ts` with no extra input from the user. If you have the
 * choice, use it.
 *
 * This importer exists because the design JSON is the file people actually keep
 * — it is the one Blend Calc calls "the whole design, so it can be reopened or
 * handed over". It needs two things the file does not contain.
 *
 * MISSING PIECE 1: THE PROJECTOR RASTER
 * ------------------------------------
 * The design JSON stores `projectorId`, a reference into Blend Calc's own
 * projector library — which lives in that app's localStorage and is not part of
 * the file. So the native resolution is genuinely absent and the user has to
 * supply it. There is no way to infer it; a 1920x1200 and a 3840x2400 array
 * with the same overlap produce identical JSON.
 *
 * MISSING PIECE 2: THE SOLVED OVERLAP
 * -----------------------------------
 * `array.hOverlap` and `array.vOverlap` are the operator's INPUTS, not the
 * result. In `fit-width` mode Blend Calc solves the vertical overlap so the
 * array covers the screen height exactly, displays it as "Vertical blend
 * (solved)", and never writes it back to the project — so the `vOverlap` in the
 * file is whatever was last typed on a different fit mode. Reading it blindly
 * gives a plausible, wrong canvas. `fit-height` has the mirror problem.
 *
 * So: for a `manual` project both stored overlaps are trustworthy and are used
 * as-is. For a fit mode, the solved axis is flagged and the user confirms it
 * against the figure on Blend Calc's own screen. `staleAxis` below is what the
 * UI keys off to do that.
 *
 * THE LAYOUT MATHS
 * ================
 * Tiles sit on an integer pixel pitch of `native * (1 - overlap)`, and the
 * canvas is sized from the last tile's right/bottom edge rather than from a
 * separate rounding of the total — so tiles and canvas can never disagree by a
 * pixel. That is the same rule Blend Calc's own exporter uses, and it is the
 * whole of the geometry needed here: no part of the optical solver (throw,
 * lenses, curvature, luminance) affects the pixel layout.
 */

import type { ImportResult, Output, Region } from '../types'

type BlendCalcProject = {
  name?: string
  client?: string
  notes?: string
  units?: string
  screen?: {
    geometry?: { kind?: string; width?: number; height?: number; radius?: number }
    gain?: number
  }
  array?: {
    columns?: number
    rows?: number
    fitMode?: 'fit-width' | 'fit-height' | 'manual'
    hOverlap?: number
    vOverlap?: number
    placement?: string
    throwDistance?: number
  }
  projectorId?: string | null
  lensId?: string | null
}

export type BlendCalcOptions = {
  /** The projector's native raster — not in the file, so it must be supplied. */
  nativeWidth: number
  nativeHeight: number
  /** Overlap fractions, 0..0.5, of one projector image. */
  hOverlap: number
  vOverlap: number
}

/**
 * Which overlap axis, if any, the file cannot be trusted about.
 * `null` for a manual project, where both were typed by the operator.
 */
export type StaleAxis = 'h' | 'v' | null

export function isBlendCalcProject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as BlendCalcProject
  // No schema/version field, so identify it structurally: a screen geometry and
  // an array block with a fit mode is the shape nothing else here produces.
  return (
    typeof v.screen === 'object' &&
    v.screen !== null &&
    typeof v.array === 'object' &&
    v.array !== null &&
    typeof v.array.fitMode === 'string'
  )
}

/** Which axis Blend Calc solved rather than stored, given the project's fit mode. */
export function staleAxisFor(fitMode: string | undefined): StaleAxis {
  if (fitMode === 'fit-width') return 'v'
  if (fitMode === 'fit-height') return 'h'
  return null
}

/** Defaults for the import dialog, read straight off the file. */
export function blendCalcDefaults(doc: unknown): {
  hOverlap: number
  vOverlap: number
  columns: number
  rows: number
  staleAxis: StaleAxis
  name: string
} {
  const d = (doc ?? {}) as BlendCalcProject
  return {
    hOverlap: d.array?.hOverlap ?? 0.2,
    vOverlap: d.array?.vOverlap ?? 0.2,
    columns: Math.max(1, Math.round(d.array?.columns ?? 1)),
    rows: Math.max(1, Math.round(d.array?.rows ?? 1)),
    staleAxis: staleAxisFor(d.array?.fitMode),
    name: d.name?.trim() || 'Blend Calc',
  }
}

export function parseBlendCalcProject(doc: unknown, opts: BlendCalcOptions): ImportResult {
  if (!isBlendCalcProject(doc)) {
    throw new Error('Not a Blend Calc design file.')
  }
  const d = doc as BlendCalcProject

  const { nativeWidth, nativeHeight } = opts
  if (!(nativeWidth > 0) || !(nativeHeight > 0)) {
    throw new Error('A projector native resolution is required to lay out a Blend Calc design.')
  }

  const columns = Math.max(1, Math.round(d.array?.columns ?? 1))
  const rows = Math.max(1, Math.round(d.array?.rows ?? 1))
  const hOverlap = Math.min(0.9, Math.max(0, opts.hOverlap))
  const vOverlap = Math.min(0.9, Math.max(0, opts.vOverlap))

  const pitchX = nativeWidth * (1 - (columns > 1 ? hOverlap : 0))
  const pitchY = nativeHeight * (1 - (rows > 1 ? vOverlap : 0))

  const projectName = d.name?.trim() || 'Blend Calc'
  const outputs: Output[] = []
  let canvasWidth = 0
  let canvasHeight = 0

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const x0 = Math.round(c * pitchX)
      const y0 = Math.round(r * pitchY)
      const x1 = x0 + nativeWidth
      const y1 = y0 + nativeHeight
      canvasWidth = Math.max(canvasWidth, x1)
      canvasHeight = Math.max(canvasHeight, y1)

      const position = rows > 1 ? `R${r + 1}C${c + 1}` : `${c + 1}`

      // The overlap bands, as regions — on a blend rig these are the single most
      // useful thing to see on the pattern, because they are where the geometry
      // has to agree between adjacent projectors.
      const regions: Region[] = []
      const hBand = Math.round(nativeWidth * hOverlap)
      const vBand = Math.round(nativeHeight * vOverlap)
      if (columns > 1 && hBand > 0) {
        if (c > 0) {
          regions.push({
            id: `${position}-blend-l`,
            label: 'blend',
            detail: `${hBand}px overlap with column ${c}`,
            rect: { x: 0, y: 0, width: hBand, height: nativeHeight },
            group: 'blend',
          })
        }
        if (c < columns - 1) {
          regions.push({
            id: `${position}-blend-r`,
            label: 'blend',
            detail: `${hBand}px overlap with column ${c + 2}`,
            rect: { x: nativeWidth - hBand, y: 0, width: hBand, height: nativeHeight },
            group: 'blend',
          })
        }
      }
      if (rows > 1 && vBand > 0) {
        if (r > 0) {
          regions.push({
            id: `${position}-blend-t`,
            label: 'blend',
            detail: `${vBand}px overlap with row ${r}`,
            rect: { x: 0, y: 0, width: nativeWidth, height: vBand },
            group: 'blend',
          })
        }
        if (r < rows - 1) {
          regions.push({
            id: `${position}-blend-b`,
            label: 'blend',
            detail: `${vBand}px overlap with row ${r + 2}`,
            rect: { x: 0, y: nativeHeight - vBand, width: nativeWidth, height: vBand },
            group: 'blend',
          })
        }
      }

      outputs.push({
        id: `bc-${r}-${c}`,
        name: `${projectName} ${position}`,
        widthPx: nativeWidth,
        heightPx: nativeHeight,
        rasterSource: 'computed',
        source: 'blend-calc',
        compositionRect: { x: x0, y: y0, width: nativeWidth, height: nativeHeight },
        regions,
        notes: [],
        enabled: true,
      })
    }
  }

  const warnings: string[] = []
  const stale = staleAxisFor(d.array?.fitMode)
  if (stale) {
    const axis = stale === 'v' ? 'Vertical' : 'Horizontal'
    warnings.push(
      `This design uses ${d.array?.fitMode}, so Blend Calc SOLVES the ${axis.toLowerCase()} ` +
        `overlap and does not store it — the value in the file is a stale input. ` +
        `${axis} overlap was taken as ${((stale === 'v' ? vOverlap : hOverlap) * 100).toFixed(1)}%; ` +
        `check that against "${axis} blend (solved)" on Blend Calc's own screen, or import ` +
        'its Resolume XML export instead, which needs none of this.',
    )
  }
  warnings.push(
    `Projector raster ${nativeWidth}x${nativeHeight} was supplied by you — the design ` +
      'file stores only a library reference, not the resolution.',
  )
  const geom = d.screen?.geometry
  if (geom?.kind === 'cylindrical') {
    warnings.push(
      'This is a cylindrical screen. The pixel layout is unaffected by the curve, but the ' +
        'patterns are flat images — a grid will look correct on the raster and curved on the screen.',
    )
  }

  return {
    source: 'blend-calc',
    projectName,
    outputs,
    composition: { widthPx: canvasWidth, heightPx: canvasHeight },
    warnings,
  }
}
