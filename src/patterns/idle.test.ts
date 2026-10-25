import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../state/defaults'
import type { IdleKind, IdleLook, PatternSettings } from '../types'
import { buildIdleScene, IDLE_AS_IT_RAN, IDLE_KINDS, idleSettings, isIdle } from './idle'
import { fit, fitSpread, orbit, runTime } from './idle/common'
import { cropProjection } from './idle/gl'
import { mat4Mul, mat4Perspective, type M4 } from './idle/maths'
import type { Mesh } from './idle/scene'
import { isAnimated } from './env'
import { canvasRange, PATTERN_LABELS, spansSurface } from './render'
import { PATTERN_SLUGS } from '../lib/export'

const S = DEFAULT_SETTINGS

function opts(kind: IdleKind, patch: Partial<IdleLook> = {}): PatternSettings['idle'] {
  return { ...S.idle, looks: { ...S.idle.looks, [kind]: { ...IDLE_AS_IT_RAN[kind], ...patch } } }
}

function scene(kind: IdleKind, t: number, loop: number, patch: Partial<IdleLook> = {}, aspect = 16 / 9) {
  return buildIdleScene(kind, idleSettings(kind, opts(kind, patch), aspect, t, loop))
}

/** The biggest difference between two meshes, or Infinity if they are not the same shape. */
function meshDiff(a: Mesh, b: Mesh): number {
  let worst = 0
  for (const f of ['px', 'py', 'pz', 'nx', 'ny', 'nz', 'cr', 'cg', 'cb', 'ca', 'indices'] as const) {
    if (a[f].length !== b[f].length) return Infinity
    for (let i = 0; i < a[f].length; i++) worst = Math.max(worst, Math.abs(a[f][i]! - b[f][i]!))
  }
  return worst
}

const matDiff = (a: M4, b: M4) => Math.max(...[...a].map((v, i) => Math.abs(v - b[i]!)))

describe('the idle patterns', () => {
  it('are all patterns, with names and file names', () => {
    for (const kind of IDLE_KINDS) {
      expect(isIdle(kind)).toBe(true)
      expect(PATTERN_LABELS[kind]).toBeTruthy()
      expect(PATTERN_SLUGS[kind]).toMatch(/^[a-z0-9]+$/)
      expect(S.idle.looks[kind]).toEqual(IDLE_AS_IT_RAN[kind])
    }
    expect(isIdle('ocean')).toBe(false)
    expect(new Set(IDLE_KINDS.map((k) => PATTERN_SLUGS[k])).size).toBe(IDLE_KINDS.length)
  })

  it('move unless stopped, span the surface, and are artwork for the encoder', () => {
    for (const kind of IDLE_KINDS) {
      expect(isAnimated({ ...S, kind })).toBe(true)
      expect(isAnimated({ ...S, kind, idle: opts(kind, { speed: 0 }) })).toBe(false)
      expect(spansSurface({ ...S, kind })).toBe(true)
      expect(canvasRange({ ...S, kind, levels: 'legal' })).toBe('full')
    }
  })

  // Invariant 8, mesh for mesh: frame N would be frame 0 again, at several
  // speeds and on loops that are not a round number of seconds.
  describe.each(IDLE_KINDS)('%s', (kind) => {
    it.each([
      [10, 0.5],
      [10, 0.3],
      [7.3, 0.8],
      [1001 / 30, 0.5],
    ])('is periodic in a %s s loop at speed %s', (loop, speed) => {
      for (const t of [0, 2.7]) {
        const a = scene(kind, t, loop, { speed })
        const b = scene(kind, t + loop, loop, { speed })
        expect(a.mesh.indices.length).toBeGreaterThan(0)
        expect(meshDiff(a.mesh, b.mesh)).toBeLessThan(1e-6)
        expect(matDiff(a.view, b.view)).toBeLessThan(1e-6)
        expect(a.fade).toBeCloseTo(b.fade, 9)
      }
    })

    it('moves, and holds still when stopped', () => {
      expect(meshDiff(scene(kind, 0, 10).mesh, scene(kind, 1.3, 10).mesh) + matDiff(scene(kind, 0, 10).view, scene(kind, 1.3, 10).view)).toBeGreaterThan(1e-4)
      const still = scene(kind, 0, 10, { speed: 0 })
      expect(meshDiff(still.mesh, scene(kind, 6.1, 10, { speed: 0 }).mesh)).toBe(0)
    })

    it('draws something with every normal a unit vector and nothing off the end', () => {
      const m = scene(kind, 4.2, 10).mesh
      for (let i = 0; i < m.px.length; i++) {
        expect(Math.abs(Math.hypot(m.nx[i]!, m.ny[i]!, m.nz[i]!) - 1)).toBeLessThan(0.02)
        expect(Number.isFinite(m.px[i]! + m.py[i]! + m.pz[i]!)).toBe(true)
      }
      expect(Math.max(...m.indices)).toBeLessThan(m.px.length)
    })
  })

  // Replays a few hundred frames of growth from cold: about 1.2 s on an M4 Max, over
  // vitest's 5 s default on the deploy job's runner (2026-10-25), so it gets its own.
  it('grow the same way whether a frame is reached by playing or by jumping to it', () => {
    for (const kind of ['pipes', 'maze'] as const) {
      // Played: every frame in order up to 6 s. Jumped: 6 s cold, after a frame from another loop.
      let played = scene(kind, 0, 20)
      for (let f = 1; f <= 180; f++) played = scene(kind, f / 30, 20)
      scene(kind, 1, 30, { density: 0.9 })
      const jumped = scene(kind, 6, 20)
      expect(meshDiff(played.mesh, jumped.mesh)).toBe(0)
    }
  }, 30_000)

  it('start each loop well into a run, so the still is not an empty box', () => {
    // The box clears where the run restarts (0.4 of the loop), not at frame 0.
    const before = scene('pipes', 3.95, 10).mesh.indices.length
    const after = scene('pipes', 4.05, 10).mesh.indices.length
    expect(after).toBeLessThan(before)
    expect(scene('pipes', 0, 10).mesh.indices.length).toBeGreaterThan(after)
  })

  it('fade the maze out and back in round its restart, and nowhere else', () => {
    expect(scene('maze', 0, 10).fade).toBe(1)
    expect(scene('maze', 5, 10).fade).toBeCloseTo(0, 9)
    expect(scene('maze', 4.9, 10).fade).toBeGreaterThan(0)
    expect(scene('maze', 4.9, 10).fade).toBeLessThan(1)
    expect(scene('maze', 4.4, 10).fade).toBe(1)
  })

  it('keep every copy of the marquee on screen across the loop seam, however wide the surface', () => {
    // The scroll wraps at the seam. On a surface wider than the repeat, Idler's copies
    // stopped short of the left edge, and the leftmost visible one vanished there.
    for (const aspect of [16 / 9, 32 / 9, (6 * 16) / 9])
      for (const text of ['Hi', 'LIVE', 'Test Card']) {
        const o = { ...S.idle, text }
        const before = buildIdleScene('marquee', idleSettings('marquee', o, aspect, 10 - 1e-7, 10))
        const after = buildIdleScene('marquee', idleSettings('marquee', o, aspect, 0, 10))
        expect(meshDiff(before.mesh, after.mesh), `${text} at ${aspect.toFixed(2)}:1`).toBeLessThan(1e-3)
      }
  })

  it('see more of the scene to the sides on a wider surface, not a closer one', () => {
    const narrow = scene('flowerbox', 1, 10, {}, 16 / 9)
    const wide = scene('flowerbox', 1, 10, {}, 48 / 9)
    expect(wide.proj[5]).toBeCloseTo(narrow.proj[5]!, 6)
    expect(wide.proj[0]).toBeCloseTo(narrow.proj[0]! / 3, 6)
  })
})

