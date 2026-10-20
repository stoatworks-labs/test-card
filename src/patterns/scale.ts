/**
 * Physical scale: turning pixels into millimetres, and back.
 *
 * The scale-aware patterns (rulers, bananas, life-size dinosaurs) are only as
 * good as the pixel pitch they are given. Everything here is pure, so the
 * numbers they are drawn from are tested rather than eyeballed.
 *
 * WHERE A TICK GOES
 * =================
 * A ruler tick for distance d has to land on a whole pixel. Pixel i covers the
 * physical span [i·p, (i+1)·p) from the edge, so the pixel whose CENTRE is
 * nearest to d is floor(d / p), and the tick is then never more than half a
 * pitch from where it should be. That half-pitch is the honest accuracy of an
 * LED ruler — ±1.25 mm on a 2.5 mm wall — and the pattern says so on screen.
 */

import type { Output, ScaleOptions } from '../types'

export const MM_PER_INCH = 25.4

/** Typical LED pitches run 0.6–40 mm; projection can be finer or coarser. */
export const MIN_PITCH_MM = 0.05
export const MAX_PITCH_MM = 500

export type ResolvedPitch = {
  pitchMm: number
  /** True when the output had no pitch and the pattern-wide fallback was used. */
  assumed: boolean
}

export function resolvePitch(output: Output | undefined, scale: ScaleOptions): ResolvedPitch {
  const own = output?.pitchMm
  if (own !== undefined && Number.isFinite(own) && own >= MIN_PITCH_MM && own <= MAX_PITCH_MM) {
    return { pitchMm: own, assumed: false }
  }
  const fallback = Number.isFinite(scale.pitchMm)
    ? Math.min(MAX_PITCH_MM, Math.max(MIN_PITCH_MM, scale.pitchMm))
    : 2.6
  return { pitchMm: fallback, assumed: true }
}

/** Distances that read as round numbers, finest first, in millimetres. */
const METRIC_STEPS = [1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 50000]
const IMPERIAL_STEPS = [
  MM_PER_INCH / 16,
  MM_PER_INCH / 8,
  MM_PER_INCH / 4,
  MM_PER_INCH / 2,
  MM_PER_INCH,
  MM_PER_INCH * 6,
  MM_PER_INCH * 12,
  MM_PER_INCH * 12 * 5,
  MM_PER_INCH * 12 * 10,
  MM_PER_INCH * 12 * 50,
]

/** Steps that make sensible labels. Never label sixteenths or single millimetres. */
const METRIC_LABEL_STEPS = [10, 50, 100, 500, 1000, 5000, 10000, 50000]
const IMPERIAL_LABEL_STEPS = [
  MM_PER_INCH,
  MM_PER_INCH * 6,
  MM_PER_INCH * 12,
  MM_PER_INCH * 12 * 5,
  MM_PER_INCH * 12 * 10,
  MM_PER_INCH * 12 * 50,
]

export type Tick = {
  /** Pixel index along the ruler, 0-based. */
  px: number
  /** The distance it marks, in millimetres from the ruler's origin. */
  mm: number
  /** 0 = the finest tick drawn; higher = longer tick. */
  level: number
  label?: string
}

export type RulerSpec = {
  /** Pixels along the ruler. */
  lengthPx: number
  mmPerPx: number
  /** Distance from the origin at the leading edge of pixel 0. */
  startMm: number
  /** +1 when distance grows with pixel index, -1 when it shrinks (a ruler read upwards). */
  direction: 1 | -1
  units: ScaleOptions['units']
  /** Closest two ticks may sit, in pixels. */
  minTickGapPx?: number
  /** Closest two labels may sit, in pixels. */
  minLabelGapPx?: number
}

/**
 * Every tick on one ruler, with its pixel, its level and, for the labelled
 * ones, its text. At most four tick lengths are drawn; past that a ruler stops
 * reading as a ruler.
 */
