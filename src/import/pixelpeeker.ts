/**
 * Pixel Peeker importer — the `pixel-peeker.interchange/1` document.
 *
 * WHY THE INTERCHANGE AND NOT THE PROJECT FILE
 * ============================================
 * Pixel Peeker can save two JSON files, and only one of them is usable here:
 *
 *   *.pixelpeeker.json          the project — `schema: "pixel-peeker/1"`
 *   *-interchange.json          the computed result — `format: "pixel-peeker.interchange/1"`
 *
 * The project file stores cabinets as a `specId` plus a millimetre position. To
 * turn that into pixels you need the cabinet SPEC — pixel pitch and pixel
 * count — and those live in Pixel Peeker's own library, which the project file
 * does not carry unless the panel was authored as a custom one. Importing it
 * would mean vendoring a copy of that library here, which would then drift out
 * of step with the real one and quietly produce wrong tile sizes. A
 * near-correct LED map is worse on site than no map.
 *
 * The interchange document is the pixel map after Pixel Peeker has resolved all
 * of that: every cabinet as a pixel rect, grouped by processor and port, with
 * chain order. It is exactly what this app needs and it needs no library at all.
 * So: `Export -> JSON` in Pixel Peeker, not `Save project`. The UI says so when
 * someone drops the wrong one in.
 *
 * WHAT AN OUTPUT IS HERE
 * ======================
 * One Output per PROCESSOR, matching Pixel Peeker's own Resolume export: a
 * processor is fed by one physical video output, so it is the natural unit. The
 * raster is the bounding box of everything that processor drives, and each port
 * becomes a Region — as does each individual cabinet, which is what makes the
 * LED tile pattern able to draw the real irregular cabinet map rather than an
 * assumed uniform grid.
 */

import type { ImportResult, Output, Rect, Region } from '../types'

type IcCabinet = {
  order?: number
  id?: string
  model?: string
  xPx: number
  yPx: number
  widthPx: number
  heightPx: number
}

type IcPort = {
  label?: string
  linkSpeedGbps?: number
  capacityPx?: number
  usedPx?: number
  utilisationPct?: number
  cabinets?: IcCabinet[]
}

type IcProcessor = {
  name?: string
  model?: string
  manufacturer?: string
  ports?: IcPort[]
}

type InterchangeDoc = {
  format?: string
  project?: { name?: string; client?: string; venue?: string }
  wall?: { widthPx?: number; heightPx?: number; approximatePixelMap?: boolean }
  signal?: { bitDepth?: number; frameRateHz?: number; ledRefreshHz?: number }
  processors?: IcProcessor[]
  unpatchedCabinets?: string[]
}

export const INTERCHANGE_FORMAT = 'pixel-peeker.interchange/1'

export function isPixelPeekerInterchange(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as InterchangeDoc).format === INTERCHANGE_FORMAT
  )
}

/** True for the project file, which is deliberately NOT supported — see the header. */
export function isPixelPeekerProject(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schema?: string }).schema === 'pixel-peeker/1'
  )
}

