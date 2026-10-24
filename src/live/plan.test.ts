import { describe, expect, it } from 'vitest'
import {
  defaultSources,
  describePlacement,
  liveTime,
  liveUrl,
  parseLiveParams,
  placeRaster,
  sourceFromString,
  sourceToString,
  windowFeatures,
  type Candidate,
  type DisplayRaster,
  type LiveParams,
} from './plan'
import { loopTiming } from '../patterns/loop'

describe('live URL', () => {
  const params: LiveParams = {
    id: 'abc',
    source: { kind: 'output', id: 'screen:2/a b' },
    scaling: 'pixels',
    screenKey: 'DELL U2720Q@2560,0',
    screenLabel: 'DELL U2720Q',
    sound: true,
    muted: true,
  }

  it('round-trips, odd characters and all', () => {
    const url = liveUrl('https://test-card.example/?old=1#x', params)
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/')
    expect(parsed.hash).toBe('')
    expect(parsed.searchParams.has('old')).toBe(false)
    expect(parseLiveParams(parsed.search)).toEqual(params)
  })

  it('leaves the sound off, and unmuted, unless asked', () => {
    const url = liveUrl('https://test-card.example/', { ...params, sound: false, muted: false })
    expect(new URL(url).searchParams.has('sound')).toBe(false)
    expect(new URL(url).searchParams.has('mute')).toBe(false)
    expect(parseLiveParams(new URL(url).search)).toMatchObject({ sound: false, muted: false })
  })

  it('is not a live window without an id, so the editor loads', () => {
    expect(parseLiveParams('')).toBeNull()
    expect(parseLiveParams('?src=composition')).toBeNull()
  })

  it('falls back to the display’s own raster and fit for anything it cannot read', () => {
    const p = parseLiveParams('?live=1&src=nonsense&fit=sideways')
    expect(p?.source).toEqual({ kind: 'display' })
    expect(p?.scaling).toBe('fit')
  })

  it('reads every kind of source back', () => {
    for (const s of [{ kind: 'composition' }, { kind: 'display' }, { kind: 'output', id: 'x:y' }] as const) {
      expect(sourceFromString(sourceToString(s))).toEqual(s)
    }
    expect(sourceFromString('output:')).toBeNull()
  })
})

describe('placeRaster', () => {
  it('is 1:1 at the origin when the sizes match, whichever scaling', () => {
    for (const scaling of ['fit', 'pixels'] as const) {
      expect(placeRaster({ width: 1920, height: 1080 }, { width: 1920, height: 1080 }, scaling)).toEqual({
        scale: 1,
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        cropped: false,
      })
    }
  })

  it('fits a wider raster to the width, centred top to bottom', () => {
    const p = placeRaster({ width: 3840, height: 1080 }, { width: 1920, height: 1080 }, 'fit')
    expect(p.scale).toBe(0.5)
    expect([p.x, p.y, p.width, p.height]).toEqual([0, 270, 1920, 540])
    expect(describePlacement(p)).toBe('scaled 50%')
  })

  it('scales a small raster up to fill the screen', () => {
    const p = placeRaster({ width: 1920, height: 1080 }, { width: 3840, height: 2160 }, 'fit')
    expect(p.scale).toBe(2)
    expect([p.x, p.y, p.width, p.height]).toEqual([0, 0, 3840, 2160])
  })

  it('never scales in pixels mode, and says when the raster does not fit', () => {
    const big = placeRaster({ width: 3840, height: 2160 }, { width: 1920, height: 1080 }, 'pixels')
    expect(big).toMatchObject({ scale: 1, x: 0, y: 0, width: 3840, height: 2160, cropped: true })
    expect(describePlacement(big)).toBe('1:1, cropped')
    const small = placeRaster({ width: 1280, height: 720 }, { width: 1920, height: 1080 }, 'pixels')
    expect(small).toMatchObject({ scale: 1, x: 0, y: 0, cropped: false })
    expect(describePlacement(small)).toBe('1:1')
  })

  it('does not round a near miss to 100%, either way', () => {
    const p = placeRaster({ width: 1920, height: 1080 }, { width: 1918, height: 1200 }, 'fit')
    expect(p.scale).toBeLessThan(1)
    expect(describePlacement(p)).toBe('scaled 99.9%')
    const up = placeRaster({ width: 1918, height: 1080 }, { width: 1920, height: 1200 }, 'fit')
    expect(up.scale).toBeGreaterThan(1)
    expect(describePlacement(up)).toBe('scaled 100.1%')
  })

  it('keeps the drawn raster inside the window', () => {
    for (const [rw, rh, dw, dh] of [
      [1920, 1080, 1366, 768],
      [1080, 1920, 1920, 1080],
      [4096, 2160, 3456, 2234],
      [7, 3, 1001, 997],
    ] as const) {
      const p = placeRaster({ width: rw, height: rh }, { width: dw, height: dh }, 'fit')
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.x + p.width).toBeLessThanOrEqual(dw)
      expect(p.y + p.height).toBeLessThanOrEqual(dh)
      // One side always fills.
      expect(p.width === dw || p.height === dh).toBe(true)
    }
  })
})

