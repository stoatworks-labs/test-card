import { describe, expect, it } from 'vitest'
import { drawnKey, installPath2D, RecordingContext, type Drawn } from '../../test/recording-context'
import { DEFAULT_SETTINGS } from '../state/defaults'
import type { Output, PatternSettings } from '../types'
import { liveTime } from '../live/plan'
import { buildManifest, outputFileName } from '../lib/export'
import { canRunEndless, endlessOn, plainEnv, type PaintEnv } from './env'
import { drawHauntedHouse, drawPumpkins, drawSpookyForest } from './halloween'
import { buildIdleScene, ENDLESS_RUN_SECONDS, idleSettings } from './idle'
import { runSeed, runTime } from './idle/common'
import { cyclesPerLoop, ENDLESS_EPOCH_S, endlessTime, lapNumber, loopTiming } from './loop'
import { drawHamsters, hamsterDance } from './novelty'
import { stillTime } from './render'
import { drawDinoScroll, drawOcean, drawVolcano, eachRepeatIndexed, lapX, seaBands } from './scenes'

/**
 * Endless, the live-only way of running the generative patterns: nothing fitted
 * to the loop, and whatever comes round a new one each time. The loop tests
 * elsewhere hold the patterns periodic with it off; these hold that with it on
 * they never come round, move without jumps, and still agree across a span.
 */

installPath2D()

type Painter = (ctx: CanvasRenderingContext2D, w: number, h: number, env: PaintEnv) => void

const scene = { seed: 7, speed: 3 }
const PAINTERS: [string, Painter][] = [
  ['forest', (c, w, h, env) => drawSpookyForest(c, w, h, scene, env)],
  ['house', (c, w, h, env) => drawHauntedHouse(c, w, h, scene, env)],
  ['pumpkins', (c, w, h, env) => drawPumpkins(c, w, h, DEFAULT_SETTINGS.pumpkins, env)],
  ['ocean', (c, w, h, env) => drawOcean(c, w, h, DEFAULT_SETTINGS.ocean, env)],
  ['dinosaurs', (c, w, h, env) => drawDinoScroll(c, w, h, scene, env)],
  ['volcano', (c, w, h, env) => drawVolcano(c, w, h, scene, env)],
  ['hamsters', (c, w, h, env) => drawHamsters(c, w, h, DEFAULT_SETTINGS.hamsters, env)],
]

function paint(p: Painter, w: number, h: number, env: PaintEnv, at: [number, number] = [0, 0]): RecordingContext {
  const rec = new RecordingContext([1, 0, 0, 1, at[0], at[1]])
  p(rec.ctx, w, h, env)
  return rec
}

const keys = (rec: RecordingContext) => rec.drawn.map(drawnKey)

/** Seconds into an endless run in about 2030: big, as a live window's are. */
const LATE = endlessTime(Date.UTC(2030, 5, 1, 21, 0, 0))

const with_ = (patch: Partial<PatternSettings>, animation: Partial<PatternSettings['animation']> = {}): PatternSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
  animation: { ...DEFAULT_SETTINGS.animation, ...animation },
})

describe('the endless clock', () => {
  it('fits nothing, and counts the times round', () => {
    expect(cyclesPerLoop(3.4, false)).toBe(3)
    expect(cyclesPerLoop(3.4, true)).toBe(3.4)
    expect(cyclesPerLoop(0.2, false)).toBe(1)
    expect(cyclesPerLoop(0.2, true)).toBe(0.2)
    expect(lapNumber(25, 10, 1)).toBe(2)
    expect(lapNumber(25, 10, 1, 0.6)).toBe(3)
    expect(lapNumber(25, 10, 0.5)).toBe(1)
  })

  it('counts seconds from 2026 on the shared clock, unwrapped, where a looping window wraps', () => {
    expect(endlessTime(ENDLESS_EPOCH_S * 1000)).toBe(0)
    expect(endlessTime(Date.UTC(2026, 0, 1, 0, 1, 0))).toBe(60)
    const ms = Date.UTC(2026, 9, 25, 18, 0, 0)
    expect(liveTime(ms, 10, true)).toBe(endlessTime(ms))
    expect(liveTime(ms, 10, true)).toBeGreaterThan(10)
    expect(liveTime(ms, 10)).toBeGreaterThanOrEqual(0)
    expect(liveTime(ms, 10)).toBeLessThan(10)
  })
})

