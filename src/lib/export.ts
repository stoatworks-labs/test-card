/**
 * Filenames and downloads.
 *
 * Filenames matter more here than they look. The output of this app is a folder
 * of near-identical images that somebody sorts through on a truck, so the name
 * has to say which output it is, what pattern it is, and at what size — because
 * once the PNG is on a USB stick that is all the information left.
 */

import type { Output, PatternSettings } from '../types'
import { buildZip, uniqueNames, type ZipEntry } from './zip'

/** Filesystem-safe, lower-case, no runs of separators. */
export function slug(text: string): string {
  const s = text
    .normalize('NFD')
    // Strip combining marks so "Bühne" becomes "buhne", not "bhne". Written as
    // escapes on purpose — a literal combining-mark range in the source is
    // invisible and does not survive an editor that normalises the file.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return s || 'output'
}

export const PATTERN_SLUGS: Record<PatternSettings['kind'], string> = {
  'smpte-rp219': 'smpte',
  'ebu-bars': 'bars',
  grid: 'grid',
  alignment: 'align',
  'led-tiles': 'tiles',
  solid: 'solid',
  greyscale: 'grey',
  'pixel-check': 'pixel',
}

export function outputFileName(output: Output, settings: PatternSettings): string {
  return `${slug(output.name)}_${PATTERN_SLUGS[settings.kind]}_${output.widthPx}x${output.heightPx}.png`
}

export function compositionFileName(
  projectName: string,
  settings: PatternSettings,
  width: number,
  height: number,
): string {
  return `${slug(projectName)}_composition_${PATTERN_SLUGS[settings.kind]}_${width}x${height}.png`
}

export function zipFileName(projectName: string, settings: PatternSettings): string {
  return `${slug(projectName)}_${PATTERN_SLUGS[settings.kind]}_patterns.zip`
}

/**
 * A manifest written into the ZIP alongside the images.
 *
 * Worth the few lines: it records which output each file belongs to and what
 * the settings were, so a folder of patterns found six months later can still
 * be traced back to the design it came from.
 */
export function buildManifest(
  projectName: string,
  outputs: Output[],
  fileNames: string[],
  settings: PatternSettings,
): string {
  const lines = [
    `Test Card — generated patterns`,
    `Project:  ${projectName}`,
    `Pattern:  ${settings.kind}`,
    `Levels:   ${settings.levels} range (${settings.levels === 'legal' ? '16-235' : '0-255'})`,
    `Created:  ${new Date().toISOString()}`,
    '',
    'file, output, raster, raster source, regions',
  ]
  outputs.forEach((o, i) => {
    lines.push(
      [
        fileNames[i] ?? '',
        o.name,
        `${o.widthPx}x${o.heightPx}`,
        o.rasterSource,
        String(o.regions.length),
      ]
        .map((f) => (f.includes(',') ? `"${f}"` : f))
        .join(', '),
    )
  })
  const inferred = outputs.filter((o) => o.rasterSource === 'slice-bounds')
  if (inferred.length) {
    lines.push(
      '',
      'NOTE: the raster for these outputs was inferred from slice bounds, not read',
      'from the source file, and may be smaller than the real output:',
      ...inferred.map((o) => `  - ${o.name} (${o.widthPx}x${o.heightPx})`),
    )
  }
  return lines.join('\n') + '\n'
}

export function packageZip(
  images: { name: string; data: Uint8Array }[],
  manifest: string,
): Uint8Array {
  const names = uniqueNames(images.map((i) => i.name))
  const entries: ZipEntry[] = images.map((img, i) => ({ name: names[i]!, data: img.data }))
  entries.push({ name: 'manifest.txt', data: new TextEncoder().encode(manifest) })
  return buildZip(entries)
}

export function downloadBlob(filename: string, data: Uint8Array, mime: string) {
  // Copy into a fresh ArrayBuffer: a Uint8Array view over a larger buffer would
  // otherwise hand the whole buffer to Blob.
  const blob = new Blob([data.slice().buffer as ArrayBuffer], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