describe('the idle clock', () => {
  const clock = { time: 0, period: 10 }

  it('fits a rate to whole cycles per loop, never none, keeping its sign', () => {
    expect(fit(clock, 0.12)).toBeCloseTo(0.1, 12)
    expect(fit(clock, 0.36)).toBeCloseTo(0.4, 12)
    expect(fit(clock, 0.01)).toBeCloseTo(0.1, 12)
    expect(fit(clock, -0.36)).toBeCloseTo(-0.4, 12)
    expect(fit(clock, 0)).toBe(0)
    expect(fit({ time: 0, period: 0 }, 0.123)).toBe(0.123)
  })

  it('spreads by chance so a family of rates stays different, averaging the natural rate', () => {
    expect(fitSpread(clock, 0.13, 0)).toBeCloseTo(0.1, 12)
    expect(fitSpread(clock, 0.13, 0.75)).toBeCloseTo(0.2, 12)
    let total = 0
    for (let i = 0; i < 1000; i++) total += fitSpread(clock, 0.137, (i + 0.5) / 1000)
    expect(total / 1000).toBeCloseTo(0.137, 3)
  })

  it('orbits in whole turns on a long enough loop, and sways on a short one', () => {
    // 0.13 rad/s for 60 s is 1.24 turns: a whole turn per loop.
    expect(orbit({ time: 60, period: 60 }, 0.13)).toBeCloseTo(2 * Math.PI, 9)
    // 0.06 rad/s for 10 s is a tenth of a turn: a sway, back where it started at the end of the loop.
    expect(Math.abs(orbit({ time: 2.5, period: 10 }, 0.06))).toBeCloseTo((0.06 * 10) / (2 * Math.PI), 9)
    expect(orbit({ time: 10, period: 10 }, 0.06)).toBeCloseTo(0, 9)
  })

  it('restarts a run at the chosen point in the loop', () => {
    expect(runTime({ time: 0, period: 10 }, 0.4)).toBeCloseTo(6, 12)
    expect(runTime({ time: 4, period: 10 }, 0.4)).toBeCloseTo(0, 12)
    expect(runTime({ time: 9.99, period: 10 }, 0.4)).toBeCloseTo(5.99, 9)
  })
})

describe('drawing in pieces', () => {
  const full = { width: 3840, height: 2160 }
  const proj = mat4Perspective(1, full.width / full.height, 0.1, 50)

  /** Where a clip-space point lands in a window, in the frame's pixels. */
  function land(m: M4, p: [number, number, number], win: { x: number; y: number; width: number; height: number }) {
    const [x, y, z] = p
    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
    return { x: win.x + ((cx / cw + 1) / 2) * win.width, y: win.y + ((1 - cy / cw) / 2) * win.height }
  }

  it('leaves the whole frame alone', () => {
    expect(matDiff(cropProjection(full, { x: 0, y: 0, ...full }), new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))).toBeLessThan(1e-12)
  })

  it('puts a point at the same pixel of the frame whichever window draws it', () => {
    const whole = { x: 0, y: 0, ...full }
    const piece = { x: 2048, y: 1024, width: 1792, height: 1136 }
    for (const p of [[0.3, -0.2, -3], [-1.1, 0.7, -8], [2, 1, -5]] as [number, number, number][]) {
      const a = land(proj, p, whole)
      const b = land(mat4Mul(cropProjection(full, piece), proj), p, piece)
      expect(b.x).toBeCloseTo(a.x, 2)
      expect(b.y).toBeCloseTo(a.y, 2)
    }
  })
})