describe('which patterns run endless', () => {
  it('the generative moving ones, with the switch on', () => {
    for (const kind of ['hamsters', 'ocean', 'dino-scroll', 'volcano', 'spooky-forest', 'haunted-house', 'mystify', 'pipes', 'maze'] as const) {
      expect(canRunEndless(with_({ kind })), kind).toBe(true)
      expect(endlessOn(with_({ kind }))).toBe(false)
      expect(endlessOn(with_({ kind }, { endless: true }))).toBe(true)
    }
  })

  it('not the measurements, AV sync included, nor anything that does not move', () => {
    for (const kind of ['av-sync', 'smpte-rp219', 'rulers', 'bananas', 'solid'] as const) {
      expect(endlessOn(with_({ kind }, { endless: true })), kind).toBe(false)
    }
    // Pumpkins with nothing to pull, and a stopped idle saver, are stills.
    const still = with_({ kind: 'pumpkins', pumpkins: { ...DEFAULT_SETTINGS.pumpkins, flicker: false, expressions: false } }, { endless: true })
    expect(endlessOn(still)).toBe(false)
    const stopped = with_(
      { kind: 'mystify', idle: { ...DEFAULT_SETTINGS.idle, looks: { ...DEFAULT_SETTINGS.idle.looks, mystify: { ...DEFAULT_SETTINGS.idle.looks.mystify, speed: 0 } } } },
      { endless: true },
    )
    expect(endlessOn(stopped)).toBe(false)
  })

  it('a broken wall over a generative pattern runs endless; over bars it does not', () => {
    expect(endlessOn(with_({ kind: 'broken-wall', broken: { ...DEFAULT_SETTINGS.broken, base: 'haunted-house' } }, { endless: true }))).toBe(true)
    expect(endlessOn(with_({ kind: 'broken-wall', broken: { ...DEFAULT_SETTINGS.broken, base: 'smpte-rp219' } }, { endless: true }))).toBe(false)
  })
})

describe('an endless still and its MP4 slice', () => {
  const output: Output = {
    id: 'a',
    name: 'Wall',
    widthPx: 1920,
    heightPx: 1080,
    rasterSource: 'manual',
    source: 'manual',
    regions: [],
    notes: [],
    enabled: true,
  }

  it('the still is taken where it is asked for, not wrapped into the loop', () => {
    expect(stillTime(with_({ kind: 'volcano' }, { stillAtSeconds: 75 })).t).toBe(5)
    expect(stillTime(with_({ kind: 'volcano' }, { stillAtSeconds: 75, endless: true })).t).toBe(75)
  })

  it('the MP4 says it is a slice, in its name and the manifest', () => {
    const loop = with_({ kind: 'volcano' })
    const slice = with_({ kind: 'volcano' }, { endless: true, stillAtSeconds: 20 })
    expect(outputFileName(output, loop, 'mp4')).not.toContain('slice')
    expect(outputFileName(output, slice, 'mp4')).toMatch(/_slice\.mp4$/)
    expect(outputFileName(output, slice, 'png')).not.toContain('slice')
    expect(buildManifest('Show', [output], ['f.mp4'], loop, 'mp4')).toContain('seamless')
    const m = buildManifest('Show', [output], ['f.mp4'], slice, 'mp4')
    expect(m).toContain('NOT a loop')
    expect(m).toContain('from 20 s')
  })
})

