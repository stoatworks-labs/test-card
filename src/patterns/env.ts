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
import { PUMPKIN_FACES } from './art/halloween'
import { idleMoves, isIdle } from './idle'

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

const MOVING: ReadonlySet<PatternSettings['kind']> = new Set([
  'hamsters',
  'ocean',
  'dino-scroll',
  'volcano',
  'spooky-forest',
  'haunted-house',
  'av-sync',
])

/**
 * Whether a kind of pattern moves with these settings. Pumpkins only do if they have candles or faces to pull,
 * and an idle pattern unless its speed is turned right down.
 */
function moves(kind: PatternSettings['kind'], settings: PatternSettings): boolean {
  if (isIdle(kind)) return idleMoves(kind, settings.idle)
  if (kind === 'pumpkins') {
    const p = settings.pumpkins
    // Only faces it knows: a stored list of names it doesn't would draw plain, still pumpkins.
    return p.faces.some((f) => PUMPKIN_FACES.includes(f)) && (p.flicker || p.expressions)
  }
  return MOVING.has(kind)
}

/** Whether a pattern changes over time, and so can be exported as a loop. */
export function isAnimated(settings: PatternSettings): boolean {
  if (moves(settings.kind, settings)) return true
  if (settings.kind === 'broken-wall') {
    return (
      moves(settings.broken.base, settings) ||
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
