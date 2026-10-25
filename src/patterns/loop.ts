/**
 * Loop timing for the moving patterns.
 *
 * A loop that a media server plays end to end must have no seam: the frame
 * after the last one is frame 0. That is only true if every moving thing in the
 * pattern completes a WHOLE number of cycles in the loop — a wave that has done
 * 3.4 of its periods when the file wraps jumps back by 0.4 of a wave, once
 * every loop, forever.
 *
 * So the loop is fixed first, in whole frames, and everything else is fitted
 * to it: speeds are rounded to whole cycles per loop rather than the loop being
 * stretched to suit a speed. `loopTiming` turns the user's "10 seconds at
 * 29.97" into a frame count and the EXACT duration those frames cover, which is
 * what the painters are given, so a pattern is periodic in the file's real
 * duration and not in a number that was rounded on the way in.
 */

import type { AnimationOptions } from '../types'

export const FPS: Record<AnimationOptions['fps'], { num: number; den: number }> = {
  '23.976': { num: 24000, den: 1001 },
  '24': { num: 24, den: 1 },
  '25': { num: 25, den: 1 },
  '29.97': { num: 30000, den: 1001 },
  '30': { num: 30, den: 1 },
  '50': { num: 50, den: 1 },
  '59.94': { num: 60000, den: 1001 },
  '60': { num: 60, den: 1 },
}

export type LoopTiming = {
  frames: number
  fpsNum: number
  fpsDen: number
  /** frames * den / num — the loop's true length, which painters must use. */
  seconds: number
}

export function loopTiming(opts: Pick<AnimationOptions, 'seconds' | 'fps'>): LoopTiming {
  const { num, den } = FPS[opts.fps] ?? FPS['30']
  const wanted = Number.isFinite(opts.seconds) ? Math.max(1, Math.min(600, opts.seconds)) : 10
  const frames = Math.max(1, Math.round((wanted * num) / den))
  return { frames, fpsNum: num, fpsDen: den, seconds: (frames * den) / num }
}

/** Time of frame `n`, in seconds. */
export function frameTime(n: number, timing: LoopTiming): number {
  return (n * timing.fpsDen) / timing.fpsNum
}

/**
 * Whole cycles per loop for something that would naturally do `natural` of
 * them. Never zero — a thing that does no cycles is not moving, and a pattern
 * that asked for movement should not silently freeze on a short loop.
 */
export function wholeCycles(natural: number): number {
  return Math.max(1, Math.round(natural))
}

/** Phase in 0..1 of something doing `cycles` whole cycles per loop. */
export function phase(t: number, loopSeconds: number, cycles: number): number {
  const p = ((t / loopSeconds) * cycles) % 1
  return p < 0 ? p + 1 : p
}

// ---------------------------------------------------------------------------
// Endless, for live output
// ---------------------------------------------------------------------------
//
// With "endless" on, a generative pattern is not a loop. Nothing is fitted to
// one: a thing doing 3.4 cycles in the loop's length does 3.4, so the picture
// never comes round to where it was. And anything that comes round — a bat
// crossing the sky, a zombie crossing the graveyard, a hamster's next dance —
// comes round as a new one, generated from which time round it is (`lapNumber`).
// The loop's length is still the unit everything is measured in, so the speeds
// are the ones the loop would have had, give or take the fitting.
//
// Time is seconds since ENDLESS_EPOCH_S on the shared clock (live/clock.ts),
// so every live window and the editor's preview show the same moment, as the
// looping live output does with the time modulo the loop. Seconds since 2026
// rather than since 1970 keep t small enough that a phase or a pixel
// position computed from it is exact to far below a pixel for decades.

/** 2026-01-01T00:00:00Z, in seconds since 1970. */
export const ENDLESS_EPOCH_S = 1_767_225_600

/** An endless pattern's time at wall-clock `unixMs`. */
export function endlessTime(unixMs: number): number {
  return unixMs / 1000 - ENDLESS_EPOCH_S
}

/**
 * Cycles per loop for something that would naturally do `natural`: whole ones
 * for a loop (`wholeCycles`), or exactly `natural` when endless and nothing has
 * to come round.
 */
export function cyclesPerLoop(natural: number, endless: boolean): number {
  return endless ? Math.max(natural, Number.MIN_VALUE) : wholeCycles(natural)
}

/**
 * A little ambient motion (a twinkle, a bob, a glow, a sway) that the loop gave a
 * small whole number of cycles: as it was when looping; endless, a little off it,
 * by an amount of its own (`salt`), so no two of them fall back into step and the
 * picture as a whole never comes round.
 */
export function freeCycles(cycles: number, endless: boolean, salt = 0): number {
  if (!endless) return cycles
  return cycles * (0.87 + 0.26 * (((salt + 1) * 0.6180339887498949) % 1))
}

/**
 * Which time round something doing `cycles` per loop is on at t, counting a new
 * one at each wrap of `(phase + offset) % 1`. An endless pattern seeds a thing's
 * looks from this, so each time round is a new one.
 */
export function lapNumber(t: number, loopSeconds: number, cycles: number, offset = 0): number {
  return Math.floor((t / loopSeconds) * cycles + offset)
}
