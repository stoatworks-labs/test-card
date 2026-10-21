import { describe, expect, it } from 'vitest'
import { RecordingContext } from '../../test/recording-context'
import { DEFAULT_SETTINGS } from '../state/defaults'
import { canvasRange } from './render'
import { BLACK_LADDER, drawLevelsCheck, LIMITED_BLACK, LIMITED_WHITE, levelsLayout, WHITE_LADDER } from './levels'

const SIZES: [number, number][] = [[1920, 1080], [3840, 2160], [1080, 1920], [7680, 1080], [640, 360], [64, 36]]

describe('the levels check', () => {
  it('climbs out of black in steps of 2 to past limited black, and up to white past limited white', () => {
    expect(BLACK_LADDER[0]).toBe(2)
    expect(BLACK_LADDER.at(-1)).toBe(32)
    expect(BLACK_LADDER).toContain(LIMITED_BLACK)
    expect(WHITE_LADDER).toContain(LIMITED_WHITE)
    expect(WHITE_LADDER.at(-1)).toBe(253)
    // Squares either side of each limit, so a stretch shows as some vanishing and some not.
    expect(BLACK_LADDER.filter((c) => c < LIMITED_BLACK).length).toBeGreaterThan(3)
    expect(WHITE_LADDER.filter((c) => c > LIMITED_WHITE).length).toBeGreaterThan(3)
  })

  it.each(SIZES)('keeps each row in its own field, in order, without overlap, at %ix%i', (w, h) => {
    const L = levelsLayout(w, h)
    const inField = (s: { x: number; y: number; width: number; height: number }, f: typeof L.blackField) =>
      s.x >= 0 && s.x + s.width <= w && s.y >= f.y && s.y + s.height <= f.y + f.height
    for (const s of L.blacks) expect(inField(s, L.blackField)).toBe(true)
    for (const s of L.whites) expect(inField(s, L.whiteField)).toBe(true)
    for (const row of [L.blacks, L.whites]) {
      for (let i = 1; i < row.length; i++) expect(row[i]!.x).toBeGreaterThan(row[i - 1]!.x + row[i - 1]!.width - 1)
    }
  })

  it.each(SIZES)('sits both rows against the grey band, away from the corners where the burn-in goes, at %ix%i', (w, h) => {
    const L = levelsLayout(w, h)
    // Below the black row only its labels and a margin; above the white row only a margin.
    const gapAbove = L.notes.y - (L.blacks[0]!.y + L.square)
    expect(gapAbove).toBeGreaterThan(0)
    expect(gapAbove).toBeLessThanOrEqual(L.label * 1.6 + L.square * 0.25 + 1)
    expect(L.whites[0]!.y - (L.notes.y + L.notes.height)).toBeLessThanOrEqual(L.square * 0.25 + 1)
  })

  it('clears the top fifth of an ordinary output, where the default burn-in sits', () => {
    for (const [w, h] of [[1920, 1080], [3840, 2160], [1280, 1024]] as const) {
      for (const s of levelsLayout(w, h).blacks) expect(s.y).toBeGreaterThanOrEqual(h * 0.2)
    }
  })

  it('paints each square the exact code it is labelled with', () => {
    const rec = new RecordingContext()
    drawLevelsCheck(rec.ctx, 1920, 1080, { notes: true })
    const fills = new Set(rec.drawn.filter((d) => d.op === 'fillRect').map((d) => d.style))
    for (const code of [0, ...BLACK_LADDER, ...WHITE_LADDER, 255]) expect(fills.has(`rgb(${code}, ${code}, ${code})`)).toBe(true)
    const labels = rec.drawn.filter((d) => d.op.startsWith('text ')).map((d) => d.op.slice(5))
    for (const code of [...BLACK_LADDER, ...WHITE_LADDER]) expect(labels).toContain(String(code))
  })

  it.each(SIZES)('balances its saves and asks for nothing a canvas would refuse at %ix%i', (w, h) => {
    for (const notes of [true, false]) {
      const rec = new RecordingContext()
      drawLevelsCheck(rec.ctx, w, h, { notes })
      expect(rec.bad).toEqual([])
      expect(rec.stack).toHaveLength(0)
    }
  })

  it('is always full range, whatever the level setting says', () => {
    expect(canvasRange({ ...DEFAULT_SETTINGS, kind: 'levels-check', levels: 'legal' })).toBe('full')
  })
})
