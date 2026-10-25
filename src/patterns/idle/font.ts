/**
 * The vector letterforms Scrolling Marquee and 3D Text draw: a port of Idler's
 * `Font.cpp`.
 *
 * Two characters to a point, '0'-'9' then 'A'-'F' for 10 to 15, on an 8 x 12
 * grid; a space starts a new stroke. Indexed by `character - 32`. An empty
 * string advances and draws nothing. Lower case folds to small capitals.
 */

import type { V2 } from './maths'

export type Glyph = { strokes: V2[][]; width: number; advance: number }

/** Grid height. Cap height is the full 12, so a capital is exactly 1 tall. */
const GRID_HEIGHT = 12
/** Space either side of a glyph, in grid units. */
const SIDE_BEARING = 3
/** Advance of a space, in grid units. */
const SPACE_ADVANCE = 7
export const SMALL_CAP_SCALE = 0.72

// prettier-ignore
const GLYPHS = [
  /* 32   */ '',
  /* 33 ! */ '4C43 4140',
  /* 34 " */ '3C3A 5C5A',
  /* 35 # */ '303C 505C 1474 1878',
  /* 36 $ */ '8A6C2C0A0826668482602002 4C40',
  /* 37 % */ '008C 0A2C 6082',
  /* 38 & */ '80272A4C6A680301205084',
  /* 39 ' */ '4C4A',
  /* 40 ( */ '6C282460',
  /* 41 ) */ '2C686420',
  /* 42 * */ '266A 2A66 464B',
  /* 43 + */ '1676 4349',
  /* 44 , */ '4220',
  /* 45 - */ '1676',
  /* 46 . */ '3040413130',
  /* 47 / */ '008C',
  /* 48 0 */ '2060828A6C2C0A0220',
  /* 49 1 */ '2A4C40 2060',
  /* 50 2 */ '0A2C6C8A880080',
  /* 51 3 */ '0C8C37678582602002',
  /* 52 4 */ '606C0484',
  /* 53 5 */ '8C0C07578582602002',
  /* 54 6 */ '8A6C2C080220608285672705',
  /* 55 7 */ '0C8C30',
  /* 56 8 */ '27090B2C6C8B896727 2705022060828567',
  /* 57 9 */ '022060848A6C2C0A07256587',
  /* 58 : */ '4847 4241',
  /* 59 ; */ '4847 4220',
  /* 60 < */ '8A0682',
  /* 61 = */ '1474 1878',
  /* 62 > */ '0A8602',
  /* 63 ? */ '0A2C6C8A884543 4140',
  /* 64 @ */ '2060828A6C2C0A0220 3646',
  /* 65 A */ '004C80 2464',
  /* 66 B */ '000C 0C5C7A785606 066684826000',
  /* 67 C */ '8A6C2C0A02206082',
  /* 68 D */ '000C 0C4C8A824000',
  /* 69 E */ '80000C8C 0656',
  /* 70 F */ '000C8C 0656',
  /* 71 G */ '8A6C2C0A022060828656',
  /* 72 H */ '000C 808C 0686',
  /* 73 I */ '404C',
  /* 74 J */ '6C62402002',
  /* 75 K */ '000C 8C0580',
  /* 76 L */ '0C0080',
  /* 77 M */ '000C468C80',
  /* 78 N */ '000C808C',
  /* 79 O */ '2060828A6C2C0A0220',
  /* 80 P */ '000C 0C6C8A886606',
  /* 81 Q */ '2060828A6C2C0A0220 5380',
  /* 82 R */ '000C 0C6C8A886606 4680',
  /* 83 S */ '8A6C2C0A0826668482602002',
  /* 84 T */ '0C8C 4C40',
  /* 85 U */ '0C022060828C',
  /* 86 V */ '0C408C',
  /* 87 W */ '0C2047608C',
  /* 88 X */ '008C 0C80',
  /* 89 Y */ '0C468C 4640',
  /* 90 Z */ '0C8C0080',
  /* 91 [ */ '6C2C2060',
  /* 92 \ */ '0C80',
  /* 93 ] */ '2C6C6020',
  /* 94 ^ */ '284C68',
  /* 95 _ */ '0080',
]

const FIRST_GLYPH = 32

function hexValue(c: string | undefined): number {
  if (c === undefined) return -1
  if (c >= '0' && c <= '9') return c.charCodeAt(0) - 48
  if (c >= 'A' && c <= 'F') return 10 + c.charCodeAt(0) - 65
  return -1
}

function decodeGlyph(encoded: string): Glyph {
  const strokes: V2[][] = []
  let current: V2[] = []
  let maxX = 0
  for (let p = 0; p < encoded.length; ) {
    if (encoded[p] === ' ') {
      // A one-point stroke draws nothing and is a typo in the table.
      if (current.length >= 2) strokes.push(current)
      current = []
      p += 1
      continue
    }
    const x = hexValue(encoded[p])
    const y = hexValue(encoded[p + 1])
    if (x < 0 || y < 0) break
    current.push({ x: x / GRID_HEIGHT, y: y / GRID_HEIGHT })
    maxX = Math.max(maxX, x)
    p += 2
  }
  if (current.length >= 2) strokes.push(current)
  // Measured off the strokes, so a glyph and its advance cannot drift apart.
  const advance = (strokes.length === 0 ? SPACE_ADVANCE : maxX + SIDE_BEARING) / GRID_HEIGHT
  return { strokes, width: maxX / GRID_HEIGHT, advance }
}

const EMPTY_GLYPH: Glyph = { strokes: [], width: 0, advance: SPACE_ADVANCE / GRID_HEIGHT }

const GLYPH_TABLE: Glyph[] = (() => {
  const table = new Array<Glyph>(128).fill(EMPTY_GLYPH)
  GLYPHS.forEach((g, i) => {
    if (FIRST_GLYPH + i < 128) table[FIRST_GLYPH + i] = decodeGlyph(g)
  })
  return table
})()

export function getGlyph(c: string): Glyph {
  const code = c.charCodeAt(0)
  if (code >= 128) return EMPTY_GLYPH
  const folded = code >= 97 && code <= 122 ? code - 97 + 65 : code
  if (folded < FIRST_GLYPH) return EMPTY_GLYPH
  return GLYPH_TABLE[folded] ?? EMPTY_GLYPH
}

export const isSmall = (c: string): boolean => c >= 'a' && c <= 'z'

/** Width of a string, in cap heights. */
export function measureText(text: string): number {
  let total = 0
  for (const c of text) total += getGlyph(c).advance * (isSmall(c) ? SMALL_CAP_SCALE : 1)
  return total
}
