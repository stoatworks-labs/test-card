import { describe, expect, it } from 'vitest'
import { columnRef, gridLines, groupColour, solidColour } from './draw'
import { DEFAULT_SETTINGS } from '../state/defaults'

const grid = DEFAULT_SETTINGS.grid

describe('gridLines', () => {
  it('places a line on both edges in spacing mode', () => {
    const lines = gridLines(1920, { ...grid, mode: 'spacing', spacingPx: 100 }, 'x')
    expect(lines[0]).toBe(0)
    expect(lines[lines.length - 1]).toBe(1920)
  })

  it('adds the far edge when the pitch does not divide the raster', () => {
    // 1080 / 100 leaves 80px, so the last full line is at 1000 and the edge at
    // 1080 must still be drawn — otherwise the bottom of the frame is unmarked.
    const lines = gridLines(1080, { ...grid, mode: 'spacing', spacingPx: 100 }, 'y')
    expect(lines).toContain(1000)
    expect(lines[lines.length - 1]).toBe(1080)
    expect(lines[lines.length - 2]).toBe(1000)
  })

  it('does not duplicate the edge when the pitch divides exactly', () => {
    const lines = gridLines(1920, { ...grid, mode: 'spacing', spacingPx: 240 }, 'x')
    expect(lines).toEqual([0, 240, 480, 720, 960, 1200, 1440, 1680, 1920])
    expect(new Set(lines).size).toBe(lines.length)
  })

  it('lands the last division exactly on the edge, with no rounding drift', () => {
    // 7 divisions of 1920 is 274.28…; naive accumulation would end at 1919 or
    // 1921 and leave a visibly narrow last column.
    const lines = gridLines(1920, { ...grid, mode: 'divisions', divisionsX: 7 }, 'x')
    expect(lines).toHaveLength(8)
    expect(lines[0]).toBe(0)
    expect(lines[7]).toBe(1920)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]! - lines[i - 1]!).toBeGreaterThan(0)
    }
  })

  it('centres the grid when asked, and still marks both edges', () => {
    const lines = gridLines(1000, { ...grid, mode: 'spacing', spacingPx: 300, originCentre: true }, 'x')
    expect(lines).toContain(500)
    expect(lines[0]).toBe(0)
    expect(lines[lines.length - 1]).toBe(1000)
  })

  it('never returns a spacing of zero, whatever is typed', () => {
    const lines = gridLines(100, { ...grid, mode: 'spacing', spacingPx: 0 }, 'x')
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.length).toBeLessThanOrEqual(102)
  })
})

describe('columnRef', () => {
  it('counts A..Z then rolls over like a spreadsheet', () => {
    expect(columnRef(0)).toBe('A')
    expect(columnRef(25)).toBe('Z')
    expect(columnRef(26)).toBe('AA')
    expect(columnRef(27)).toBe('AB')
    expect(columnRef(51)).toBe('AZ')
    expect(columnRef(52)).toBe('BA')
  })
})

describe('groupColour', () => {
  it('gives every group a distinct hue', () => {
    const colours = Array.from({ length: 8 }, (_, i) => groupColour(i, 8))
    expect(new Set(colours).size).toBe(8)
  })

  it('is stable for the same index and total', () => {
    expect(groupColour(3, 8)).toBe(groupColour(3, 8))
  })
})

describe('solidColour', () => {
  it('renders full-scale fields at the top of the chosen range', () => {
    expect(solidColour({ field: 'white', custom: '', levelPct: 100 }, 'full')).toBe(
      'rgb(255, 255, 255)',
    )
    expect(solidColour({ field: 'white', custom: '', levelPct: 100 }, 'legal')).toBe(
      'rgb(235, 235, 235)',
    )
    expect(solidColour({ field: 'red', custom: '', levelPct: 100 }, 'full')).toBe('rgb(255, 0, 0)')
  })

  it('scales by level percentage', () => {
    expect(solidColour({ field: 'white', custom: '', levelPct: 50 }, 'full')).toBe(
      'rgb(128, 128, 128)',
    )
  })

  it('passes a custom colour through untouched', () => {
    expect(solidColour({ field: 'custom', custom: '#ff8800', levelPct: 100 }, 'legal')).toBe(
      '#ff8800',
    )
  })
})