describe('the endless painters', () => {
  const T = loopTiming({ seconds: 10, fps: '30' }).seconds
  const at = (t: number) => plainEnv(960, 540, { t, loopSeconds: T, endless: true })

  it.each(PAINTERS)('%s never comes round: a loop, two and seven loops on, it is somewhere else', (_name, p) => {
    for (const t0 of [1000.3, LATE]) {
      const start = keys(paint(p, 960, 540, at(t0)))
      for (const n of [1, 2, 7]) expect(keys(paint(p, 960, 540, at(t0 + n * T)))).not.toEqual(start)
    }
  })

  it.each(PAINTERS)('%s, years in, asks for nothing a canvas would refuse and leaves the context as it found it', (_name, p) => {
    for (const [w, h] of [[1920, 1080], [1080, 1920], [64, 36]] as [number, number][]) {
      const rec = paint(p, w, h, plainEnv(w, h, { t: LATE, loopSeconds: T, endless: true }))
      expect(rec.bad).toEqual([])
      expect(rec.stack).toHaveLength(0)
      expect(rec.m).toEqual([1, 0, 0, 1, 0, 0])
      expect(rec.globalAlpha).toBe(1)
      expect(rec.drawn.length).toBeGreaterThan(0)
    }
  })

  it('a loop later, each walker in the graveyard is where its slot puts one, and is a different one', () => {
    // A walker's shadow is a 'rgba(0, 0, 0, 0.4)' ellipse at its feet, as wide as it is tall times 0.32:
    // where it is, how near (y) and how tall (width) it is, from one fill.
    const shadows = (env: PaintEnv) =>
      paint((c, w, h, e) => drawHauntedHouse(c, w, h, scene, e), 1920, 1080, env)
        .drawn.filter((d) => d.op === 'fill' && d.style === 'rgba(0, 0, 0, 0.4)')
        .map((d) => ({ x: (d.box[0] + d.box[2]) / 2, y: (d.box[1] + d.box[3]) / 2, w: d.box[2] - d.box[0] }))
    for (const endless of [false, true]) {
      for (const t0 of [1000.3, LATE]) {
        const env = (t: number) => plainEnv(1920, 1080, { t, loopSeconds: T, endless })
        const a = shadows(env(t0))
        const b = shadows(env(t0 + T))
        let paired = 0
        let changed = 0
        for (const s of a) {
          // A lap a loop: the same slots stand in the same places, give or take a zombie's lurch.
          const near = b.filter((o) => Math.abs(o.x - s.x) < 60)
          if (near.length !== 1) continue
          paired++
          if (Math.abs(near[0]!.y - s.y) > 0.5 || Math.abs(near[0]!.w - s.w) > 0.5) changed++
        }
        expect(paired).toBeGreaterThanOrEqual(2)
        if (endless) expect(changed).toBeGreaterThanOrEqual(paired - 1)
        else expect(changed).toBe(0)
      }
    }
  })
})

describe('the endless scenes on a span', () => {
  const world = { widthPx: 5760, heightPx: 1080 }
  const SPANNED = PAINTERS.filter(([name]) => name !== 'pumpkins' && name !== 'hamsters')

  it.each(SPANNED)('%s draws on each output what the whole surface draws there', (_name, p) => {
    for (const t of [1000.3, LATE]) {
      const env = { t, world, loopSeconds: 10, endless: true }
      const whole = paint(p, world.widthPx, world.heightPx, plainEnv(world.widthPx, world.heightPx, env))
      const everything = new Set(whole.drawn.map(drawnKey))
      for (const vx of [0, 1920, 3840]) {
        const part = paint(p, 1920, 1080, plainEnv(1920, 1080, { ...env, view: { x: vx, y: 0 } }), [vx, 0])
        const mine = new Set(part.drawn.map(drawnKey))
        // The ocean's foam is stroked along as much of a crest as is in view, so an
        // output's strokes are cut differently from the whole's, looping too: its fills only.
        const inside = (d: Drawn) =>
          d.box[0] > vx + 2 && d.box[2] < vx + 1918 && d.box[1] > 2 && d.box[3] < 1078 && !(_name === 'ocean' && d.op === 'stroke')
        expect(part.drawn.filter(inside).filter((d) => !everything.has(drawnKey(d))).map((d) => d.op)).toEqual([])
        expect(whole.drawn.filter(inside).filter((d) => !mine.has(drawnKey(d))).map((d) => d.op)).toEqual([])
      }
    }
  })
})

