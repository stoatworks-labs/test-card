import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveSound } from './sound'
import { _resetClock } from './clock'

// The live sound runs in a page; here a page is just enough of one.
;(globalThis as { window?: unknown }).window ??= globalThis

/**
 * An audio device whose clock runs `drift` fast against the computer's, starts
 * at an arbitrary time, and plays a sample `latency` seconds after the context
 * reaches it. What a test asks of every pass queued: when it is heard, is the
 * computer's clock at the point in the loop the pass started from?
 */
/** The wall clock at performance.now() = 0. */
const EPOCH_MS = 1_761_300_000_000

function rig({ drift = 50e-6, latency = 0.042, loop = 10, rate = 48000 } = {}) {
  let perfNow = 0
  vi.spyOn(performance, 'now').mockImplementation(() => perfNow)
  vi.spyOn(Date, 'now').mockImplementation(() => EPOCH_MS + perfNow)
  const contextAt = (p: number) => 5 + (p / 1000) * (1 + drift)
  type Source = { started?: [number, number]; stopped?: boolean; connect: () => void; start: (w: number, o: number) => void; stop: () => void; onended: unknown; buffer: unknown }
  const sources: Source[] = []
  const ctx = {
    get currentTime() {
      return contextAt(perfNow)
    },
    outputLatency: latency,
    baseLatency: 0.005,
    destination: {},
    getOutputTimestamp: () => ({ contextTime: contextAt(perfNow) - latency, performanceTime: perfNow }),
    createBuffer: (_c: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, copyToChannel() {} }),
    createBufferSource: () => {
      const s: Source = {
        connect() {},
        start(w, o) {
          s.started = [w, o]
        },
        stop() {
          s.stopped = true
        },
        onended: null,
        buffer: null,
      }
      sources.push(s)
      return s
    },
  } as unknown as AudioContext
  /** The computer's clock, in seconds, when the device plays context time `when`. */
  const heardAt = (when: number) => (EPOCH_MS + ((when + latency - 5) / (1 + drift)) * 1000) / 1000
  const advance = (ms: number, step = 50) => {
    for (let t = 0; t < ms; t += step) {
      perfNow += step
      vi.advanceTimersByTime(step)
    }
  }
  const jump = (ms: number) => {
    perfNow += ms
  }
  const sound = new LiveSound(ctx, { sampleRate: rate, channels: 2, pcm: new Float32Array(loop * rate) }, loop)
  /** Sets the clock to `pos` seconds into a pass of the loop. */
  const atPhase = (pos: number) => {
    const k = Math.ceil(EPOCH_MS / 1000 / loop) + 1
    perfNow = (k * loop + pos) * 1000 - EPOCH_MS
  }
  return { sound, sources, heardAt, advance, jump, loop, atPhase, setNow: (p: number) => (perfNow = p) }
}

/** Where the computer's clock is in the loop, the way a live window's picture works it out. */
const loopPos = (unix: number, loop: number) => ((unix % loop) + loop) % loop

/** How far apart two points in the loop are, either way round. */
const apart = (a: number, b: number, loop: number) => {
  const d = Math.abs(a - b) % loop
  return Math.min(d, loop - d)
}

/**
 * The audio clock is read up to LEAD_S (1.5 s) before a pass starts, and the
 * device drifts in between: 80 ppm over 1.5 s is 0.12 ms. A frame is 17 to 42 ms.
 */
const CLOSE_S = 2e-4

describe('LiveSound', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    _resetClock()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('joins the pass already going at the point the picture is at', () => {
    const r = rig()
    r.setNow(123_456.7)
    r.sound.start()
    const [when, offset] = r.sources[0]!.started!
    expect(apart(loopPos(r.heardAt(when), r.loop), offset, r.loop)).toBeLessThan(CLOSE_S)
    r.sound.stop()
  })

  it('starts every later pass as the computer’s clock reaches it, despite a drifting device', () => {
    const r = rig({ drift: 80e-6 })
    r.setNow(4_000)
    r.sound.start()
    r.advance(65_000)
    const passes = r.sources.slice(1)
    expect(passes.length).toBeGreaterThanOrEqual(6)
    for (const s of passes) {
      const [when, offset] = s.started!
      expect(offset).toBe(0)
      expect(apart(loopPos(r.heardAt(when), r.loop), 0, r.loop)).toBeLessThan(CLOSE_S)
    }
    // Queued ahead of time, never after it was due.
    const starts = passes.map((s) => s.started![0])
    expect(new Set(starts).size).toBe(starts.length)
    r.sound.stop()
  })

  it('catches up mid-pass after a stall rather than playing the pass late', () => {
    const r = rig()
    r.atPhase(5)
    r.sound.start()
    const before = r.sources.length
    // Nothing runs for 7 s: the next pass, due in 5 s and too far off to have
    // been queued, is 2 s late by the time anything looks.
    r.jump(7_000)
    r.advance(300)
    const late = r.sources.slice(before)
    expect(late.length).toBeGreaterThan(0)
    for (const s of late) {
      const [when, offset] = s.started!
      expect(apart(loopPos(r.heardAt(when), r.loop), offset, r.loop)).toBeLessThan(CLOSE_S)
    }
    // It came in about 2 s through, where the picture is.
    expect(late[0]!.started![1]).toBeGreaterThan(1.9)
    r.sound.stop()
  })

  it('stops everything it started, and queues nothing more', () => {
    const r = rig()
    r.sound.start()
    r.advance(12_000)
    r.sound.stop()
    const count = r.sources.length
    expect(r.sources.every((s) => s.stopped)).toBe(true)
    r.advance(30_000)
    expect(r.sources.length).toBe(count)
  })
})
