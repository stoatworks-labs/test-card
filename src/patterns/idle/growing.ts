/**
 * The two savers that grow, 3D Pipes and 3D Maze: a port of Idler's, which are
 * made pure by deterministic replay — the state at time t is DEFINED as the
 * state reached by replaying from the seed to tick floor(t * tickRate).
 *
 * Replay is what Idler does; the loop is what Test Card adds. Where a pipe goes
 * next depends on where it has been, so no fitting of rates makes this periodic.
 * Instead each loop is one run from the seed (`runTime`), restarting once a
 * loop: the same pipes grow the same way every time round, and frame N is frame
 * 0 because both are the same instant of the same run. Pipes clears the
 * box when it restarts, as the original did when it filled up. The maze walk
 * fades out and back in, because jumping from one corridor to another reads as
 * a broken file rather than a new maze.
 */

import { countFromDensity, orbit, runTime, settingsColour, type IdleSettings, type Saver } from './common'
import {
  add3,
  hash2,
  hash3,
  hsvToRgb,
  length3,
  lerp3,
  mat4AlignZTo,
  mat4LookAt,
  mat4Mul,
  mat4Perspective,
  mat4Translate,
  PI,
  Random,
  sub3,
  unit,
  v3,
  v4,
  type V3,
  type V4,
} from './maths'
import { Shading, type Mesh, type Scene } from './scene'
import { addTeapot } from './solids'

/**
 * The replay, the cache and the invalidation, in one place so neither saver can
 * get "the cache must not change the answer" wrong in its own way.
 */
abstract class GrowingSaver implements Saver {
  protected rng = new Random(1)
  private cachedKey = ''
  private cachedTick = -1

  /** The ceiling on one frame's replay. A loop is at most 600 s at 4x, far below it. */
  static readonly MAX_REPLAY_STEPS = 400_000

  abstract tickRate(s: IdleSettings): number
  /** Only what growth reads: nudging a colour must not rebuild the network. */
  abstract growthKey(s: IdleSettings): string
  abstract resetState(s: IdleSettings, rng: Random): void
  abstract step(s: IdleSettings, rng: Random): void
  abstract draw(s: IdleSettings, alpha: number, run: number, scene: Scene): void
  /** Where in the loop the run restarts, 0..1. */
  abstract readonly restartAt: number

  build(s: IdleSettings, scene: Scene) {
    const rate = Math.max(0.01, this.tickRate(s))
    const run = runTime(s, this.restartAt)
    const exact = Math.min(Math.max(0, run) * rate, GrowingSaver.MAX_REPLAY_STEPS)
    const wanted = Math.trunc(exact)
    const alpha = exact - Math.floor(exact)
    const key = this.growthKey(s)

    // Used ONLY to skip forward within one growth key; anything else starts again.
    if (this.cachedTick < 0 || key !== this.cachedKey || wanted < this.cachedTick) {
      this.rng.reset(s.seed)
      this.resetState(s, this.rng)
      this.cachedKey = key
      this.cachedTick = 0
    }
    while (this.cachedTick < wanted) {
      this.step(s, this.rng)
      this.cachedTick += 1
    }
    this.draw(s, alpha, run, scene)
  }
}

// ---------------------------------------------------------------------------
// 3D Pipes
// ---------------------------------------------------------------------------

/** Cells of travel per second. A tick is one cell: the smallest thing that can happen. */
const PIPES_TICK_RATE = 7
/** The six directions, in opposing pairs: the reverse of d is d ^ 1. */
const PIPE_DIRECTIONS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const
const PIPE_BOX = 2

type Cell = { x: number; y: number; z: number }
type Pipe = { path: Cell[]; direction: number; colour: V3; alive: boolean }

/**
 * Plumbing growing into a box one elbow at a time until it fills and starts
 * again — and, here, until the loop wraps. Every so often a joint comes out as a
 * teapot, chosen by hash so it lands in the same place on every replay.
 *
 * Density = pipes at once. Complexity = the grid. Size = pipe radius. Length =
 * how full the box gets before it clears. Variation = how often a pipe turns.
 */
export class Pipes extends GrowingSaver {
  readonly restartAt = 0.4
  private occupied = new Uint8Array(0)
  private pipes: Pipe[] = []
  private grid = 10
  private placed = 0

