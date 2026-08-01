/**
 * Work out what a dropped file is, and say something useful when it is none of
 * the things this app can read.
 *
 * The failure messages matter more than the success path. Every wrong file that
 * lands here is a near miss — a Pixel Peeker project instead of its interchange
 * export, a Resolume composition (.avc) instead of an advanced output — and a
 * bare "unsupported file" sends someone hunting through export menus. Each
 * message names the file they have and the export that produces the right one.
 */

import type { ImportResult } from '../types'
import { blendCalcDefaults, isBlendCalcProject, type StaleAxis } from './blendcalc'
import { isPixelPeekerInterchange, isPixelPeekerProject, parsePixelPeekerInterchange } from './pixelpeeker'
import { isResolumeXml, parseResolumeXml } from './resolume'

export type DetectResult =
  /** Parsed and ready. */
  | { kind: 'ready'; result: ImportResult }
  /**
   * A Blend Calc design, which cannot be laid out until the user supplies the
   * projector raster and confirms the overlaps. The UI collects those and then
   * calls `parseBlendCalcProject`.
   */
  | {
      kind: 'needs-blend-calc-options'
      doc: unknown
      defaults: {
        hOverlap: number
        vOverlap: number
        columns: number
        rows: number
        staleAxis: StaleAxis
        name: string
      }
    }

/** Recognised-but-unsupported files, each with the export that WOULD work. */
function knownWrongFile(text: string, value: unknown): string | null {
  if (isPixelPeekerProject(value)) {
    return (
      'That is a Pixel Peeker project file (.pixelpeeker.json). It stores cabinets as ' +
      'library references in millimetres, so it cannot be resolved to pixels here. ' +
      'In Pixel Peeker use Export → JSON, which writes the resolved pixel map.'
    )
  }
  if (/<\s*XmlState\b/.test(text) && !/<\s*ScreenSetup\b/.test(text)) {
    return (
      'That is a Resolume preset, but not an Advanced Output one — it has no ' +
      '<ScreenSetup>. Export from Output → Advanced, not from a composition preset.'
    )
  }
  if (/^\s*<\?xml/.test(text) && /<\s*(Composition|Deck|Clip)\b/.test(text)) {
    return (
      'That looks like a Resolume composition, not an advanced output. The file you ' +
      'want is AdvancedOutput.xml from Resolume’s Preferences folder, or a preset ' +
      'saved from the Advanced Output window.'
    )
  }
  return null
}

/**
 * Identify and parse. `fileName` is only used to name the export, and to pick
 * between the two JSON shapes when the content is ambiguous.
 */
export function detectAndParse(text: string, fileName: string): DetectResult {
  const trimmed = text.trimStart()

  if (isResolumeXml(trimmed)) {
    return { kind: 'ready', result: parseResolumeXml(text, fileName) }
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (err) {
      throw new Error(`That file is not valid JSON: ${(err as Error).message}`)
    }

    if (isPixelPeekerInterchange(value)) {
      const result = parsePixelPeekerInterchange(value)
      return { kind: 'ready', result }
    }

    if (isBlendCalcProject(value)) {
      return {
        kind: 'needs-blend-calc-options',
        doc: value,
        defaults: blendCalcDefaults(value),
      }
    }

    const known = knownWrongFile(trimmed, value)
    if (known) throw new Error(known)

    throw new Error(
      'That JSON file is not one this app recognises. It reads a Pixel Peeker ' +
        'interchange export (Export → JSON) or a Blend Calc design file (.blendcalc.json).',
    )
  }

  const known = knownWrongFile(trimmed, null)
  if (known) throw new Error(known)

  throw new Error(
    'Unrecognised file. Drop a Resolume advanced output (.xml), a Pixel Peeker ' +
      'interchange export (.json) or a Blend Calc design file (.blendcalc.json).',
  )
}