export function rulerTicks(spec: RulerSpec): { ticks: Tick[]; stepMm: number; labelStepMm: number } {
  const { lengthPx, mmPerPx, startMm, direction, units } = spec
  const minTick = spec.minTickGapPx ?? 4
  const minLabel = spec.minLabelGapPx ?? 80
  const steps = units === 'imperial' ? IMPERIAL_STEPS : METRIC_STEPS
  const labelSteps = units === 'imperial' ? IMPERIAL_LABEL_STEPS : METRIC_LABEL_STEPS

  const firstVisible = steps.findIndex((s) => s / mmPerPx >= minTick)
  const finest = firstVisible < 0 ? steps.length - 1 : firstVisible
  const levels = steps.slice(finest, finest + 4)
  const labelStep =
    labelSteps.find((s) => s / mmPerPx >= minLabel && s >= levels[0]!) ?? labelSteps[labelSteps.length - 1]!

  // The physical span this ruler covers, whichever way it runs.
  const a = startMm
  const b = startMm + direction * lengthPx * mmPerPx
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)

  const fine = levels[0]!
  const ticks: Tick[] = []
  const first = Math.ceil(lo / fine - 1e-9)
  const last = Math.floor(hi / fine + 1e-9)
  for (let k = first; k <= last; k++) {
    const mm = k * fine
    const u = ((mm - startMm) * direction) / mmPerPx
    const px = Math.min(lengthPx - 1, Math.max(0, Math.floor(u + 1e-9)))
    let level = 0
    for (let l = levels.length - 1; l > 0; l--) {
      if (isMultiple(mm, levels[l]!)) {
        level = l
        break
      }
    }
    const tick: Tick = { px, mm, level }
    if (isMultiple(mm, labelStep)) tick.label = formatDistance(mm, units, labelStep)
    ticks.push(tick)
  }
  return { ticks, stepMm: fine, labelStepMm: labelStep }
}

function isMultiple(value: number, step: number): boolean {
  const q = value / step
  return Math.abs(q - Math.round(q)) < 1e-6
}

/**
 * A ruler label. The unit follows the label SPACING, not the value, so one
 * ruler never switches unit half way along: labelled every 10 cm it reads
 * 10 cm … 90 cm, 100 cm, 110 cm; every 50 cm or more, 0.5 m, 1 m, 1.5 m.
 */
export function formatDistance(mm: number, units: ScaleOptions['units'], labelStepMm: number): string {
  const sign = mm < 0 ? '−' : ''
  const v = Math.abs(mm)
  if (units === 'imperial') {
    const inches = Math.round(v / MM_PER_INCH)
    if (labelStepMm < MM_PER_INCH * 12) {
      if (inches < 12) return `${sign}${inches}″`
      const ft = Math.floor(inches / 12)
      const rest = inches % 12
      return rest ? `${sign}${ft}′ ${rest}″` : `${sign}${ft}′`
    }
    return `${sign}${Math.round(inches / 12)}′`
  }
  if (v === 0) return '0'
  if (labelStepMm < 500) return `${sign}${round(v / 10, 1)} cm`
  return `${sign}${round(v / 1000, 2)} m`
}

/** A measured length for a caption: "4.80 m", "15′ 9″". */
export function formatLength(mm: number, units: ScaleOptions['units']): string {
  if (units === 'imperial') {
    const inches = mm / MM_PER_INCH
    if (inches < 12) return `${round(inches, 1)}″`
    const ft = Math.floor(inches / 12)
    const rest = Math.round(inches - ft * 12)
    return rest === 12 ? `${ft + 1}′ 0″` : `${ft}′ ${rest}″`
  }
  if (mm < 10) return `${round(mm, 1)} mm`
  if (mm < 1000) return `${round(mm / 10, 1)} cm`
  return `${(mm / 1000).toFixed(2)} m`
}

function round(v: number, places: number): number {
  const f = 10 ** places
  return Math.round(v * f) / f
}
