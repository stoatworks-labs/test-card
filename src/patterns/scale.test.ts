import { describe, expect, it } from 'vitest'
import { formatDistance, formatLength, MM_PER_INCH, resolvePitch, rulerTicks } from './scale'
import { loopTiming, phase, wholeCycles, frameTime } from './loop'
import { DEFAULT_SETTINGS } from '../state/defaults'
import type { Output } from '../types'

const scale = DEFAULT_SETTINGS.scale

function output(patch: Partial<Output> = {}): Output {
  return {
    id: 'o',
    name: 'Wall',
    widthPx: 1920,
    heightPx: 1080,
    rasterSource: 'manual',
    source: 'manual',
    regions: [],
    notes: [],
    enabled: true,
    ...patch,
  }
}

describe('resolvePitch', () => {
  it('uses the output’s own pitch when it has one', () => {
    expect(resolvePitch(output({ pitchMm: 3.9 }), scale)).toEqual({ pitchMm: 3.9, assumed: false })
  })

  it('falls back, and says it did, when the output has none', () => {
    expect(resolvePitch(output(), { ...scale, pitchMm: 2.6 })).toEqual({ pitchMm: 2.6, assumed: true })
  })

  it('treats a nonsense pitch as no pitch rather than drawing a 0 mm banana', () => {
    expect(resolvePitch(output({ pitchMm: 0 }), scale).assumed).toBe(true)
    expect(resolvePitch(output({ pitchMm: Number.NaN }), scale).assumed).toBe(true)
  })
})

describe('rulerTicks', () => {
  const spec = { lengthPx: 1920, mmPerPx: 2.5, startMm: 0, direction: 1 as const, units: 'metric' as const }

  it('puts every tick on the pixel whose centre is nearest, never more than half a pitch out', () => {
    const { ticks } = rulerTicks(spec)
    for (const t of ticks) {
      const centre = (t.px + 0.5) * spec.mmPerPx
      expect(Math.abs(centre - t.mm)).toBeLessThanOrEqual(spec.mmPerPx / 2 + 1e-9)
    }
  })

  it('lands round distances on the right pixel at a pitch that divides them', () => {
    const { ticks } = rulerTicks(spec)
    // 1 m at 2.5 mm is 400 px: pixel 400 starts at exactly 1000 mm.
    expect(ticks.find((t) => t.mm === 1000)?.px).toBe(400)
    expect(ticks.find((t) => t.mm === 0)?.px).toBe(0)
  })

  it('only draws ticks it has room for, and labels at a readable spacing', () => {
    const { stepMm, labelStepMm, ticks } = rulerTicks(spec)
    expect(stepMm / spec.mmPerPx).toBeGreaterThanOrEqual(4)
    expect(labelStepMm / spec.mmPerPx).toBeGreaterThanOrEqual(80)
    expect(ticks.filter((t) => t.label).every((t) => Math.abs(t.mm / labelStepMm - Math.round(t.mm / labelStepMm)) < 1e-9)).toBe(true)
  })

  it('reads upwards from the floor on a vertical ruler', () => {
    // 1080 px at 2.5 mm is 2.7 m; the surface's bottom edge is 1 m off the floor.
    const { ticks } = rulerTicks({ lengthPx: 1080, mmPerPx: 2.5, startMm: 1000 + 2700, direction: -1, units: 'metric' })
    expect(ticks.find((t) => t.mm === 1000)?.px).toBe(1079)
    expect(ticks.find((t) => t.mm === 2000)?.px).toBe(680)
    expect(ticks.find((t) => t.mm === 3700)?.px).toBe(0)
  })

  it('carries on across a spanned surface rather than restarting at 0', () => {
    // The second of two 1920 px outputs starts 4.8 m along the wall.
    const { ticks } = rulerTicks({ ...spec, startMm: 4800 })
    expect(ticks.some((t) => t.mm === 0)).toBe(false)
    expect(ticks.find((t) => t.mm === 5000)?.px).toBe(80)
  })

  it('does feet and inches', () => {
    const { ticks } = rulerTicks({ ...spec, units: 'imperial' })
    const foot = ticks.find((t) => Math.abs(t.mm - 12 * MM_PER_INCH) < 1e-6)
    expect(foot?.px).toBe(Math.floor((12 * MM_PER_INCH) / 2.5))
    expect(ticks.filter((t) => t.label).map((t) => t.label)).toContain('1′')
  })
})

describe('formatting', () => {
  it('keeps one unit along a ruler, chosen by the label spacing', () => {
    expect([500, 1000, 1500].map((v) => formatDistance(v, 'metric', 500))).toEqual(['0.5 m', '1 m', '1.5 m'])
    expect([100, 1000, 1100].map((v) => formatDistance(v, 'metric', 100))).toEqual(['10 cm', '100 cm', '110 cm'])
    expect(formatDistance(0, 'metric', 100)).toBe('0')
  })

  it('formats captions', () => {
    expect(formatLength(4800, 'metric')).toBe('4.80 m')
    expect(formatLength(190, 'metric')).toBe('19 cm')
    expect(formatLength(4800, 'imperial')).toBe('15′ 9″')
  })
})

describe('loop timing', () => {
  it('fits whole frames and reports the exact length they cover', () => {
    expect(loopTiming({ seconds: 10, fps: '30' })).toEqual({ frames: 300, fpsNum: 30, fpsDen: 1, seconds: 10 })
    const ntsc = loopTiming({ seconds: 10, fps: '29.97' })
    expect(ntsc.frames).toBe(300)
    expect(ntsc.seconds).toBeCloseTo(10.01, 9)
  })

  it('puts frame N exactly where frame 0 is', () => {
    const t = loopTiming({ seconds: 7, fps: '59.94' })
    expect(phase(frameTime(t.frames, t), t.seconds, 3)).toBeCloseTo(0, 9)
    expect(phase(frameTime(0, t), t.seconds, 3)).toBe(0)
  })

  it('never asks something to do zero cycles', () => {
    expect(wholeCycles(0.2)).toBe(1)
    expect(wholeCycles(3.6)).toBe(4)
  })
})
