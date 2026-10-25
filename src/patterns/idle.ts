/**
 * The idle patterns: the Windows 95/98 screensavers, from Idler
 * (~/Projects/resolume/idler), Allan's Resolume generator of them.
 *
 * The savers themselves are under `idle/` — a port of Idler's, with every rate
 * fitted to the loop. This file is what the rest of Test Card sees: each saver
 * as it ran (Idler's first eleven presets), what its controls mean, and the
 * painter that turns one into pixels on a 2D context.
 *
 * The painter draws the scene with WebGL2 (`idle/gl.ts`) and copies it in, at
 * the resolution the context is really drawn at — the preview's scale, the
 * export's raster — read from the context's transform rather than from the
 * canvas, which a video tile shifts (see AGENTS.md). With "carry on across
 * outputs" the saver is one picture across the whole surface and each output a
 * window onto it, cut out of the projection.
 */

import type { IdleKind, IdleLook, IdleOptions } from '../types'
import type { Ctx } from './draw'
import type { PaintEnv } from './env'
import {
  camTiltFromParam,
  clamp01,
  ColourMode,
  fovFromParam,
  hueCycleFromParam,
  speedFromParam,
  type IdleSettings,
  type Saver,
} from './idle/common'
import { Beziers, Curves, FlyingWindows, Marquee, Mystify, Starfield } from './idle/flat'
import { FlowerBox, FlyingObjects, Text3D } from './idle/solids'
import { Maze, Pipes } from './idle/growing'
import { edgeWidthPixels, renderScene } from './idle/gl'
export { renderFailures as idleRenderFailures } from './idle/gl'
import { Scene, Shading } from './idle/scene'
import { v3, type V3 } from './idle/maths'

export const IDLE_KINDS: readonly IdleKind[] = [
  'mystify',
  'beziers',
  'curves',
  'flying-windows',
  'starfield',
  'marquee',
  'maze',
  'pipes',
  'flying-objects',
  'flowerbox',
  'text-3d',
]

export function isIdle(kind: string): kind is IdleKind {
  return (IDLE_KINDS as readonly string[]).includes(kind)
}

/** The OpenGL ones, with a camera, lighting and fog. */
export function isIdle3d(kind: IdleKind): boolean {
  return kind === 'maze' || kind === 'pipes' || kind === 'flying-objects' || kind === 'flowerbox' || kind === 'text-3d'
}

const look = (patch: Partial<IdleLook>): IdleLook => ({
  density: 0.5,
  complexity: 0.5,
  size: 0.5,
  length: 0.5,
  lineWidth: 0.3,
  variation: 0.5,
  shading: 'flat',
  speed: 0.5,
  fov: 0.4,
  camDistance: 0.5,
  camTilt: 0.5,
  fog: 0,
  colourMode: 'classic',
  colour: '#ffffff',
  hueSpread: 0.3,
  hueCycle: 0.5,
  background: '#000000',
  ...patch,
})

/** Each saver as it ran: Idler's first eleven presets (`Presets.h`), field for field. */
export const IDLE_AS_IT_RAN: Record<IdleKind, IdleLook> = {
  mystify: look({ density: 0.55, complexity: 0.35, length: 0.45, lineWidth: 0.25 }),
  beziers: look({ density: 0.3, complexity: 0.35, lineWidth: 0.25 }),
  curves: look({ density: 0.25, complexity: 0.45, size: 0.6, length: 0.7, lineWidth: 0.2, hueSpread: 0.5, hueCycle: 0.55 }),
  'flying-windows': look({ density: 0.45, variation: 0.4, fov: 0.45 }),
  starfield: look({ density: 0.55, size: 0.35, length: 0.1, fov: 0.45 }),
  marquee: look({ size: 0.55, lineWidth: 0.45, variation: 0 }),
  maze: look({ density: 0.4, complexity: 0.4, shading: 'lit', fog: 0.55 }),
  pipes: look({ density: 0.62, complexity: 0.45, length: 0.6, shading: 'lit', fog: 0.3, hueSpread: 0.6 }),
  'flying-objects': look({ variation: 0.6, shading: 'lit', fog: 0.2, hueSpread: 0.4 }),
  flowerbox: look({ complexity: 0.55, size: 0.55, shading: 'lit', hueSpread: 0.7 }),
  'text-3d': look({ size: 0.55, length: 0.35, lineWidth: 0.4, shading: 'lit' }),
}

