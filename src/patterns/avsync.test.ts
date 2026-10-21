import { describe, expect, it } from 'vitest'
import { installPath2D, RecordingContext } from '../../test/recording-context'
import { DEFAULT_SETTINGS } from '../state/defaults'
import { beepHz, BEEP_DBFS, drawAvSync, frameAt, framesFromSync, SAMPLE_RATE, SCALE_FRAMES, sweep, syncAudio, syncFrames, syncInterval } from './avsync'
import { isAnimated, plainEnv } from './env'
import { frameTime, loopTiming } from './loop'
import { patternAudio } from './render'

installPath2D()

const RATES = ['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'] as const
const opts = DEFAULT_SETTINGS.avSync

describe('AV sync timing', () => {
  it.each(RATES)('at %s fps has a sync frame a second, evenly spread, none near the wrap', (fps) => {
    const timing = loopTiming({ seconds: 10, fps })
    const syncs = syncFrames(timing, 1)
    expect(syncs).toHaveLength(10)
    const perSecond = timing.fpsNum / timing.fpsDen
    for (let i = 1; i < syncs.length; i++) expect(Math.abs(syncs[i]! - syncs[i - 1]! - perSecond)).toBeLessThanOrEqual(1.5)
    // Half an interval from the start and the end: the file's first moments are quiet.
    expect(syncs[0]!).toBeGreaterThan(perSecond / 2 - 2)
    expect(timing.frames - syncs.at(-1)!).toBeGreaterThan(perSecond / 2 - 2)
  })

  it('spaces them further apart when asked', () => {
    expect(syncFrames(loopTiming({ seconds: 10, fps: '25' }), 2)).toEqual([25, 75, 125, 175, 225])
    expect(syncFrames(loopTiming({ seconds: 3, fps: '25' }), 10)).toHaveLength(1)
  })

  it.each(RATES)('knows which frame is showing at the start of every frame at %s fps', (fps) => {
    const timing = loopTiming({ seconds: 10, fps })
    for (let n = 0; n < timing.frames; n++) expect(frameAt((n * timing.fpsDen) / timing.fpsNum, timing)).toBe(n)
    expect(frameAt(timing.seconds, timing)).toBe(0)
  })

  it('counts frames from the nearest sync frame, round the loop', () => {
    expect(framesFromSync(17, [15, 45], 60)).toBe(2)
    expect(framesFromSync(13, [15, 45], 60)).toBe(-2)
    expect(framesFromSync(58, [15, 45], 60)).toBe(13)
    expect(framesFromSync(2, [55], 60)).toBe(7)
  })

  it('sweeps the hand from the top on a sync frame, a step a frame, round to the next', () => {
    const syncs = [15, 45]
    expect(sweep(15, syncs, 60)).toEqual({ phase: 0, interval: 30 })
    expect(sweep(30, syncs, 60).phase).toBeCloseTo(0.5, 9)
    expect(sweep(5, syncs, 60).phase).toBeCloseTo(20 / 30, 9)
    let last = -1
    for (let n = 15; n < 45; n++) {
      const p = sweep(n, syncs, 60).phase
      expect(p).toBeGreaterThan(last)
      last = p
    }
  })
})

describe('AV sync sound', () => {
  it.each(RATES)('beeps from the first sample of each sync frame at %s fps, for one frame, and is silent between', (fps) => {
    const timing = loopTiming({ seconds: 10, fps })
    const pcm = syncAudio(timing, opts)
    expect(pcm.length).toBe(Math.round(timing.seconds * SAMPLE_RATE))
    const frameSamples = (SAMPLE_RATE * timing.fpsDen) / timing.fpsNum
    const loud = new Set<number>()
    for (const f of syncFrames(timing, 1)) {
      const start = Math.round(f * frameSamples)
      // The first sample is the start of the ramp, at zero; the next is already sounding.
      expect(pcm[start]).toBe(0)
      expect(pcm[start - 1]).toBe(0)
      expect(Math.abs(pcm[start + 2]!)).toBeGreaterThan(0)
      for (let i = 0; i < Math.round(frameSamples); i++) loud.add(start + i)
    }
    let stray = 0
    pcm.forEach((v, i) => {
      if (v !== 0 && !loud.has(i)) stray++
    })
    expect(stray).toBe(0)
  })

  it.each(RATES)('starts each beep on the sample nearest the start of its frame at %s fps, by the loop\'s own clock', (fps) => {
    const timing = loopTiming({ seconds: 10, fps })
    const pcm = syncAudio(timing, opts)
    for (const f of syncFrames(timing, 1)) {
      // frameTime is loop.ts's, not the beep's own arithmetic.
      const start = Math.round(frameTime(f, timing) * SAMPLE_RATE)
      expect(pcm.subarray(start - 50, start + 1).every((v) => v === 0)).toBe(true)
      expect(Math.abs(pcm[start + 2]!)).toBeGreaterThan(0)
    }
  })

  it('holds the pitch to something that can be timed and heard', () => {
    expect(beepHz({ ...opts, toneHz: 0 })).toBe(100)
    expect(beepHz({ ...opts, toneHz: 50000 })).toBe(10000)
    expect(beepHz({ ...opts, toneHz: Number.NaN })).toBe(1000)
    expect(beepHz({ ...opts, toneHz: 1000 })).toBe(1000)
  })

  it('is a 1 kHz tone at -18 dBFS', () => {
    const timing = loopTiming({ seconds: 10, fps: '25' })
    const pcm = syncAudio(timing, opts)
    const peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    expect(20 * Math.log10(peak)).toBeCloseTo(BEEP_DBFS, 1)
    // Zero crossings across the middle of one beep: two per cycle.
    const start = Math.round(syncFrames(timing, 1)[0]! * (SAMPLE_RATE / 25))
    let crossings = 0
    for (let i = start + 100; i < start + 1100; i++) if (Math.sign(pcm[i]!) !== Math.sign(pcm[i + 1]!)) crossings++
    expect(crossings / 2 / (1000 / SAMPLE_RATE)).toBeGreaterThan(950)
    expect(crossings / 2 / (1000 / SAMPLE_RATE)).toBeLessThan(1050)
  })

  it('is part of the AV sync loop and no other', () => {
    expect(isAnimated({ ...DEFAULT_SETTINGS, kind: 'av-sync' })).toBe(true)
    expect(patternAudio({ ...DEFAULT_SETTINGS, kind: 'av-sync' })?.pcm.length).toBeGreaterThan(0)
    expect(patternAudio({ ...DEFAULT_SETTINGS, kind: 'ocean' })).toBeNull()
  })
})

