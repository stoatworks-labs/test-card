/**
 * Dancing hamsters, in the spirit of a certain 1998 web page.
 *
 * Original pixel art, generated rather than hand-plotted: a hamster is a
 * union of ellipses (body, ears, arms, feet), the outline is every pixel of
 * that union with an empty neighbour, and the face is painted on top. Posing
 * is then just moving the arms, squashing the body or turning it — which is
 * how four distinct dances come out of one hamster without anybody drawing
 * sixteen frames by hand.
 *
 * A sprite is rows of palette letters; `.` is transparent. Nothing here
 * touches a canvas.
 */

export const SPRITE_SIZE = 20

export const PALETTE: Record<string, string> = {
  k: '#3a2314', // outline
  o: '#e3973f', // fur
  d: '#b86e27', // fur shadow
  l: '#fbe7c6', // belly and muzzle
  p: '#f5a3ad', // ears, nose, paws
  e: '#121212', // eyes
  w: '#ffffff', // eye glint
  c: '#f27c74', // cheeks
}

export type Dance = 'bop' | 'spin' | 'wave' | 'jump'

export const DANCES: Dance[] = ['bop', 'wave', 'spin', 'jump']

/** Frames per dance cycle. Every dance has the same count, so they stay in step. */
export const FRAMES = 4

type Pose = {
  /** Vertical offset of the whole hamster, in sprite pixels (up is negative). */
  lift: number
  /** Horizontal squash of the body, 1 = front-on. */
  sx: number
  /** Vertical squash. */
  sy: number
  /** Arm angles from straight down, radians, left and right. null = paws held in front. */
  arms: [number | null, number | null]
  /** Where the face points: 1 = front, 0 = side, -1 = back. */
  facing: number
  /** Turn the face toward +x (1) or -x (-1) when side-on. */
  turn: 1 | -1
}

const DOWN = null
const UP = 2.25

function pose(dance: Dance, frame: number): Pose {
  const f = frame % FRAMES
  const base: Pose = { lift: 0, sx: 1, sy: 1, arms: [DOWN, DOWN], facing: 1, turn: 1 }
  switch (dance) {
    case 'bop':
      return [
        { ...base, arms: [UP, DOWN] as Pose["arms"] },
        { ...base, lift: 1, sy: 0.94 },
        { ...base, arms: [DOWN, UP] as Pose["arms"] },
        { ...base, lift: 1, sy: 0.94 },
      ][f] as Pose
    case 'wave':
      return [
        { ...base, arms: [DOWN, UP] as Pose["arms"] },
        { ...base, arms: [DOWN, 1.9] as Pose["arms"] },
        { ...base, arms: [DOWN, UP] as Pose["arms"], lift: -1 },
        { ...base, arms: [DOWN, 1.9] as Pose["arms"] },
      ][f] as Pose
    case 'spin':
      return [
        { ...base, arms: [1.4, 1.4] as Pose["arms"] },
        { ...base, sx: 0.78, facing: 0, turn: 1, arms: [1.2, 1.2] as Pose["arms"] },
        { ...base, facing: -1, arms: [1.4, 1.4] as Pose["arms"] },
        { ...base, sx: 0.78, facing: 0, turn: -1, arms: [1.2, 1.2] as Pose["arms"] },
      ][f] as Pose
    case 'jump':
      return [
        { ...base, sy: 0.84, sx: 1.08, lift: 0.8 },
        { ...base, lift: -3, sy: 1.05, sx: 0.95, arms: [UP, UP] as Pose["arms"] },
        { ...base, lift: -4, arms: [2.9, 2.9] as Pose["arms"] },
        { ...base, lift: -1, arms: [1.6, 1.6] as Pose["arms"] },
      ][f] as Pose
  }
}

function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x + 0.5 - cx) / rx
  const dy = (y + 0.5 - cy) / ry
  return dx * dx + dy * dy <= 1
}