  tickRate() {
    return PIPES_TICK_RATE
  }

  growthKey(s: IdleSettings) {
    return [s.seed, countFromDensity(s.density, 1, 5), Pipes.gridSize(s), Math.trunc(s.length * 255), Math.trunc(s.variation * 255)].join(':')
  }

  resetState(s: IdleSettings, rng: Random) {
    this.grid = Pipes.gridSize(s)
    this.occupied = new Uint8Array(this.grid ** 3)
    this.pipes = []
    this.placed = 0
    const count = countFromDensity(s.density, 1, 5)
    for (let i = 0; i < count; i++) this.startPipe(rng)
  }

  step(s: IdleSettings, rng: Random) {
    const turnChance = 0.08 + s.variation * 0.5
    // The original stopped while there was still space, which keeps the shape readable.
    const capacity = Math.trunc(this.occupied.length * (0.12 + s.length * 0.5))
    let anyAlive = false
    for (const pipe of this.pipes) {
      if (!pipe.alive) continue
      const head = pipe.path[pipe.path.length - 1]!
      let direction = pipe.direction
      if (rng.unit01() < turnChance || !this.free(Pipes.advance(head, direction))) {
        direction = this.chooseDirection(head, pipe.direction, rng)
      }
      if (direction < 0) {
        pipe.alive = false
        continue
      }
      const next = Pipes.advance(head, direction)
      this.occupy(next)
      pipe.path.push(next)
      pipe.direction = direction
      this.placed += 1
      anyAlive = true
    }
    // Clearing is a step, not a special case, so the replay stays a plain loop.
    if (!anyAlive || this.placed >= capacity) this.resetState(s, rng)
  }

  draw(s: IdleSettings, alpha: number, _run: number, scene: Scene) {
    this.setCamera(s, scene)
    const cell = PIPE_BOX / this.grid
    const radius = cell * (0.12 + s.size * 0.3)
    const sides = 8

    this.pipes.forEach((pipe, pipeIndex) => {
      const colour = settingsColour(s, pipe.colour, pipeIndex, this.pipes.length)
      for (let i = 0; i + 1 < pipe.path.length; i++) {
        const from = this.world(pipe.path[i]!, cell)
        let to = this.world(pipe.path[i + 1]!, cell)
        // The growing tip extends across the tick: the only thing that moves smoothly.
        if (pipe.alive && i + 2 === pipe.path.length) to = lerp3(from, to, Math.max(0.02, alpha))
        const along = sub3(to, from)
        scene.mesh.addCylinder(mat4Mul(mat4Translate(from), mat4AlignZTo(along)), radius, length3(along), sides, colour, false, false)
      }
      // A ball on the start, so a pipe does not begin as an open tube.
      if (pipe.path.length > 0) {
        scene.mesh.addSphere(mat4Translate(this.world(pipe.path[0]!, cell)), radius * 1.28, 6, sides, colour)
      }
      // A ball at each CORNER only: one on every cell turns a straight run into beads.
      for (let i = 1; i + 1 < pipe.path.length; i++) {
        const b = pipe.path[i - 1]!
        const h = pipe.path[i]!
        const a = pipe.path[i + 1]!
        if (h.x - b.x === a.x - h.x && h.y - b.y === a.y - h.y && h.z - b.z === a.z - h.z) continue
        const at = this.world(h, cell)
        if (hash3(pipeIndex >>> 0, i >>> 0, s.seed) % 37 === 0) addTeapot(scene.mesh, mat4Translate(at), radius * 2.6, colour)
        else scene.mesh.addSphere(mat4Translate(at), radius * 1.28, 6, sides, colour)
      }
    })
  }

  static gridSize(s: IdleSettings) {
    return 6 + Math.trunc(s.complexity * 12 + 0.5)
  }

  static advance(c: Cell, d: number): Cell {
    const dir = PIPE_DIRECTIONS[d]!
    return { x: c.x + dir[0], y: c.y + dir[1], z: c.z + dir[2] }
  }

  private free(c: Cell) {
    const g = this.grid
    return c.x >= 0 && c.y >= 0 && c.z >= 0 && c.x < g && c.y < g && c.z < g && this.occupied[(c.z * g + c.y) * g + c.x] === 0
  }