describe('AV sync picture', () => {
  const animation = { ...DEFAULT_SETTINGS.animation, fps: '30' as const, seconds: 10 }
  const timing = loopTiming(animation)
  const syncs = syncFrames(timing, 1)
  const draw = (n: number, w = 1920, h = 1080) => {
    const rec = new RecordingContext()
    drawAvSync(rec.ctx, w, h, opts, animation, DEFAULT_SETTINGS.centre, plainEnv(w, h, { t: n / 30, loopSeconds: timing.seconds }))
    return rec
  }
  const whites = (rec: RecordingContext) => rec.drawn.filter((d) => d.op === 'fillRect' && d.style === '#ffffff').length

  it('flashes on the sync frame and only then', () => {
    expect(whites(draw(syncs[0]!))).toBeGreaterThanOrEqual(2)
    expect(whites(draw(syncs[0]! - 1))).toBeLessThan(2)
    expect(whites(draw(syncs[0]! + 1))).toBeLessThan(2)
  })

  it.each(['29.97', '25', '59.94'] as const)('flashes on exactly the frames the sound beeps on, at %s fps', (fps) => {
    const anim = { ...DEFAULT_SETTINGS.animation, fps, seconds: 10 }
    const tm = loopTiming(anim)
    const pcm = syncAudio(tm, opts)
    const perFrame = (SAMPLE_RATE * tm.fpsDen) / tm.fpsNum
    for (let n = 0; n < tm.frames; n++) {
      const rec = new RecordingContext()
      drawAvSync(rec.ctx, 640, 360, opts, anim, DEFAULT_SETTINGS.centre, plainEnv(640, 360, { t: frameTime(n, tm), loopSeconds: tm.seconds }))
      const flashed = whites(rec) >= 2
      // Does any sound start during this frame?
      const from = Math.round(n * perFrame)
      const beeps = pcm[from]! === 0 && pcm.subarray(from, from + 4).some((v) => v !== 0)
      expect(flashed).toBe(beeps)
    }
  })

  it('says the interval the file really has, not just the setting', () => {
    const tm = loopTiming({ seconds: 17, fps: '25' })
    expect(syncInterval(tm, 7)).toBeCloseTo(8.5, 9)
    const rec = new RecordingContext()
    drawAvSync(rec.ctx, 1920, 1080, { ...opts, everySeconds: 7 }, { ...DEFAULT_SETTINGS.animation, seconds: 17, fps: '25' }, DEFAULT_SETTINGS.centre, plainEnv(1920, 1080, { loopSeconds: tm.seconds }))
    expect(rec.drawn.some((d) => d.op.includes('every 8.5 s'))).toBe(true)
  })

  it('lights the box for how many frames from the sync frame this is', () => {
    for (const d of [-SCALE_FRAMES, -2, 0, 3, SCALE_FRAMES]) {
      const labels = draw(syncs[1]! + d).drawn.filter((x) => x.op.startsWith('text ') && x.style === '#000000').map((x) => x.op.slice(5))
      expect(labels).toEqual([d > 0 ? `+${d}` : d < 0 ? `−${-d}` : '0'])
    }
    const far = draw(syncs[1]! + SCALE_FRAMES + 2).drawn.filter((x) => x.op.startsWith('text ') && x.style === '#000000')
    expect(far).toHaveLength(0)
  })

  it.each([[1920, 1080], [1080, 1920], [3840, 1080], [64, 36]])('balances its saves and asks for nothing a canvas would refuse at %ix%i', (w, h) => {
    const rec = draw(syncs[0]!, w, h)
    expect(rec.bad).toEqual([])
    expect(rec.stack).toHaveLength(0)
  })
})