type SceneControl = 'density' | 'complexity' | 'size' | 'length' | 'lineWidth' | 'variation'

/**
 * What the seven generic controls mean to each saver, from the savers' own
 * notes. A control a saver does not read is left out. On the 3D savers Line
 * Width is also the wireframe's weight, so the panel offers it in wireframe.
 */
export const IDLE_CONTROLS: Record<IdleKind, Partial<Record<SceneControl, string>>> = {
  mystify: { density: 'Polygons', complexity: 'Corners', length: 'Trail', size: 'Reach', lineWidth: 'Line width', variation: 'Corner speed' },
  beziers: { density: 'Curves', complexity: 'Control points', length: 'Trail', size: 'Reach', lineWidth: 'Line width', variation: 'Point speed' },
  curves: { density: 'Curves', complexity: 'Ratio', length: 'How much is drawn', size: 'Radius', lineWidth: 'Line width', variation: 'Rosette to star' },
  'flying-windows': { density: 'Logos', size: 'Size', complexity: 'Gap between panes', lineWidth: 'Pane inset', variation: 'Brightness spread' },
  starfield: { density: 'Stars', size: 'Star size', length: 'Streak', lineWidth: 'Streak width', variation: 'Brightness spread', complexity: 'Fade-in' },
  marquee: { size: 'Letter height', lineWidth: 'Stroke', density: 'Copies', length: 'Bounce height', complexity: 'Bounce rate', variation: 'Hue spread' },
  maze: { complexity: 'Chunk size', density: 'Turns', size: 'Corridor width', variation: 'Colour spread' },
  pipes: { density: 'Pipes', complexity: 'Grid', size: 'Pipe radius', length: 'Fill before clearing', variation: 'Turns' },
  'flying-objects': { density: 'Objects', complexity: 'Kinds of solid', size: 'Size', length: 'Depth', variation: 'Size and tumble spread' },
  flowerbox: { complexity: 'Lobes', size: 'Size', length: 'Morph', density: 'Surface detail', variation: 'Morph rate' },
  'text-3d': { size: 'Letter height', lineWidth: 'Weight', length: 'Depth', complexity: 'Roll', density: 'Copies', variation: 'Hue spread' },
}

/** Whether a saver reads Camera Distance: 3D Maze is first person and does not. */
export const usesCamDistance = (kind: IdleKind): boolean => isIdle3d(kind) && kind !== 'maze'

/** Whether a saver offers Flat shading. The others light their solids whatever is asked, as Idler does. */
export const offersFlat = (kind: IdleKind): boolean => kind === 'pipes'

const makeSaver: Record<IdleKind, () => Saver> = {
  mystify: () => new Mystify(),
  beziers: () => new Beziers(),
  curves: () => new Curves(),
  'flying-windows': () => new FlyingWindows(),
  starfield: () => new Starfield(),
  marquee: () => new Marquee(),
  maze: () => new Maze(),
  pipes: () => new Pipes(),
  'flying-objects': () => new FlyingObjects(),
  flowerbox: () => new FlowerBox(),
  'text-3d': () => new Text3D(),
}

/** One of each, kept: the growing savers cache their replay between frames. */
const savers = new Map<IdleKind, Saver>()

const SHADING = { flat: Shading.Flat, lit: Shading.Lit, wireframe: Shading.Wireframe } as const
const COLOUR_MODE = { classic: ColourMode.Classic, tint: ColourMode.Tint, spread: ColourMode.Spread, cycle: ColourMode.Cycle } as const

/** '#rrggbb' to RGB 0..1. Anything else is white, which is what the colour inputs start at. */
export function hexToRgb(hex: string): V3 {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return v3(1, 1, 1)
  return v3(parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255)
}

/**
 * The controls, converted, at loop time `t`. Speed scales saver time, and the
 * loop in saver time with it, so whatever is fitted to the period is still
 * periodic in the real loop. Stopped (speed 0) holds the moment t = 0 shows,
 * not saver time zero, so a stopped 3D Pipes is a grown network, not an empty box.
 */