  private occupy(c: Cell) {
    this.occupied[(c.z * this.grid + c.y) * this.grid + c.x] = 1
  }

  private world(c: Cell, cell: number): V3 {
    const half = PIPE_BOX * 0.5
    return v3((c.x + 0.5) * cell - half, (c.y + 0.5) * cell - half, (c.z + 0.5) * cell - half)
  }

  /** A free direction out of `from`, never a reversal; -1 when boxed in. */
  private chooseDirection(from: Cell, current: number, rng: Random): number {
    const candidates: number[] = []
    for (let d = 0; d < 6; d++) if (d !== (current ^ 1) && this.free(Pipes.advance(from, d))) candidates.push(d)
    return candidates.length === 0 ? -1 : candidates[rng.below(candidates.length)]!
  }

  /**
   * A bounded number of tries for a free cell. How many numbers it draws depends
   * on the occupancy, which depends only on the replay so far, so a replay and a
   * live run draw the same.
   */
  private startPipe(rng: Random) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const start = { x: rng.below(this.grid), y: rng.below(this.grid), z: rng.below(this.grid) }
      if (!this.free(start)) continue
      this.occupy(start)
      const pipe: Pipe = { path: [start], direction: rng.below(6), colour: v3(1, 1, 1), alive: true }
      // Saturated plastic, as the original: only the hue is drawn.
      pipe.colour = hsvToRgb(rng.unit01(), 0.85, 1)
      // One cell laid at once, so a fresh network has a segment to draw.
      const second = Pipes.advance(start, pipe.direction)
      if (this.free(second)) {
        this.occupy(second)
        pipe.path.push(second)
        this.placed += 1
      }
      this.pipes.push(pipe)
      this.placed += 1
      return
    }
  }

  private setCamera(s: IdleSettings, scene: Scene) {
    scene.depthTest = true
    scene.shading = s.shading
    // A slow orbit, Idler's one change to the original: a sway on a loop too short for half a turn.
    const angle = orbit(s, 0.06)
    const distance = 2.6 + s.camDistance * 4
    const eye = v3(Math.sin(angle) * distance, Math.sin(s.camTilt) * distance, Math.cos(angle) * distance)
    scene.view = mat4LookAt(eye, v3(0, 0, 0), v3(0, 1, 0))
    scene.proj = mat4Perspective(s.fov, Math.max(0.01, s.aspect), 0.05, 40)
    if (s.fog > 0.001) {
      scene.fogStart = distance * (0.4 + (1 - s.fog) * 0.8)
      scene.fogEnd = distance + PIPE_BOX * 1.4
    }
  }
}

// ---------------------------------------------------------------------------
// 3D Maze
// ---------------------------------------------------------------------------

/** Cells per second: a walking pace, and the original's was famously unhurried. */
const MAZE_TICK_RATE = 1.6
/** Built maze kept round the camera, in cells: beyond any draw radius. */
const MAZE_KEEP_RADIUS = 20
/** The furthest the maze is drawn, in cells, with the fog off. */
const MAZE_MAX_DRAW_RADIUS = 14
const MAZE_DOORS_PER_EDGE = 2
/** One dead end in this many survives the braid. */
const MAZE_DEAD_ENDS_KEPT = 6
/** Saver seconds the walk takes to fade out before the restart, and back in after. */
const MAZE_FADE = 0.5

const NORTH = 1 // -Z
const SOUTH = 2 // +Z
const WEST = 4 // -X
const EAST = 8 // +X
const HEADING_DX = [0, 1, 0, -1]
const HEADING_DZ = [-1, 0, 1, 0]
const HEADING_WALL = [NORTH, EAST, SOUTH, WEST]

/** Floor division and remainder that keep going the same way below zero. */
const floorDiv = (a: number, b: number) => Math.floor(a / b)
const floorMod = (a: number, b: number) => ((a % b) + b) % b

type Chunk = { cx: number; cz: number; cells: Uint8Array; passes: Uint32Array }

/**
 * A first-person walk down brick corridors. The maze is endless: built in chunks
 * round the camera, each a pure function of its coordinates and the seed, joined
 * by doorways keyed on the shared edge and braided so most dead ends get a way
 * through. The walk takes the least-walked exit, so it explores rather than paces.
 * The bricks are geometry, so a frame spent facing a wall reads as a wall.
 *
 * Complexity = chunk size. Density = how often the walk turns. Size = corridor
 * width against wall height. Fog = how far you see. Variation = wall colour spread.
 */
