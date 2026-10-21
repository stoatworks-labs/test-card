/**
 * The levels check: is this chain full range end to end, and if not, which way
 * round has it gone wrong?
 *
 * A row of near-black squares (codes 2 to 32) on code-0 black, and a row of
 * near-white ones (223 to 253) on code-255 white, each labelled. Drawn in full
 * range always, because the question is what the chain does to a full-range
 * picture, which is what a media server plays.
 *
 * What you see tells you which end is doing what:
 *
 *  - Every square in both rows, black black and white white: full range all
 *    the way (or limited at both ends, which also works).
 *  - The squares up to 16 gone into the black and those above 235 into the
 *    white: CRUSHED. The receiving end expects limited range and is stretching
 *    16-235 out to 0-255, so everything outside it clips.
 *  - Every square still there, but the black is grey and the white dull: WASHED
 *    OUT. The sending end has squashed it into 16-235 and nothing stretches it
 *    back. Squares can't vanish in this case, so it's the one you judge by eye.
 *
 * What one picture can't say is which box in a longer chain did it. The notes on
 * the card say how to find out: look at it on a monitor partway along.
 */

import type { LevelsCheckOptions, Rect } from '../types'
import type { Ctx } from './draw'
import { fitTextSize } from './centre'

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** The near-black and near-white ladders, as code values. */
export const BLACK_LADDER = Array.from({ length: 16 }, (_, i) => 2 + i * 2)
export const WHITE_LADDER = Array.from({ length: 16 }, (_, i) => 223 + i * 2)
/** Where limited range starts and ends. */
export const LIMITED_BLACK = 16
export const LIMITED_WHITE = 235

export type Square = Rect & { code: number }

export type LevelsLayout = {
  /** The black field and the white field. */
  blackField: Rect
  whiteField: Rect
  /** The grey band between them, where the notes go. */
  notes: Rect
  blacks: Square[]
  whites: Square[]
  /** Square size and the label size under it. */
  square: number
  label: number
}

export function levelsLayout(w: number, h: number): LevelsLayout {
  const top = Math.round(h * 0.38)
  const bottom = Math.round(h * 0.62)
  const square = Math.max(1, Math.floor(Math.min(w / 19, h * 0.16)))
  const gap = Math.round(square * 0.18)
  const rowW = square * 16 + gap * 15
  const x0 = Math.round((w - rowW) / 2)
  const row = (codes: number[], y: number): Square[] =>
    codes.map((code, i) => ({ x: x0 + i * (square + gap), y, width: square, height: square, code }))
  const label = Math.max(1, Math.round(square * 0.3))
  // Each row sits in the middle of its field, with room under it for the labels.
  const blackY = Math.round((top - square - label * 1.6) / 2)
  const whiteY = bottom + Math.round((h - bottom - square - label * 1.6) / 2)
  return {
    blackField: { x: 0, y: 0, width: w, height: top },
    whiteField: { x: 0, y: bottom, width: w, height: h - bottom },
    notes: { x: 0, y: top, width: w, height: bottom - top },
    blacks: row(BLACK_LADDER, blackY),
    whites: row(WHITE_LADDER, whiteY),
    square,
    label,
  }
}

const NOTES = [
  'Every square in both rows, black is black and white is white: full range end to end.',
  'Squares up to 16 gone black and above 235 gone white: CRUSHED. The receiving end expects limited and is stretching it. Set its input to full, or the sender to limited.',
  'Every square there but black is grey and white is dull: WASHED OUT. The sending end is squashing to limited. Set its output to full, or the receiver to limited.',
  'Which box? Look at this on a monitor partway along the chain: the fault is between the last place it looks right and the first place it looks wrong.',
]

const grey = (code: number) => `rgb(${code}, ${code}, ${code})`

export function drawLevelsCheck(ctx: Ctx, w: number, h: number, opts: LevelsCheckOptions) {
  const L = levelsLayout(w, h)
  ctx.fillStyle = grey(0)
  ctx.fillRect(L.blackField.x, L.blackField.y, L.blackField.width, L.blackField.height)
  ctx.fillStyle = grey(255)
  ctx.fillRect(L.whiteField.x, L.whiteField.y, L.whiteField.width, L.whiteField.height)
  ctx.fillStyle = grey(128)
  ctx.fillRect(L.notes.x, L.notes.y, L.notes.width, L.notes.height)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const labels = L.label >= 7
  const ladder = (squares: Square[], limit: number, ink: string, mark: string) => {
    for (const s of squares) {
      ctx.fillStyle = grey(s.code)
      ctx.fillRect(s.x, s.y, s.width, s.height)
      if (!labels) continue
      const isLimit = s.code === limit
      ctx.font = `${isLimit ? 700 : 400} ${L.label}px ${SANS}`
      ctx.fillStyle = isLimit ? mark : ink
      ctx.fillText(String(s.code), s.x + s.width / 2, s.y + s.height + L.label * 0.3)
    }
  }
  // Labels a code-128 grey either side, so they read on both fields; the limited-range edge in colour.
  ladder(L.blacks, LIMITED_BLACK, grey(128), '#ffb020')
  ladder(L.whites, LIMITED_WHITE, grey(128), '#c06000')

  if (!opts.notes) return
  const pad = Math.round(L.notes.height * 0.08)
  const box = { x: L.notes.x + pad * 2, y: L.notes.y + pad, width: L.notes.width - pad * 4, height: L.notes.height - pad * 2 }
  const lines = ['Levels check: full or limited range?', ...NOTES]
  const size = fitTextSize(lines, box.width, box.height, (line, s) => {
    ctx.font = `${s}px ${SANS}`
    return ctx.measureText(line).width
  })
  if (size < 9) return
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  const lineH = size * 1.2
  const y0 = box.y + (box.height - lineH * lines.length) / 2
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? 700 : 400} ${size}px ${SANS}`
    ctx.fillStyle = i === 0 ? '#ffffff' : '#101010'
    ctx.fillText(line, box.x, y0 + i * lineH)
  })
}