/** One frame of one dance, as SPRITE_SIZE rows of palette letters. */
export function hamsterFrame(dance: Dance, frame: number): string[] {
  const N = SPRITE_SIZE
  const p = pose(dance, frame)
  const grid: string[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => '.'))
  const cx = 10
  const cy = 12.2 + p.lift
  const rx = 6.5 * p.sx
  const ry = 6.0 * p.sy
  const bottom = cy + ry

  const fur = (x: number, y: number): boolean => {
    if (inEllipse(x, y, cx, cy, rx, ry)) return true
    // Ears sit on the crown, and slide round when the hamster turns.
    const earDx = 4.3 * p.sx
    const earY = cy - ry * 0.8
    const shift = p.facing === 0 ? p.turn * 1.5 : 0
    if (inEllipse(x, y, cx - earDx + shift, earY, 1.9, 1.7)) return true
    if (inEllipse(x, y, cx + earDx + shift, earY, 1.9, 1.7)) return true
    // Arms: a chain of small ellipses from the shoulder.
    for (const [side, angle] of [
      [-1, p.arms[0]],
      [1, p.arms[1]],
    ] as const) {
      if (angle === null || (p.facing === 0 && side !== p.turn)) continue
      const sxp = cx + side * rx * 0.78
      const syp = cy + ry * 0.1
      for (let t = 0; t <= 1; t += 0.2) {
        const ax = sxp + side * Math.sin(angle) * 4.8 * t
        const ay = syp + Math.cos(angle) * 4.8 * t
        if (inEllipse(x, y, ax, ay, 1.3, 1.3)) return true
      }
    }
    // Feet.
    if (inEllipse(x, y, cx - 3.6 * p.sx, bottom - 0.2, 2.2, 1.2)) return true
    if (inEllipse(x, y, cx + 3.6 * p.sx, bottom - 0.2, 2.2, 1.2)) return true
    return false
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (!fur(x, y)) continue
      const edge = !fur(x - 1, y) || !fur(x + 1, y) || !fur(x, y - 1) || !fur(x, y + 1)
      grid[y]![x] = edge ? 'k' : 'o'
    }
  }

  const set = (x: number, y: number, c: string) => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi < 0 || yi < 0 || xi >= N || yi >= N) return
    if (grid[yi]![xi] === '.' || grid[yi]![xi] === 'k') return
    grid[yi]![xi] = c
  }

  // Inner ears.
  const earDx = 4.3 * p.sx
  const earY = cy - ry * 0.8
  const shift = p.facing === 0 ? p.turn * 1.5 : 0
  set(cx - earDx + shift - 0.5, earY - 0.3, 'p')
  set(cx + earDx + shift - 0.5, earY - 0.3, 'p')

  // A shadow down the side the light is not on.
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (grid[y]![x] === 'o' && x + 0.5 > cx + rx * 0.55 && inEllipse(x, y, cx, cy, rx, ry)) grid[y]![x] = 'd'
    }
  }

  if (p.facing !== -1) {
    // Belly and muzzle, then the face, shifted toward the way it is turned.
    const fx = cx + (p.facing === 0 ? p.turn * 2.6 : 0)
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (inEllipse(x, y, fx, cy + ry * 0.42, 4.0 * p.sx, 3.6 * p.sy)) set(x, y, 'l')
        if (inEllipse(x, y, fx, cy - 0.2, 2.9, 1.9)) set(x, y, 'l')
      }
    }
    const eyeY = cy - ry * 0.32
    const eyes = p.facing === 0 ? [fx + p.turn * 1.2] : [fx - 2.8, fx + 1.8]
    for (const ex of eyes) {
      set(ex, eyeY, 'e')
      set(ex + 1, eyeY, 'e')
      set(ex, eyeY + 1, 'e')
      set(ex + 1, eyeY + 1, 'e')
      set(ex, eyeY, 'w')
    }
    set(fx - 0.5, cy - 1, 'p')
    set(fx + 0.5, cy - 1, 'p')
    set(fx - 1, cy, 'k')
    set(fx + 1, cy, 'k')
    if (p.facing === 1) {
      set(fx - 4.4, cy - 0.3, 'c')
      set(fx + 4.4, cy - 0.3, 'c')
    }
  } else {
    // From behind: a stubby tail.
    set(cx - 0.5, bottom - 2.5, 'd')
    set(cx + 0.5, bottom - 2.5, 'd')
  }

  // Pink paws at the ends of the arms, and pink toes.
  for (const [side, angle] of [
    [-1, p.arms[0]],
    [1, p.arms[1]],
  ] as const) {
    if (p.facing === 0 && side !== p.turn) continue
    if (angle === null) {
      // Paws together in front of the chest, the way hamsters hold food.
      if (p.facing === 1) {
        set(cx + side * 1.6 - 0.5, cy + 1.6, 'p')
        set(cx + side * 1.6 - 0.5, cy + 2.4, 'p')
      }
      continue
    }
    set(cx + side * rx * 0.78 + side * Math.sin(angle) * 4.8 - 0.5, cy + ry * 0.1 + Math.cos(angle) * 4.8 - 0.5, 'p')
  }
  set(cx - 3.6 * p.sx - 0.5, bottom - 0.5, 'p')
  set(cx + 3.6 * p.sx - 0.5, bottom - 0.5, 'p')

  return grid.map((row) => row.join(''))
}