export class Maze extends GrowingSaver {
  readonly restartAt = 0.5
  private chunks: Chunk[] = []
  private chunkSize = 10
  private seed = 1
  private x = 0
  private z = 0
  private previousX = 0
  private previousZ = 0
  private headingIn = 0
  private headingOut = 0
  private seedForWalls = 0

  tickRate() {
    return MAZE_TICK_RATE
  }

  growthKey(s: IdleSettings) {
    return [s.seed, Maze.chunkSizeOf(s), Math.trunc(s.density * 255)].join(':')
  }

  resetState(s: IdleSettings, rng: Random) {
    this.chunkSize = Maze.chunkSizeOf(s)
    this.seed = s.seed >>> 0
    this.chunks = []
    this.seedForWalls = rng.next()
    this.x = 0
    this.z = 0
    this.headingIn = this.firstOpenHeading(this.x, this.z, rng)
    this.headingOut = this.chooseHeading(this.x, this.z, this.headingIn, 0.3, rng)
    this.previousX = this.x
    this.previousZ = this.z
  }

  /**
   * One cell of travel. Two headings — the one being travelled and the one to
   * leave by — so the camera turns into the next corridor as it arrives, instead
   * of arriving nose to a wall.
   */
  step(s: IdleSettings, rng: Random) {
    this.previousX = this.x
    this.previousZ = this.z
    this.headingIn = this.headingOut
    this.markPass(this.x, this.z, this.headingIn)
    this.x += HEADING_DX[this.headingIn]!
    this.z += HEADING_DZ[this.headingIn]!
    this.headingOut = this.chooseHeading(this.x, this.z, this.headingIn, 0.1 + s.density * 0.6, rng)
    this.forget()
  }

  draw(s: IdleSettings, alpha: number, run: number, scene: Scene) {
    scene.depthTest = true
    scene.shading = s.shading === Shading.Flat ? Shading.Lit : s.shading
    const fadeLength = Math.min(MAZE_FADE, s.period / 8)
    if (s.period > 0 && fadeLength > 0) {
      const edge = Math.min(run, s.period - run) / fadeLength
      scene.fade = edge >= 1 ? 1 : edge * edge * (3 - 2 * edge)
    }

    const cell = 1
    const height = cell * (0.55 + (1 - s.size) * 1.6)
    // The heading swings round only in the back half of a move, eased, so it walks rather than rails.
    const turnProgress = Math.max(0, (alpha - 0.45) / 0.55)
    const ease = turnProgress * turnProgress * (3 - 2 * turnProgress)
    const eye = lerp3(this.cellCentre(this.previousX, this.previousZ, cell), this.cellCentre(this.x, this.z, cell), alpha)
    eye.y = height * 0.5
    let delta = this.headingOut - this.headingIn
    if (delta > 2) delta -= 4
    if (delta < -2) delta += 4
    const angle = (this.headingIn + delta * ease) * (PI * 0.5)
    const forward = v3(Math.sin(angle), 0, -Math.cos(angle))
    scene.view = mat4LookAt(eye, add3(add3(eye, forward), v3(0, Math.sin(s.camTilt), 0)), v3(0, 1, 0))
    scene.proj = mat4Perspective(s.fov, Math.max(0.01, s.aspect), 0.02, 60)
    if (s.fog > 0.001) {
      scene.fogStart = cell * (0.5 + (1 - s.fog) * 5)
      scene.fogEnd = scene.fogStart + cell * (1.5 + (1 - s.fog) * 10)
    }

    const thickness = cell * 0.06
    const half = cell * 0.5
    const radius = Maze.drawRadius(s, scene, cell)
    const reach = (radius + 1) * (radius + 1)
    // Behind the camera, but not the cell it is leaving: the walls beside it are still in shot.
    const behind = -0.8 * cell

    // Each cell draws only its north and west walls, so a shared wall is drawn
    // once; the extra row and column close the far edges.
    for (let dz = -radius; dz <= radius + 1; dz++) {
      for (let dx = -radius; dx <= radius + 1; dx++) {
        if (dx * dx + dz * dz > reach) continue
        const cx = this.x + dx
        const cz = this.z + dz
        const centre = this.cellCentre(cx, cz, cell)
        if ((centre.x - eye.x) * forward.x + (centre.z - eye.z) * forward.z < behind) continue

        const walls = this.walls(cx, cz)
        const shade = 0.72 + unit(hash3(cx >>> 0, cz >>> 0, this.seedForWalls)) * 0.28 * (0.2 + s.variation)
        const fanIndex = floorMod(cx, this.chunkSize) + floorMod(cz, this.chunkSize) * this.chunkSize
        const fanCount = this.chunkSize * this.chunkSize
        const wallColour = settingsColour(s, v3(0.78 * shade, 0.3 * shade, 0.22 * shade), fanIndex, fanCount)
        const mid = v3(centre.x, height * 0.5, centre.z)
        const cellKey = (hash2(cx >>> 0, cz >>> 0) ^ this.seedForWalls) >>> 0

        if (walls & NORTH) {
          Maze.addBrickWall(scene.mesh, v3(mid.x, mid.y, mid.z - half), v3(half, height * 0.5, thickness), true, wallColour, (cellKey ^ 0x11) >>> 0, s.variation)
        }
        if (walls & WEST) {
          Maze.addBrickWall(scene.mesh, v3(mid.x - half, mid.y, mid.z), v3(thickness, height * 0.5, half), false, wallColour, (cellKey ^ 0x22) >>> 0, s.variation)
        }
        if (dx > radius || dz > radius) continue

        const floor = settingsColour(s, v3(0.28 * shade, 0.28 * shade, 0.3 * shade), fanIndex, fanCount)
        scene.mesh.addBox(v3(centre.x, -thickness, centre.z), v3(half, thickness, half), floor)
        const ceiling = settingsColour(s, v3(0.16 * shade, 0.16 * shade, 0.19 * shade), fanIndex, fanCount)
        scene.mesh.addBox(v3(centre.x, height + thickness, centre.z), v3(half, thickness, half), ceiling)
      }
    }
  }