export function idleSettings(kind: IdleKind, opts: IdleOptions, aspect: number, t: number, loopSeconds: number): IdleSettings {
  const l = opts.looks[kind] ?? IDLE_AS_IT_RAN[kind]
  const speed = speedFromParam(l.speed)
  return {
    density: clamp01(l.density),
    complexity: clamp01(l.complexity),
    size: clamp01(l.size),
    length: clamp01(l.length),
    lineWidth: clamp01(l.lineWidth),
    variation: clamp01(l.variation),
    shading: SHADING[l.shading] ?? Shading.Lit,
    time: speed > 0 ? t * speed : 0,
    period: loopSeconds * (speed > 0 ? speed : 1),
    seed: Math.trunc(Math.abs(opts.seed)) >>> 0,
    fov: fovFromParam(l.fov),
    camDistance: clamp01(l.camDistance),
    camTilt: camTiltFromParam(l.camTilt),
    fog: clamp01(l.fog),
    colourMode: COLOUR_MODE[l.colourMode] ?? ColourMode.Classic,
    tint: hexToRgb(l.colour),
    hueSpread: clamp01(l.hueSpread),
    hueCycle: hueCycleFromParam(l.hueCycle),
    aspect: aspect > 0 && Number.isFinite(aspect) ? aspect : 16 / 9,
    text: opts.text,
  }
}

/**
 * The last scene built, and what it was built from. The outputs of a span share
 * their settings, aspect and moment, so all but the first reuse it rather than
 * building the same maze again; the renderer only reads a scene.
 */
let last: { key: string; scene: Scene } | null = null

/** The scene for one frame. Exported for the tests, which check frame 0 against frame N mesh for mesh. */
export function buildIdleScene(kind: IdleKind, s: IdleSettings, background = v3(0, 0, 0)): Scene {
  const key = JSON.stringify([kind, s, background])
  if (last?.key === key) return last.scene
  let saver = savers.get(kind)
  if (!saver) {
    saver = makeSaver[kind]()
    savers.set(kind, saver)
  }
  const scene = new Scene()
  scene.background = background
  saver.build(s, scene)
  last = { key, scene }
  return scene
}

/** Whether an idle pattern moves: all of them do, unless stopped. */
export function idleMoves(kind: IdleKind, opts: IdleOptions): boolean {
  return speedFromParam((opts.looks[kind] ?? IDLE_AS_IT_RAN[kind]).speed) > 0
}

export function drawIdle(ctx: Ctx, w: number, h: number, kind: IdleKind, opts: IdleOptions, env: PaintEnv) {
  const l = opts.looks[kind] ?? IDLE_AS_IT_RAN[kind]
  const background = hexToRgb(l.background)
  const s = idleSettings(kind, opts, env.world.widthPx / env.world.heightPx, env.t, env.loopSeconds)
  const scene = buildIdleScene(kind, s, background)
  const css = `rgb(${Math.round(background.x * 255)}, ${Math.round(background.y * 255)}, ${Math.round(background.z * 255)})`

  // Device pixels per painter unit: the preview's scale, or 1 for an export (a video tile only translates).
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null
  const sx = m ? Math.hypot(m.a, m.b) || 1 : 1
  const sy = m ? Math.hypot(m.c, m.d) || 1 : 1

  ctx.save()
  ctx.fillStyle = css
  ctx.fillRect(0, 0, w, h)
  const result = renderScene(
    scene,
    {
      full: { width: env.world.widthPx * sx, height: env.world.heightPx * sy },
      x: env.view.x * sx,
      y: env.view.y * sy,
      width: Math.max(1, Math.round(w * sx)),
      height: Math.max(1, Math.round(h * sy)),
      edgeWidth: edgeWidthPixels(s.lineWidth, env.world.widthPx * sx, env.world.heightPx * sy),
    },
    (source, pw, ph, x, y) => ctx.drawImage(source, 0, 0, pw, ph, x / sx, y / sy, pw / sx, ph / sy),
  )
  if (result !== 'drawn') {
    const size = Math.max(12, Math.round(Math.min(w, h) / 24))
    ctx.fillStyle = css
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = '#ffffff'
    ctx.font = `${size}px ui-monospace, Menlo, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(
      result === 'lost'
        ? 'Lost the graphics context. Drawing again as soon as it comes back.'
        : 'This pattern needs WebGL2, which this browser has not got.',
      w / 2,
      h / 2,
    )
  } else if (scene.fade < 1) {
    ctx.globalAlpha = 1 - scene.fade
    ctx.fillStyle = css
    ctx.fillRect(0, 0, w, h)
  }
  ctx.restore()
}
