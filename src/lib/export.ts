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
import { loopTiming } from '../patterns/loop'
import { resolvePitch } from '../patterns/scale'
import { isAnimated, isScaleAware } from '../patterns/env'

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
  rulers: 'rulers',
  bananas: 'bananas',
  dinosaurs: 'dinosaurs',
  hamsters: 'hamsters',
  ocean: 'ocean',
  'dino-scroll': 'dinoscroll',
  volcano: 'volcano',
  'broken-wall': 'broken',
  image: 'image',
}

/** PNG for a still, MP4 for a loop. The loop's name says its frame rate and length too. */
export type FileKind = 'png' | 'mp4'

function loopSuffix(settings: PatternSettings, kind: FileKind): string {
  if (kind !== 'mp4') return ''
  // "29.97" -> "29p97", the way frame rates are usually written in filenames.
  const secs = String(Math.round(loopTiming(settings.animation).seconds * 100) / 100)
  return `_${settings.animation.fps.replace('.', 'p')}fps_${secs.replace('.', 'p')}s`
}

export function outputFileName(output: Output, settings: PatternSettings, kind: FileKind = 'png'): string {
  return `${slug(output.name)}_${PATTERN_SLUGS[settings.kind]}_${output.widthPx}x${output.heightPx}${loopSuffix(settings, kind)}.${kind}`
}

export function compositionFileName(
  projectName: string,
  settings: PatternSettings,
  width: number,
  height: number,
  kind: FileKind = 'png',
): string {
  return `${slug(projectName)}_composition_${PATTERN_SLUGS[settings.kind]}_${width}x${height}${loopSuffix(settings, kind)}.${kind}`
}

export function zipFileName(projectName: string, settings: PatternSettings, kind: FileKind = 'png'): string {
  return `${slug(projectName)}_${PATTERN_SLUGS[settings.kind]}_${kind === 'mp4' ? 'loops' : 'patterns'}.zip`
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
  kind: FileKind = 'png',
): string {
  const lines = [
    `Test Card — generated patterns`,
    `Project:  ${projectName}`,
    `Pattern:  ${settings.kind}`,
    `Levels:   ${settings.levels} range (${settings.levels === 'legal' ? '16-235' : '0-255'})`,
    `Created:  ${new Date().toISOString()}`,
  ]
  if (kind === 'mp4') {
    const t = loopTiming(settings.animation)
    lines.push(
      `Loop:     ${t.frames} frames at ${settings.animation.fps} fps = ${t.seconds.toFixed(4)} s, seamless`,
      'Video:    H.264, BT.709 Y′CbCr 4:2:0, limited (video) range, flagged in the file',
    )
  } else if (isAnimated(settings)) {
    lines.push(`Still:    the frame at ${settings.animation.stillAtSeconds} s of a moving pattern`)
  }
  const scaled = isScaleAware(settings)
  lines.push('', `file, output, raster, raster source, regions${scaled ? ', pitch mm, pitch source' : ''}`)
  outputs.forEach((o, i) => {
    const pitch = resolvePitch(o, settings.scale)
    lines.push(
      [
        fileNames[i] ?? '',
        o.name,
        `${o.widthPx}x${o.heightPx}`,
        o.rasterSource,
        String(o.regions.length),
        ...(scaled ? [String(pitch.pitchMm), pitch.assumed ? 'ASSUMED' : (o.pitchSource ?? 'manual')] : []),
      ]
        .map((f) => (f.includes(',') ? `"${f}"` : f))
        .join(', '),
    )
  })
  if (scaled && outputs.some((o) => resolvePitch(o, settings.scale).assumed)) {
    lines.push(
      '',
      'NOTE: outputs marked ASSUMED had no pixel pitch, so this pattern was drawn at',
      `the fallback of ${settings.scale.pitchMm} mm. Anything it calls life-size is only as right as that.`,
    )
  }
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
  // Named images, but MP4s ride along the same way: the writer stores bytes.
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
