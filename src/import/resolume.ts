/**
 * Resolume Arena "Advanced Output" importer.
 *
 * SCHEMA PROVENANCE
 * =================
 * The element and attribute names handled here were read off REAL files written
 * by Resolume Arena 7.27.0 (rev 14395):
 *
 *   ~/Documents/Resolume Arena/Preferences/AdvancedOutput.xml   root <ScreenSetup>
 *   ~/Documents/Resolume Arena/Presets/Advanced Output/*.xml    root <XmlState>
 *
 * They are not guessed from documentation — the same reverse-engineering that
 * backs the exporters in the sibling projects `blend-calc` and `pixel-peeker`.
 * Because both of those write this format, this one importer covers all three
 * of the file types the app accepts from the Resolume side of the fleet.
 *
 * READING, NOT WRITING
 * ====================
 * This module only reads, which makes it far more forgiving than those
 * exporters need to be: unknown elements are ignored rather than rejected, so a
 * file from a newer Arena, or one carrying warps and soft-edge settings this
 * app knows nothing about, still yields the output list. The parse is driven
 * off the handful of elements that carry geometry.
 *
 * WHAT DETERMINES AN OUTPUT'S RASTER
 * ==================================
 * In order of trust:
 *   1. An <OutputDeviceVirtual> carries explicit width/height attributes.
 *   2. Otherwise, the bounding box of the screen's slice <OutputRect>s.
 *
 * Case 2 is a guess and is labelled as such throughout the UI. It is right
 * whenever the slices actually reach the edges of the raster, and wrong (too
 * small) when they do not — a 1920x1080 output showing a single 1280x720 slice
 * in the middle looks, from the file alone, exactly like a 1280x720 output.
 * A real display's device entry carries an `idHash` tied to the machine
 * Resolume was running on and no dimensions at all, so there is nothing better
 * to go on. The user can correct the raster by hand.
 */

import type { ImportResult, Output, Rect, Region } from '../types'

/** Read the 4 <v x= y=> children of a rect element and return the bounding box. */
function rectFrom(el: Element | null): { rect: Rect; axisAligned: boolean } | null {
  if (!el) return null
  const vs = Array.from(el.children).filter((c) => c.tagName === 'v')
  if (vs.length < 3) return null
  const xs: number[] = []
  const ys: number[] = []
  for (const v of vs) {
    const x = Number(v.getAttribute('x'))
    const y = Number(v.getAttribute('y'))
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    xs.push(x)
    ys.push(y)
  }
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)

  // A plain unrotated rect has exactly two distinct x values and two distinct y
  // values. Anything else has been rotated or corner-pinned, and the bounding
  // box is then an approximation worth mentioning.
  const axisAligned = new Set(xs).size <= 2 && new Set(ys).size <= 2

  return {
    rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    axisAligned,
  }
}

/** Resolume stores the display name both as an attribute and as a <Param>. */
function screenName(screen: Element, index: number): string {
  const param = Array.from(screen.querySelectorAll('Param')).find(
    (p) => p.getAttribute('name') === 'Name',
  )
  const fromParam = param?.getAttribute('value')?.trim()
  if (fromParam) return fromParam
  const attr = screen.getAttribute('name')?.trim()
  if (attr) return attr
  return `Screen ${index + 1}`
}

function sliceName(slice: Element, index: number): string {
  const param = Array.from(slice.querySelectorAll('Param')).find(
    (p) => p.getAttribute('name') === 'Name',
  )
  const v = param?.getAttribute('value')?.trim()
  return v && v !== 'Layer' ? v : `Slice ${index + 1}`
}

/**
 * Pull the output device out of a screen.
 *
 * Arena writes one of several element types depending on where the screen goes:
 *   OutputDeviceVirtual   a virtual screen — carries width/height
 *   OutputDeviceCapture   a capture card (DeckLink etc.) — carries a deviceId
 *                         and an idHash, no dimensions
 *   OutputDeviceDisplay   a physical display — likewise machine-specific
 * Anything unrecognised is still reported by tag name, since knowing the device
 * exists is useful even when its size is not readable.
 */
function outputDevice(screen: Element): {
  label?: string
  width?: number
  height?: number
} {
  const container = screen.querySelector('OutputDevice')
  if (!container) return {}
  const el = Array.from(container.children).find((c) => c.tagName.startsWith('OutputDevice'))
  if (!el) return {}

  const label =
    el.getAttribute('name')?.trim() ||
    el.getAttribute('deviceId')?.trim() ||
    el.tagName.replace(/^OutputDevice/, '')

  const w = Number(el.getAttribute('width'))
  const h = Number(el.getAttribute('height'))
  const hasSize = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0

  return hasSize ? { label, width: w, height: h } : { label }
}

function boundingBox(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined
  const x0 = Math.min(...rects.map((r) => r.x))
  const y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.width))
  const y1 = Math.max(...rects.map((r) => r.y + r.height))
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function isResolumeXml(text: string): boolean {
  return /<\s*(ScreenSetup|XmlState)\b/.test(text)
}