function bbox(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.width))
  const y1 = Math.max(...rects.map((r) => r.y + r.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function parsePixelPeekerInterchange(doc: unknown): ImportResult {
  if (!isPixelPeekerInterchange(doc)) {
    if (isPixelPeekerProject(doc)) {
      throw new Error(
        'That is a Pixel Peeker PROJECT file, which stores cabinets as library ' +
          'references and millimetre positions — there is no way to resolve it to ' +
          'pixels here without a copy of Pixel Peeker’s panel library. Use ' +
          'Export → JSON in Pixel Peeker instead, which writes the resolved pixel map.',
      )
    }
    throw new Error(`Not a ${INTERCHANGE_FORMAT} document.`)
  }

  const d = doc as InterchangeDoc
  const warnings: string[] = []
  const outputs: Output[] = []
  const processors = d.processors ?? []

  if (!processors.length) {
    throw new Error('That Pixel Peeker export has no processors in it.')
  }

  processors.forEach((proc, pi) => {
    const procName = proc.name ?? `Processor ${pi + 1}`
    const ports = proc.ports ?? []

    // Only ports that actually drive something contribute to the raster; an
    // unpatched port has no pixels and must not drag the bounding box to 0,0.
    const portRects: { port: IcPort; rect: Rect; cabinets: IcCabinet[] }[] = []
    for (const port of ports) {
      const cabs = port.cabinets ?? []
      if (!cabs.length) continue
      const r = bbox(
        cabs.map((c) => ({ x: c.xPx, y: c.yPx, width: c.widthPx, height: c.heightPx })),
      )
      if (r) portRects.push({ port, rect: r, cabinets: cabs })
    }

    if (!portRects.length) {
      warnings.push(`${procName} drives no cabinets, so it was skipped.`)
      return
    }

    const raster = bbox(portRects.map((p) => p.rect))!
    const notes: string[] = []
    const regions: Region[] = []

    for (const { port, rect, cabinets } of portRects) {
      const portLabel = port.label ?? 'port'
      // Every rect is rebased so the processor's own raster starts at 0,0 —
      // matching how Pixel Peeker writes its Resolume slices.
      regions.push({
        id: `${procName}/${portLabel}`,
        label: portLabel,
        detail:
          port.utilisationPct !== undefined
            ? `${portLabel} — ${port.utilisationPct}% of capacity`
            : portLabel,
        rect: {
          x: rect.x - raster.x,
          y: rect.y - raster.y,
          width: rect.width,
          height: rect.height,
        },
        input: rect,
        group: portLabel,
      })

      for (const cab of cabinets) {
        regions.push({
          id: cab.id ?? `${portLabel}-${cab.order ?? regions.length}`,
          label: String(cab.order ?? ''),
          detail: `${portLabel} · ${cab.model ?? 'cabinet'}`,
          rect: {
            x: cab.xPx - raster.x,
            y: cab.yPx - raster.y,
            width: cab.widthPx,
            height: cab.heightPx,
          },
          input: { x: cab.xPx, y: cab.yPx, width: cab.widthPx, height: cab.heightPx },
          order: cab.order,
          group: portLabel,
        })
      }
    }

    const cabinetCount = portRects.reduce((n, p) => n + p.cabinets.length, 0)
    notes.push(
      `${portRects.length} port${portRects.length === 1 ? '' : 's'}, ` +
        `${cabinetCount} cabinet${cabinetCount === 1 ? '' : 's'}.`,
    )

    outputs.push({
      id: `pp-${pi}`,
      name: procName,
      widthPx: raster.width,
      heightPx: raster.height,
      rasterSource: 'computed',
      source: 'pixel-peeker',
      device: proc.model ? `${proc.manufacturer ?? ''} ${proc.model}`.trim() : undefined,
      compositionRect: raster,
      regions,
      notes,
      enabled: true,
    })
  })

  if (d.wall?.approximatePixelMap) {
    warnings.push(
      'Pixel Peeker flagged this wall’s pixel map as approximate — it mixes pixel ' +
        'pitches, so cabinet rectangles are indicative rather than exact.',
    )
  }
  if (d.unpatchedCabinets?.length) {
    warnings.push(
      `${d.unpatchedCabinets.length} cabinet(s) are not patched to any port and are ` +
        'not covered by any pattern.',
    )
  }
  if (d.signal) {
    warnings.push(
      `Wall signal: ${d.signal.bitDepth ?? '?'}-bit, ${d.signal.frameRateHz ?? '?'} Hz ` +
        `(LED refresh ${d.signal.ledRefreshHz ?? '?'} Hz).`,
    )
  }

  return {
    source: 'pixel-peeker',
    projectName: d.project?.name ?? 'pixel-peeker-wall',
    outputs,
    composition:
      d.wall?.widthPx && d.wall?.heightPx
        ? { widthPx: d.wall.widthPx, heightPx: d.wall.heightPx }
        : undefined,
    warnings,
  }
}
