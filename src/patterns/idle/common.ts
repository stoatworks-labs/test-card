/**
 * What every idle saver is handed, and the clock that keeps it in the loop.
 *
 * The savers are a port of Idler's (~/Projects/resolume/idler, `Savers.cpp` and
 * the eleven under `source/savers/`), by way of its browser demo's JavaScript.
 * Idler's savers are already pure functions of (time, seed) — nothing integrates
 * a velocity, nothing remembers the last frame — which is the hard part of
 * fitting them into Test Card. What they are not is PERIODIC: a Mystify corner
 * bounces at a rate drawn from a hash, and after a 10 s loop it is wherever that
 * rate left it.
 *
 * So every rate here goes through the clock below and comes out as a whole
 * number of cycles per loop (invariant 8). That is the one systematic change from
 * Idler; where a saver needed more than that, the saver says so where it does it.
 * With the fitting switched off (a period of 0) every saver builds Idler's mesh,
 * camera and fog exactly, which `scripts/check-idle-port.mjs` checks against
 * Idler's own port. So what differs from Idler is only what the loop needs.
 */

import { hash2, hsvToRgb, mul3, TAU, v4, type V3, type V4 } from './maths'
import type { Scene, ShadingMode } from './scene'

/** Idler's Settings: the controls already converted to what the savers work in. */
export type IdleSettings = {
  /** The seven scene controls, 0..1, which each saver maps onto whatever it has that is analogous. */
  density: number
  complexity: number
  size: number
  length: number
  lineWidth: number
  variation: number
  shading: ShadingMode
  /** Saver seconds: the loop's time with Speed folded in. */
  time: number
  /** The loop's length in saver seconds. Everything that moves is periodic in it. 0 fits nothing (Idler's own, and endless). */
  period: number
  /**
   * How long one run of a growing saver (Pipes, Maze) lasts, in saver seconds,
   * when that is not the loop: set only when endless, where the period is 0 and
   * each run starts afresh from a seed of its own (`runSeed`). Unset or 0: the
   * period, or no restarts at all when that is 0 too (Idler's own, `check-idle-port`).
   */
  run?: number
  /** Endless (`idleSettings`): things that come round come round as new ones. Unset in Idler's own and when looping. */
  endless?: boolean
  seed: number
  /** Vertical, radians. */
  fov: number
  /** 0..1. */
  camDistance: number
  /** Radians. */
  camTilt: number
  /** 0..1, 0 = off. */
  fog: number
  colourMode: ColourMode
  /** The chosen colour, RGB 0..1. */
  tint: V3
  /** Turns across a set, in Spread. */
  hueSpread: number
  /** Turns per saver second, in Spread and Cycle. Fitted like everything else. */
  hueCycle: number
  /** Width over height of the whole surface: one unit is half its height. */
  aspect: number
  text: string
}

export const ColourMode = { Classic: 0, Tint: 1, Spread: 2, Cycle: 3 } as const
export type ColourMode = (typeof ColourMode)[keyof typeof ColourMode]

