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