  static chunkSizeOf(s: IdleSettings) {
    return 6 + Math.trunc(s.complexity * 10 + 0.5)
  }

  /** Build and draw no further than the fog lets you see. */
  static drawRadius(s: IdleSettings, scene: Scene, cell: number) {
    const sight = s.fog > 0.001 ? scene.fogEnd : MAZE_MAX_DRAW_RADIUS * cell
    return Math.min(MAZE_MAX_DRAW_RADIUS, Math.max(4, Math.trunc(sight / cell) + 2))
  }

  private cellCentre(cx: number, cz: number, cell: number): V3 {
    return v3((cx + 0.5) * cell, 0, (cz + 0.5) * cell)
  }

  private chunkFor(cx: number, cz: number): Chunk {
    const wantX = floorDiv(cx, this.chunkSize)
    const wantZ = floorDiv(cz, this.chunkSize)
    const found = this.chunks.find((c) => c.cx === wantX && c.cz === wantZ)
    if (found) return found
    const built = this.generate(wantX, wantZ)
    this.chunks.push(built)
    return built
  }

  private indexIn(cx: number, cz: number) {
    return floorMod(cz, this.chunkSize) * this.chunkSize + floorMod(cx, this.chunkSize)
  }

  private walls(cx: number, cz: number) {
    return this.chunkFor(cx, cz).cells[this.indexIn(cx, cz)]!
  }

  private passes(cx: number, cz: number, heading: number) {
    return this.chunkFor(cx, cz).passes[this.indexIn(cx, cz) * 4 + heading]!
  }

  private markPass(cx: number, cz: number, heading: number) {
    const chunk = this.chunkFor(cx, cz)
    const i = this.indexIn(cx, cz) * 4 + heading
    chunk.passes[i] = chunk.passes[i]! + 1
  }