export function parseResolumeXml(text: string, fileName = 'advanced output'): ImportResult {
  const doc = new DOMParser().parseFromString(text, 'application/xml')

  const parseError = doc.querySelector('parsererror')
  if (parseError) {
    throw new Error(`That file is not valid XML: ${parseError.textContent?.trim() ?? ''}`)
  }

  const setup = doc.documentElement.tagName === 'ScreenSetup'
    ? doc.documentElement
    : doc.querySelector('ScreenSetup')

  if (!setup) {
    throw new Error(
      'No <ScreenSetup> in that file. A Resolume advanced output is either an ' +
        'AdvancedOutput.xml (root <ScreenSetup>) or a preset (root <XmlState>).',
    )
  }

  const warnings: string[] = []

  const version = doc.querySelector('versionInfo')
  const versionLabel = version
    ? `${version.getAttribute('name') ?? 'Resolume'} ` +
      `${version.getAttribute('majorVersion') ?? '?'}.${version.getAttribute('minorVersion') ?? '?'}`
    : null

  const compEl = setup.querySelector('CurrentCompositionTextureSize')
  const compW = Number(compEl?.getAttribute('width'))
  const compH = Number(compEl?.getAttribute('height'))
  const composition =
    Number.isFinite(compW) && Number.isFinite(compH) && compW > 0 && compH > 0
      ? { widthPx: compW, heightPx: compH }
      : undefined

  const screens = Array.from(setup.querySelectorAll('screens > Screen'))
  if (!screens.length) {
    throw new Error('That advanced output has no screens in it.')
  }

  const outputs: Output[] = []
  let rotatedSlices = 0

  screens.forEach((screen, si) => {
    const notes: string[] = []
    const name = screenName(screen, si)

    // Any layer carrying an OutputRect counts, so PolySlices and whatever Arena
    // adds later are picked up without this needing to know their tag names.
    const layers = Array.from(screen.querySelectorAll('layers > *')).filter((el) =>
      el.querySelector('OutputRect'),
    )

    const regions: Region[] = []
    const outRects: Rect[] = []
    const inRects: Rect[] = []

    layers.forEach((layer, li) => {
      const out = rectFrom(layer.querySelector('OutputRect'))
      const inp = rectFrom(layer.querySelector('InputRect'))
      if (!out) return
      if (!out.axisAligned || (inp && !inp.axisAligned)) rotatedSlices++

      outRects.push(out.rect)
      if (inp) inRects.push(inp.rect)

      regions.push({
        id: layer.getAttribute('uniqueId') ?? `${si}-${li}`,
        label: sliceName(layer, li),
        rect: out.rect,
        input: inp?.rect,
        group: name,
      })
    })

    const device = outputDevice(screen)
    const bounds = boundingBox(outRects)

    let widthPx: number
    let heightPx: number
    let rasterSource: Output['rasterSource']

    if (device.width && device.height) {
      widthPx = device.width
      heightPx = device.height
      rasterSource = 'declared'
    } else if (bounds) {
      // Slices are positioned in raster coordinates, so the raster must extend
      // to the far edge of the furthest slice — but its origin is 0,0 even if
      // no slice starts there. Use the extent, not the box's own size.
      widthPx = Math.round(bounds.x + bounds.width)
      heightPx = Math.round(bounds.y + bounds.height)
      rasterSource = 'slice-bounds'
      notes.push(
        `Raster inferred from slice positions — this screen's output device ` +
          `(${device.label ?? 'unknown'}) does not record its size. Check it against the real output.`,
      )
    } else {
      widthPx = composition?.widthPx ?? 1920
      heightPx = composition?.heightPx ?? 1080
      rasterSource = 'manual'
      notes.push('No slices and no device size — fell back to the composition size. Set this by hand.')
    }

    outputs.push({
      id: screen.getAttribute('uniqueId') ?? `screen-${si}`,
      name,
      widthPx,
      heightPx,
      rasterSource,
      source: 'resolume',
      device: device.label,
      compositionRect: boundingBox(inRects),
      regions,
      notes,
      enabled: true,
    })
  })

  if (versionLabel) warnings.push(`Read as ${versionLabel}.`)
  if (rotatedSlices) {
    warnings.push(
      `${rotatedSlices} slice${rotatedSlices === 1 ? ' is' : 's are'} rotated or corner-pinned. ` +
        'Their regions are drawn as bounding boxes, so the outlines will not follow the warp.',
    )
  }
  const inferred = outputs.filter((o) => o.rasterSource === 'slice-bounds').length
  if (inferred) {
    warnings.push(
      `${inferred} of ${outputs.length} output rasters were inferred from slice bounds ` +
        'rather than read from the file. Confirm each one before you trust the patterns.',
    )
  }

  return {
    source: 'resolume',
    projectName: fileName.replace(/\.[^.]+$/, '') || 'advanced-output',
    outputs,
    composition,
    warnings,
  }
}
