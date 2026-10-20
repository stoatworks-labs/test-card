/**
 * What a painter is told besides its size.
 *
 * The original patterns only needed a raster. The new ones also need the time
 * (they move), the physical size of a pixel (they are drawn at real size), and
 * where this canvas sits on a larger surface (a scene or a ruler that spans two
 * processors must carry on across the join rather than start again). That is
 * all gathered here, worked out once in `render.ts`, and handed down — no
 * painter goes looking for it.
 */

import type { PatternSettings } from '../types'

/** Anything `drawImage` accepts that also knows its own size. */
export type PatternImage = CanvasImageSource & { width: number; height: number }

export type EnvTile = {
  x: number
  y: number
  width: number
  height: number
  col: number
  row: number
  ref: string
  order?: number
  group?: string
}

export type PaintEnv = {
  /** Seconds into the loop. A still is t = stillAtSeconds. */
  t: number
  /** The loop's exact length, from `loopTiming`. Moving things are periodic in it. */
  loopSeconds: number
  /**
   * The surface this canvas is a window onto, in the painter's own units. When
   * outputs are not spanned this is just the canvas.
   */
  world: { widthPx: number; heightPx: number }
  /** Where the canvas's top-left sits in that world. */
  view: { x: number; y: number }
  /** Millimetres per painter unit. */
  mmPerPx: number
  /** True when the output had no pitch of its own and the fallback was used. */
  pitchAssumed: boolean
  /** LED tiles in the painter's units — uniform, or the imported cabinets. */
  tiles: EnvTile[]
  /** Set when the tile size would make more tiles than anyone could mean: how many. */
  tooManyTiles?: number
  /**
   * 0 on a span, where every output shares one world and must agree. Otherwise
   * a number unique to the output, so outputs that are each their own world —
   * six identical projectors, say — do not all break in the same places.
   */
  localKey: number
  image: PatternImage | null
}

/** An env for a canvas that is its own world, at t = 0. Tests and simple callers. */
export function plainEnv(w: number, h: number, patch: Partial<PaintEnv> = {}): PaintEnv {
  return {
    t: 0,
    loopSeconds: 10,
    world: { widthPx: w, heightPx: h },
    view: { x: 0, y: 0 },
    mmPerPx: 2.6,
    pitchAssumed: true,
    tiles: [],
    localKey: 0,
    image: null,
    ...patch,
  }
}

const MOVING: ReadonlySet<PatternSettings['kind']> = new Set(['hamsters', 'ocean', 'dino-scroll', 'volcano'])

/** Whether a pattern changes over time, and so can be exported as a loop. */
export function isAnimated(settings: PatternSettings): boolean {
  if (MOVING.has(settings.kind)) return true
  if (settings.kind === 'broken-wall') {
    return (
      MOVING.has(settings.broken.base) ||
      settings.broken.faults.includes('flicker') ||
      settings.broken.faults.includes('noise')
    )
  }
  return false
}

/** Whether a pattern is drawn at physical size, and so cares about pitch. */
export function isScaleAware(settings: PatternSettings): boolean {
  const k = settings.kind === 'broken-wall' ? settings.broken.base : settings.kind
  return k === 'rulers' || k === 'bananas' || k === 'dinosaurs'
}