  /** Drop the chunks the walk has left. What goes depends only on where it is, so a replay drops the same. */
  private forget() {
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i]!
      const lowX = c.cx * this.chunkSize
      const lowZ = c.cz * this.chunkSize
      const highX = lowX + this.chunkSize - 1
      const highZ = lowZ + this.chunkSize - 1
      if (
        highX < this.x - MAZE_KEEP_RADIUS ||
        lowX > this.x + MAZE_KEEP_RADIUS ||
        highZ < this.z - MAZE_KEEP_RADIUS ||
        lowZ > this.z + MAZE_KEEP_RADIUS
      ) {
        this.chunks[i] = this.chunks[this.chunks.length - 1]!
        this.chunks.pop()
      }
    }
  }

  /** The doorways through one shared edge, keyed on the EDGE so both sides agree without asking. */
  private edgeDoors(cx: number, cz: number, vertical: boolean): number[] {
    const rng = new Random(hash3(cx >>> 0, cz >>> 0, (this.seed ^ (vertical ? 0x5eed1a17 : 0x5eed2b26)) >>> 0))
    const doors: number[] = []
    for (let i = 0; i < MAZE_DOORS_PER_EDGE; i++) doors.push(rng.below(this.chunkSize))
    return doors
  }

  /**
   * One chunk: a perfect maze by depth-first backtracking, doorways to its four
   * neighbours, then the braid. Its OWN random stream, never the walk's: how many
   * chunks the drawing builds depends on the fog, which must not change the walk.
   */
  private generate(chunkX: number, chunkZ: number): Chunk {
    const side = this.chunkSize
    const total = side * side
    const chunk: Chunk = { cx: chunkX, cz: chunkZ, cells: new Uint8Array(total).fill(NORTH | SOUTH | WEST | EAST), passes: new Uint32Array(total * 4) }
    const cells = chunk.cells
    const rng = new Random(hash3(chunkX >>> 0, chunkZ >>> 0, this.seed))
    const at = (ax: number, az: number) => az * side + ax
    const open = (from: number, to: number, h: number) => {
      cells[from] = cells[from]! & ~HEADING_WALL[h]!
      cells[to] = cells[to]! & ~HEADING_WALL[(h + 2) % 4]!
    }

    const visited = new Uint8Array(total)
    const stack: number[] = []
    let cx = rng.below(side)
    let cz = rng.below(side)
    visited[at(cx, cz)] = 1
    stack.push(at(cx, cz))
    while (stack.length > 0) {
      const here = stack[stack.length - 1]!
      cx = here % side
      cz = Math.trunc(here / side)
      const options: number[] = []
      for (let h = 0; h < 4; h++) {
        const nx = cx + HEADING_DX[h]!
        const nz = cz + HEADING_DZ[h]!
        if (nx < 0 || nz < 0 || nx >= side || nz >= side || visited[at(nx, nz)]) continue
        options.push(h)
      }
      if (options.length === 0) {
        stack.pop()
        continue
      }
      const h = options[rng.below(options.length)]!
      const next = at(cx + HEADING_DX[h]!, cz + HEADING_DZ[h]!)
      open(here, next, h)
      visited[next] = 1
      stack.push(next)
    }

    const knock = (doors: number[], cell: (d: number) => number, wall: number) => {
      for (const d of doors) cells[cell(d)] = cells[cell(d)]! & ~wall
    }
    knock(this.edgeDoors(chunkX, chunkZ, true), (d) => at(0, d), WEST)
    knock(this.edgeDoors(chunkX + 1, chunkZ, true), (d) => at(side - 1, d), EAST)
    knock(this.edgeDoors(chunkX, chunkZ, false), (d) => at(d, 0), NORTH)
    knock(this.edgeDoors(chunkX, chunkZ + 1, false), (d) => at(d, side - 1), SOUTH)

    // The braid: open one more wall on all but one in six of the dead ends.
    for (let bz = 0; bz < side; bz++) {
      for (let bx = 0; bx < side; bx++) {
        const here = at(bx, bz)
        let exits = 0
        for (let h = 0; h < 4; h++) if ((cells[here]! & HEADING_WALL[h]!) === 0) exits += 1
        if (exits !== 1) continue
        if (rng.below(MAZE_DEAD_ENDS_KEPT) === 0) continue
        const options: number[] = []
        for (let h = 0; h < 4; h++) {
          const nx = bx + HEADING_DX[h]!
          const nz = bz + HEADING_DZ[h]!
          if (nx < 0 || nz < 0 || nx >= side || nz >= side) continue
          if ((cells[here]! & HEADING_WALL[h]!) === 0) continue
          options.push(h)
        }
        if (options.length === 0) continue
        const h = options[rng.below(options.length)]!
        open(here, at(bx + HEADING_DX[h]!, bz + HEADING_DZ[h]!), h)
      }
    }
    return chunk
  }

  /**
   * A wall slab with both broad faces laid in running-bond courses of brick,
   * inset by a mortar gap and standing a hair proud of the slab.
   */
  static addBrickWall(mesh: Mesh, centre: V3, halfExtent: V3, alongX: boolean, colour: V4, key: number, variation: number) {
    const COURSES = 6
    const PER_COURSE = 4
    const MORTAR = 0.06
    const faceHalf = alongX ? halfExtent.x : halfExtent.z
    const depth = alongX ? halfExtent.z : halfExtent.x
    mesh.addBox(centre, halfExtent, v4(colour.x * 0.45, colour.y * 0.45, colour.z * 0.5, colour.w))
    const brickHeight = (halfExtent.y * 2) / COURSES
    const brickWidth = (faceHalf * 2) / PER_COURSE
    const proud = depth + 0.0015

    for (let side = 0; side < 2; side++) {
      const offset = side === 0 ? proud : -proud
      const normal = alongX ? v3(0, 0, side === 0 ? 1 : -1) : v3(side === 0 ? 1 : -1, 0, 0)
      for (let course = 0; course < COURSES; course++) {
        const shift = course % 2 === 0 ? 0 : brickWidth * 0.5
        for (let brick = -1; brick <= PER_COURSE; brick++) {
          const u0 = -faceHalf + shift + brick * brickWidth
          const clampedU0 = Math.max(u0, -faceHalf)
          const clampedU1 = Math.min(u0 + brickWidth, faceHalf)
          if (clampedU1 - clampedU0 < brickWidth * 0.15) continue
          const v0 = -halfExtent.y + course * brickHeight
          const a0 = clampedU0 + brickWidth * MORTAR
          const a1 = clampedU1 - brickWidth * MORTAR
          const b0 = v0 + brickHeight * MORTAR
          const b1 = v0 + brickHeight - brickHeight * MORTAR
          if (a1 <= a0 || b1 <= b0) continue
          // Above 1, so a brick is always brighter than the mortar behind it.
          const shade = 1 + unit(hash3(key, course >>> 0, ((brick + 1) * 2 + side) >>> 0)) * (0.1 + variation * 0.5)
          const brickColour = v4(colour.x * shade, colour.y * shade, colour.z * shade, colour.w)
          const corner = (u: number, w: number) =>
            alongX ? v3(centre.x + u, centre.y + w, centre.z + offset) : v3(centre.x + offset, centre.y + w, centre.z + u)
          const base = mesh.mark()
          mesh.addVertex(corner(a0, b0), normal, brickColour)
          mesh.addVertex(corner(a1, b0), normal, brickColour)
          mesh.addVertex(corner(a1, b1), normal, brickColour)
          mesh.addVertex(corner(a0, b1), normal, brickColour)
          mesh.addQuad(base, base + 1, base + 2, base + 3)
        }
      }
    }
  }

  private firstOpenHeading(cx: number, cz: number, rng: Random): number {
    const walls = this.walls(cx, cz)
    const options = [0, 1, 2, 3].filter((h) => (walls & HEADING_WALL[h]!) === 0)
    return options.length === 0 ? 0 : options[rng.below(options.length)]!
  }

  /**
   * Where to go on leaving a cell: never back unless boxed in, and among the
   * exits this walk has used LEAST, so a loop once walked is not walked again.
   * The number of draws must not depend on the branch: a dead end still draws
   * one, and straight-on draws only when it is a candidate, as the C++ does.
   */
  private chooseHeading(cx: number, cz: number, arrived: number, turnBias: number, rng: Random): number {
    const walls = this.walls(cx, cz)
    const reverse = (arrived + 2) % 4
    let options: number[] = []
    let fewest = Infinity
    for (let h = 0; h < 4; h++) {
      if (h === reverse || (walls & HEADING_WALL[h]!) !== 0) continue
      const used = this.passes(cx, cz, h)
      if (used < fewest) {
        fewest = used
        options = []
      }
      if (used === fewest) options.push(h)
    }
    if (options.length === 0) {
      rng.next()
      return reverse
    }
    if (options.includes(arrived) && rng.unit01() >= turnBias) return arrived
    return options[rng.below(options.length)]!
  }
}
