import { describe, expect, it } from 'vitest'
import { drawnKey, installPath2D, RecordingContext, type Drawn } from '../../test/recording-context'
import { DEFAULT_SETTINGS } from '../state/defaults'
import type { Output } from '../types'
import { drawHauntedHouse, drawPumpkins, drawSpookyForest } from './halloween'
import { plainEnv, type PaintEnv } from './env'
import { loopTiming } from './loop'
import { makeEnv } from './render'

/**
 * The Halloween painters, run against a recording context. The pure tests next
 * door check the timing and the artwork; these check what the painters actually
 * draw: the same at the end of the loop as at the start, the same on each output
 * of a span as on the whole surface, and the context left as it was found.
 */

installPath2D()

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, env: PaintEnv) => void

const forest = (speed = 3): Painter => (c, w, h, env) => drawSpookyForest(c, w, h, { seed: 7, speed }, env)
const house: Painter = (c, w, h, env) => drawHauntedHouse(c, w, h, { seed: 7, speed: 3 }, env)
const pumpkins: Painter = (c, w, h, env) => drawPumpkins(c, w, h, DEFAULT_SETTINGS.pumpkins, env)

const PAINTERS: [string, Painter][] = [
  ['forest', forest()],
  ['house', house],
  ['pumpkins', pumpkins],
]

function paint(p: Painter, w: number, h: number, env: PaintEnv, at: [number, number] = [0, 0]): RecordingContext {
  const rec = new RecordingContext([1, 0, 0, 1, at[0], at[1]])
  p(rec.ctx, w, h, env)
  return rec
}

const keys = (rec: RecordingContext) => rec.drawn.map(drawnKey)

describe('the Halloween painters loop with no seam', () => {
  it.each(PAINTERS)('%s draws the same at the end of the loop as at the start, and moves in between', (_name, p) => {
    for (const fps of ['30', '29.97', '59.94'] as const) {
      const T = loopTiming({ seconds: 10, fps }).seconds
      const start = paint(p, 960, 540, plainEnv(960, 540, { t: 0, loopSeconds: T }))
      expect(keys(paint(p, 960, 540, plainEnv(960, 540, { t: T, loopSeconds: T })))).toEqual(keys(start))
      expect(keys(paint(p, 960, 540, plainEnv(960, 540, { t: T / 3, loopSeconds: T })))).not.toEqual(keys(start))
    }
  })

  it('the forest is seamless at the slowest and fastest scroll', () => {
    for (const speed of [1, 20]) {
      const T = loopTiming({ seconds: 7, fps: '29.97' }).seconds
      const a = paint(forest(speed), 960, 540, plainEnv(960, 540, { t: 0, loopSeconds: T }))
      const b = paint(forest(speed), 960, 540, plainEnv(960, 540, { t: T, loopSeconds: T }))
      expect(keys(b)).toEqual(keys(a))
    }
  })
})

describe('the Halloween painters leave the context as they found it', () => {
  const sizes: [number, number][] = [[1920, 1080], [1080, 1920], [64, 36], [7680, 64], [2, 2]]
  it.each(PAINTERS)('%s, at any size, asks for nothing a canvas would refuse', (_name, p) => {
    for (const [w, h] of sizes) {
      const rec = paint(p, w, h, plainEnv(w, h, { t: 1.234 }))
      expect(rec.bad).toEqual([])
      expect(rec.stack).toHaveLength(0)
      expect(rec.m).toEqual([1, 0, 0, 1, 0, 0])
      expect(rec.globalAlpha).toBe(1)
      expect(rec.drawn.length).toBeGreaterThan(0)
    }
  })
})

describe('the Halloween scenes on a span', () => {
  const world = { widthPx: 5760, heightPx: 1080 }

  it.each([['forest', forest()], ['house', house]] as [string, Painter][])(
    '%s draws on each output what the whole surface draws there',
    (_name, p) => {
      for (const t of [0, 3.3]) {
        const whole = paint(p, world.widthPx, world.heightPx, plainEnv(world.widthPx, world.heightPx, { t, world }))
        const everything = new Set(whole.drawn.map(drawnKey))
        for (const vx of [0, 1920, 3840]) {
          // Drawn where the output sits, as a real span render does, so the two agree on coordinates.
          const part = paint(p, 1920, 1080, plainEnv(1920, 1080, { t, world, view: { x: vx, y: 0 } }), [vx, 0])
          const mine = new Set(part.drawn.map(drawnKey))
          // Things wholly inside this output. Skies, ground and ridges are cut to each output's view, so they aren't.
          const inside = (d: Drawn) => d.box[0] > vx + 2 && d.box[2] < vx + 1918 && d.box[1] > 2 && d.box[3] < 1078
          const extra = part.drawn.filter(inside).filter((d) => !everything.has(drawnKey(d)))
          const missing = whole.drawn.filter(inside).filter((d) => !mine.has(drawnKey(d)))
          expect(extra.map((d) => d.op)).toEqual([])
          expect(missing.map((d) => d.op)).toEqual([])
        }
      }
    },
  )

  it('gives each output of a spanned pumpkin patch its own pumpkins, not a copy', () => {
    const settings = { ...DEFAULT_SETTINGS, kind: 'pumpkins' as const }
    const composition = { widthPx: 3840, heightPx: 1080 }
    const drawnFor = (x: number) => {
      const output: Output = {
        id: `at-${x}`,
        name: `at ${x}`,
        widthPx: 1920,
        heightPx: 1080,
        rasterSource: 'manual',
        source: 'manual',
        regions: [],
        notes: [],
        enabled: true,
        compositionRect: { x, y: 0, width: 1920, height: 1080 },
      }
      const env = makeEnv(output, settings, 1920, 1080, { rect: output.compositionRect!, composition }, 1)
      expect(env.localKey).toBe(0)
      const rec = new RecordingContext()
      drawPumpkins(rec.ctx, 1920, 1080, settings.pumpkins, env)
      return keys(rec).join('\n')
    }
    expect(drawnFor(0)).not.toBe(drawnFor(1920))
  })
})