describe('liveTime', () => {
  it('stays inside the loop and agrees with itself a loop later', () => {
    const loop = loopTiming({ seconds: 10, fps: '29.97' }).seconds
    const now = 1_761_300_000_123.4
    const t = liveTime(now, loop)
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThan(loop)
    expect(liveTime(now + loop * 1000, loop)).toBeCloseTo(t, 5)
    expect(liveTime(now + 250, loop)).toBeCloseTo((t + 0.25) % loop, 5)
  })

  it('is the same for every window that asks at the same moment', () => {
    expect(liveTime(1_761_300_000_000, 7)).toBe(liveTime(1_761_300_000_000, 7))
  })
})

describe('defaultSources', () => {
  const out = (id: string, width: number, height: number): Candidate => ({ source: { kind: 'output', id }, width, height })
  const disp = (key: string, width: number, height: number, current = false, slack = 0): DisplayRaster => ({
    key,
    width,
    height,
    current,
    slack,
  })

  it('gives each display the output that is its exact size first', () => {
    const got = defaultSources(
      [disp('a', 1920, 1200), disp('b', 1920, 1080)],
      [out('wide', 3840, 1080), out('hd', 1920, 1080), out('wuxga', 1920, 1200)],
    )
    expect(got.get('a')).toEqual({ kind: 'output', id: 'wuxga' })
    expect(got.get('b')).toEqual({ kind: 'output', id: 'hd' })
  })

  it('hands the rest out in order, other displays before the editor’s', () => {
    const got = defaultSources(
      [disp('laptop', 3456, 2234, true), disp('proj', 1920, 1080)],
      [out('one', 1280, 720), out('two', 1280, 720)],
    )
    expect(got.get('proj')).toEqual({ kind: 'output', id: 'one' })
    expect(got.get('laptop')).toEqual({ kind: 'output', id: 'two' })
  })

  it('allows a fractionally scaled display its pixel either way, and no more', () => {
    // 2560 x 1440 at 150% is 1706.67 CSS pixels wide: the browser says 1707, so 2561.
    const got = defaultSources(
      [disp('win', 2561, 1440, false, 2), disp('mac', 2561, 1440)],
      [out('qhd', 2560, 1440), out('qhd2', 2560, 1440)],
    )
    expect(got.get('win')).toEqual({ kind: 'output', id: 'qhd' })
    // The exact display gets the leftover in the second pass, not a match.
    expect(got.get('mac')).toEqual({ kind: 'output', id: 'qhd2' })
    const exact = defaultSources([disp('mac', 2561, 1440), disp('hd', 1920, 1080)], [out('qhd', 2560, 1440), out('hd', 1920, 1080)])
    expect(exact.get('hd')).toEqual({ kind: 'output', id: 'hd' })
    expect(exact.get('mac')).toEqual({ kind: 'output', id: 'qhd' })
  })

  it('matches the display itself when there is nothing left, and never gives one output twice', () => {
    const got = defaultSources([disp('a', 1920, 1080), disp('b', 1920, 1080)], [out('only', 1920, 1080)])
    expect(got.get('a')).toEqual({ kind: 'output', id: 'only' })
    expect(got.get('b')).toEqual({ kind: 'display' })
    expect(defaultSources([disp('a', 1, 1)], []).get('a')).toEqual({ kind: 'display' })
  })
})

describe('windowFeatures', () => {
  it('places the window over the display’s usable area', () => {
    expect(windowFeatures({ left: -1920, top: 25.4, width: 1920, height: 1055 })).toBe(
      'popup,noopener,left=-1920,top=25,width=1920,height=1055',
    )
  })

  it('opens a window anywhere when it does not know the displays', () => {
    expect(windowFeatures()).toBe('popup,noopener,width=960,height=540')
  })
})