export interface Saver {
  build(s: IdleSettings, scene: Scene): void
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

export type Clock = Pick<IdleSettings, 'time' | 'period'>

/**
 * `rate` (cycles per saver second) moved to the nearest rate that does a whole
 * number of cycles in the period — at least one, so nothing asked to move
 * freezes on a short loop. Zero stays zero, and the sign is kept.
 */
export function fit(s: Clock, rate: number): number {
  if (rate === 0 || !(s.period > 0)) return rate
  return (Math.sign(rate) * Math.max(1, Math.round(Math.abs(rate) * s.period))) / s.period
}

/**
 * As `fit`, but rounding up or down by `chance` (0..1, from a hash) instead of
 * to the nearest. For a family of objects whose rates must stay different: on a
 * 10 s loop every Mystify corner's natural rate is 0.7 to 1.2 cycles, and
 * rounding them all to one cycle would move the corners in lock-step and stop
 * the polygon writhing. Rounded by chance, some do one and some two, and the
 * average is the natural rate.
 */
export function fitSpread(s: Clock, rate: number, chance: number): number {
  if (rate === 0 || !(s.period > 0)) return rate
  return (Math.sign(rate) * Math.max(1, Math.floor(Math.abs(rate) * s.period + chance))) / s.period
}

/** Cycles done by now at a fitted rate. */
export const turns = (s: Clock, rate: number): number => s.time * fit(s, rate)

/** Radians turned by now at a fitted angular rate. */
export const radians = (s: Clock, perSecond: number): number => TAU * turns(s, perSecond / TAU)

/**
 * A camera orbit at `perSecond` radians: whole turns per loop when the loop is
 * long enough to make at least half of one naturally, otherwise a sway either
 * side whose fastest is that rate. Idler's Pipes orbit is 0.06 rad/s; forced to
 * a whole turn in 10 s it would whip round at ten times that.
 */
export function orbit(s: Clock, perSecond: number): number {
  const natural = (perSecond * s.period) / TAU
  if (!(s.period > 0) || Math.abs(natural) >= 0.5) return radians(s, perSecond)
  return natural * Math.sin((TAU * s.time) / s.period)
}

/**
 * Where a growing saver is in its run. Pipes and Maze cannot be periodic — where
 * a pipe goes next depends on where it has been — so each loop is one run from
 * the seed, restarting once a loop. `start` (0..1 of the loop) is where in the
 * loop the restart falls, so frame 0, the default still, is well into a run
 * rather than an empty box.
 */
export function runTime(s: Clock & Pick<IdleSettings, 'run'>, start: number): number {
  const length = runLength(s)
  if (!(length > 0)) return s.time
  const u = (s.time - start * length) % length
  return u < 0 ? u + length : u
}

export type RunClock = Clock & Pick<IdleSettings, 'run' | 'seed'>

/** A growing saver's run, in saver seconds: `run` when endless, else the loop; 0 for no restarts. */
export function runLength(s: Pick<IdleSettings, 'run' | 'period'>): number {
  return (s.run ?? 0) > 0 ? s.run! : s.period
}

/**
 * The seed a run grows from. Looping, every loop is the same run, from the
 * seed. Endless, each run is a new one: the seed hashed with which run it is,
 * counted like `runTime`'s restarts.
 */
export function runSeed(s: RunClock, start: number): number {
  const length = s.run ?? 0
  if (!(length > 0)) return s.seed
  return hash2(s.seed >>> 0, Math.floor((s.time - start * length) / length) >>> 0)
}

// ---------------------------------------------------------------------------
// Controls.cpp's conversions, and the colour modes
// ---------------------------------------------------------------------------

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

function exponential(value: number, lo: number, centre: number, hi: number): number {
  value = clamp01(value)
  if (value < 0.5) return lo * Math.pow(centre / lo, value * 2)
  return centre * Math.pow(hi / centre, (value - 0.5) * 2)
}

/** Speed multiplier, 0..4, exactly 1 at the centre; a dead zone at the bottom stops it. */
export function speedFromParam(value: number): number {
  value = clamp01(value)
  if (value < 0.02) return 0
  return exponential((value - 0.02) / 0.98, 0.05, 1, 4)
}

/** Vertical field of view, 20..120 degrees, in radians. */
export const fovFromParam = (value: number): number => ((20 + clamp01(value) * 100) * Math.PI) / 180

/** Camera tilt, -60..60 degrees, in radians. */
export const camTiltFromParam = (value: number): number => ((clamp01(value) * 2 - 1) * 60 * Math.PI) / 180

/** Hue rotation in turns per second, -0.5..0.5, squared so slow drifts get most of the travel. */
export function hueCycleFromParam(value: number): number {
  const centred = clamp01(value) * 2 - 1
  return centred * Math.abs(centred) * 0.5
}

/** Density onto a whole number in [lo, hi], quadratic: 3 against 4 matters, 51 against 52 does not. */
export function countFromDensity(density: number, lo: number, hi: number): number {
  const d = clamp01(density)
  return lo + Math.trunc(d * d * (hi - lo) + 0.5)
}

/**
 * A colour for object `index` of `count`, honouring the colour mode. `classic`
 * is what that saver would have drawn; the other modes keep its luminance, which
 * is what stops Tint flattening a lit solid into a silhouette.
 */
export function settingsColour(s: IdleSettings, classic: V3, index: number, count: number): V4 {
  const luma = 0.2126 * classic.x + 0.7152 * classic.y + 0.0722 * classic.z
  let rgb = classic
  if (s.colourMode === ColourMode.Tint) {
    rgb = mul3(s.tint, luma)
  } else if (s.colourMode === ColourMode.Spread || s.colourMode === ColourMode.Cycle) {
    const { x: r, y: g, z: b } = s.tint
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const sat = maxC > 1e-5 ? (maxC - minC) / maxC : 0
    let baseHue = 0
    if (maxC - minC > 1e-5) {
      const d = maxC - minC
      if (maxC === r) baseHue = (g - b) / d / 6
      else if (maxC === g) baseHue = (2 + (b - r) / d) / 6
      else baseHue = (4 + (r - g) / d) / 6
    }
    // By index, so the fan is stable frame to frame.
    const fraction = count > 1 ? index / (count - 1) : 0
    const spread = s.colourMode === ColourMode.Spread ? s.hueSpread * fraction : 0
    rgb = hsvToRgb(baseHue + spread + turns(s, s.hueCycle), sat > 0.02 ? sat : 1, luma)
  }
  return v4(rgb.x, rgb.y, rgb.z, 1)
}
