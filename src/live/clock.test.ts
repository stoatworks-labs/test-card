import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetClock, unixMs } from './clock'

describe('unixMs', () => {
  let perf = 0
  let wall = 0
  beforeEach(() => {
    _resetClock()
    perf = 5_000.25
    wall = 1_761_300_000_000.8
    vi.spyOn(performance, 'now').mockImplementation(() => perf)
    // Date.now() is whole milliseconds, rounded down.
    vi.spyOn(Date, 'now').mockImplementation(() => Math.floor(wall))
  })
  afterEach(() => vi.restoreAllMocks())
  const tick = (ms: number) => {
    perf += ms
    wall += ms
  }

  it('runs smoothly on performance.now() between samples', () => {
    const a = unixMs()
    tick(16.6)
    // To the resolution a double has at 1.7e12 ms.
    expect(unixMs() - a).toBeCloseTo(16.6, 3)
  })

  it('closes in on the wall clock to well under a millisecond', () => {
    // A frame a second, as far as sampling goes, at times that fall all over the millisecond.
    for (let i = 0; i < 8; i++) {
      unixMs()
      tick(1000.37)
    }
    expect(Math.abs(unixMs() - wall)).toBeLessThan(0.3)
  })

  it('takes a sleep or a clock step at once, not a millisecond at a time', () => {
    unixMs()
    tick(1000)
    // Asleep for an hour: the wall clock moves, performance.now() doesn't.
    wall += 3_600_000
    tick(1000)
    expect(Math.abs(unixMs() - wall)).toBeLessThan(1)
    // And the clock set back two seconds.
    wall -= 2000
    tick(1000)
    expect(Math.abs(unixMs() - wall)).toBeLessThan(1)
  })

  it('agrees between two pages that started at different times', () => {
    // Page one samples now; page two (a fresh module, here a reset) an hour of sleep later.
    tick(1000)
    const offsetOne = unixMs() - perf
    wall += 3_600_000
    tick(1000)
    const one = unixMs()
    _resetClock()
    const two = unixMs()
    expect(Math.abs(one - two)).toBeLessThan(1)
    expect(Math.abs(offsetOne - (one - perf))).toBeGreaterThan(3_599_000)
  })
})
