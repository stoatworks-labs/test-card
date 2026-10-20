/**
 * Seeded randomness for the generative patterns.
 *
 * Nothing in `src/patterns/` may call `Math.random`. A pattern is a function of
 * its settings, its output and the time, and nothing else: the preview and the
 * export must draw the same picture, frame N of a loop must be the same picture
 * every time it is asked for, and two outputs that span one wall must agree
 * about where the trees are. A seed makes all of that true.
 */

/** mulberry32: small, fast, and good enough for scenery. Returns 0..1. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mix any number of integers into one 32-bit seed. Order matters. */
export function hash(...values: number[]): number {
  let h = 0x811c9dc5
  for (const v of values) {
    h ^= Math.floor(v) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
    h ^= h >>> 13
  }
  return h >>> 0
}

/** One 0..1 value for a coordinate, with no generator to carry around. */
export function noise1(seed: number, ...at: number[]): number {
  return rng(hash(seed, ...at))()
}

export function between(r: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * r()
}

export function pick<T>(r: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(r() * items.length))]!
}

/** Fisher–Yates, in place, with the seeded generator. */
export function shuffle<T>(r: () => number, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[items[i], items[j]] = [items[j]!, items[i]!]
  }
  return items
}
