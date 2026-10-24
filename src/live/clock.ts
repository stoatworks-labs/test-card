/**
 * The clock every live window agrees on.
 *
 * `performance.timeOrigin + performance.now()` looks like it, and isn't: each
 * renderer process fixes its own wall-clock anchor once, and on a Mac the
 * monotonic clock under `performance.now()` stops while the machine sleeps. A
 * window opened after a night's sleep, or after the clock was stepped on joining
 * the venue's network, would be that far out from one opened before, and a scene
 * spanning the two would jump at the join.
 *
 * `Date.now()` is the same in every process, but whole milliseconds and liable
 * to step. So the offset between it and `performance.now()` is taken once a
 * second, and frames are timed by `performance.now()` plus that offset: smooth
 * between samples, and back in line within a second of the clock moving.
 */

/** How far a fresh sample may sit from the current offset before it replaces it outright. */
const STEP_MS = 4
const SAMPLE_EVERY_MS = 1000
const KEEP = 8

let samples: number[] = []
let offset = NaN
let sampledAt = NaN

function refresh(perfNow: number) {
  if (perfNow - sampledAt < SAMPLE_EVERY_MS && perfNow >= sampledAt) return
  sampledAt = perfNow
  const fresh = Date.now() - performance.now()
  // A sleep or a clock step: start again from here.
  if (!(Math.abs(fresh - offset) <= STEP_MS)) samples = []
  samples.push(fresh)
  if (samples.length > KEEP) samples.shift()
  // Date.now() is rounded down to the millisecond, so every sample is up to 1 ms
  // low; the largest of the last few is the nearest.
  offset = Math.max(...samples)
}

/** Milliseconds since 1970 at `performance.now()` time `perf` (default: now). */
export function unixMs(perf = performance.now()): number {
  refresh(performance.now())
  return perf + offset
}

/** For tests: forget every sample. */
export function _resetClock() {
  samples = []
  offset = NaN
  sampledAt = NaN
}