describe('what crosses the picture keeps being itself until it has gone', () => {
  it('a repeat keeps its number as it moves, and the next one in has the next', () => {
    const T = 10
    const lap = 3000
    const seen = (t: number) => {
      const out = new Map<number, number>()
      eachRepeatIndexed(lapX({ t, loopSeconds: T, endless: true }, 812, 1, lap), lap, -500, 2420, (x, k) => out.set(k, x))
      return out
    }
    for (const t0 of [0.5, LATE]) {
      const a = seen(t0)
      const b = seen(t0 + 1 / 60)
      let common = 0
      for (const [k, x] of a) {
        const x2 = b.get(k)
        if (x2 === undefined) continue
        common++
        // A sixtieth of a second's travel, and nothing else.
        expect(x2 - x).toBeCloseTo(lap / T / 60, 3)
      }
      expect(common).toBeGreaterThan(0)
      // A whole loop on, every repeat on screen is a different one.
      const c = seen(t0 + T)
      for (const k of c.keys()) expect(a.has(k) && Math.abs(c.get(k)! - a.get(k)!) < 1).toBe(false)
    }
  })

  it('the sea hands a band on to the next slot as it rolls, with no jump, its own phase and all', () => {
    const world = { widthPx: 1920, heightPx: 1080 }
    const T = 10
    const roll = T / 1.6
    for (const n of [7, 4_000_000]) {
      const wrap = (n * T) / roll
      const eps = 1e-6
      const before = seaBands(1, DEFAULT_SETTINGS.ocean, world, 0, 1920, wrap - eps, T, 8, true)
      const after = seaBands(1, DEFAULT_SETTINGS.ocean, world, 0, 1920, wrap + eps, T, 8, true)
      // Band k with its roll nearly done is band k + 1 with its roll just begun.
      for (let k = 0; k + 1 < after.length && k < before.length; k++) {
        const a = before[k]!
        const b = after[k + 1]!
        expect(b.pts.length).toBe(a.pts.length)
        const worst = Math.max(...a.pts.map((p, i) => Math.abs(p[1] - b.pts[i]![1])))
        expect(worst).toBeLessThan(0.01)
      }
    }
  })

  it('a hamster tile picks a new dance each time round when endless, and keeps its own when looping', () => {
    const tile = { x: 128, y: 0, col: 1, row: 0 }
    const env = { view: { x: 0, y: 0 }, localKey: 0 }
    const dances = new Set(Array.from({ length: 12 }, (_, n) => hamsterDance(tile, { ...env, endless: true }, n)))
    expect(dances.size).toBeGreaterThan(1)
    expect(hamsterDance(tile, { ...env, endless: false }, 0)).toBe(hamsterDance(tile, { ...env, endless: false }, 5))
  })
})

describe('the idle savers, endless', () => {
  const opts = DEFAULT_SETTINGS.idle
  const vertices = (s: ReturnType<typeof idleSettings>, kind: Parameters<typeof idleSettings>[0]) => {
    const m = buildIdleScene(kind, s).mesh
    return [m.px, m.py, m.pz].map((a) => a.map((v) => v.toFixed(5)).join(',')).join('|')
  }

  it('run at Idler’s own rates, and the growing two in runs of their own', () => {
    const loop = idleSettings('mystify', opts, 16 / 9, 3, 10)
    const endless = idleSettings('mystify', opts, 16 / 9, 3, 10, true)
    expect(loop.period).toBeGreaterThan(0)
    expect(loop.run).toBeUndefined()
    expect(endless.period).toBe(0)
    expect(endless.run).toBe(ENDLESS_RUN_SECONDS)
  })

  it.each(['mystify', 'flying-windows', 'pipes', 'maze', 'flowerbox'] as const)('%s never comes round', (kind) => {
    for (const t0 of [40.5, LATE]) {
      const a = vertices(idleSettings(kind, opts, 16 / 9, t0, 10, true), kind)
      for (const n of [1, 3]) expect(vertices(idleSettings(kind, opts, 16 / 9, t0 + n * 10, 10, true), kind)).not.toBe(a)
    }
  })

  it('a new network every run, from a seed of its own, and the same one within a run', () => {
    const s = (t: number) => idleSettings('pipes', opts, 16 / 9, t, 10, true)
    const speed = s(1).time
    const runReal = ENDLESS_RUN_SECONDS / speed
    expect(runSeed(s(1), 0.4)).toBe(runSeed(s(1 + runReal * 0.1), 0.4))
    expect(runSeed(s(1), 0.4)).not.toBe(runSeed(s(1 + runReal), 0.4))
    // Loop runs are all the seed's.
    expect(runSeed(idleSettings('pipes', opts, 16 / 9, 1, 10), 0.4)).toBe(opts.seed)
  })

  it('years into the run, a growing saver replays only its own run', () => {
    for (const kind of ['pipes', 'maze'] as const) {
      const s = idleSettings(kind, opts, 16 / 9, LATE, 10, true)
      expect(s.time).toBeGreaterThan(1e7)
      for (const start of [0.4, 0.5]) {
        const run = runTime(s, start)
        expect(run).toBeGreaterThanOrEqual(0)
        expect(run).toBeLessThan(ENDLESS_RUN_SECONDS)
      }
    }
  })
})
