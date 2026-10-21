/**
 * AV sync: a flash and a beep on the same frame, and a scale that says by how
 * many frames they've come apart by the time they reach you.
 *
 * Once every `everySeconds` the pattern has a SYNC FRAME. On it the side panels
 * flash white, the hand that sweeps round the ring reaches the top, and the
 * MP4's sound track starts a 1 kHz beep at -18 dBFS that lasts that one frame.
 * Underneath, boxes numbered -6 to +6 light one per frame around it, box 0 on
 * the sync frame itself.
 *
 * To measure a system: film the screen (or take its output into anything that
 * records sound and picture together), find where the beep starts in the sound,
 * and read which box is lit on that frame. Box +2 lit means the sound arrives
 * two frames late against the picture; -1, one frame early.
 *
 * Everything is in whole frames: a frame number is worked out from t, and the
 * beep starts on the exact time a frame starts, so a beep and its flash land on
 * the same frame of the file. The sync frames sit half an interval away from
 * the loop's wrap, so the start of the file is quiet. That's where an AAC
 * encoder's priming goes, and where a player rejoins the loop.
 */

import type { AnimationOptions, AvSyncOptions, CentreOptions, Rect } from '../types'
import type { Ctx } from './draw'
import type { PaintEnv } from './env'
import { loopTiming, type LoopTiming } from './loop'
import { drawCentrepiece, fitTextSize } from './centre'

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'

/** How far either side of the sync frame the boxes run. */
export const SCALE_FRAMES = 6
/** The beep, as a level. -18 dBFS is the EBU's alignment level for tone. */
export const BEEP_DBFS = -18
export const SAMPLE_RATE = 48000

/**
 * The sync frames in a loop of `frames`: one every `everySeconds`, as near as
 * whole frames allow, the first half an interval in.
 */
export function syncFrames(timing: LoopTiming, everySeconds: number): number[] {
  const perSecond = timing.fpsNum / timing.fpsDen
  const n = Math.max(1, Math.round(timing.frames / (Math.max(0.1, everySeconds) * perSecond)))
  return Array.from({ length: n }, (_, k) => Math.round(((k + 0.5) * timing.frames) / n) % timing.frames)
}

/** The frame showing at time t: frame n runs from n/fps up to (n+1)/fps. */
export function frameAt(t: number, timing: LoopTiming): number {
  const n = Math.floor((t * timing.fpsNum) / timing.fpsDen + 1e-6)
  return ((n % timing.frames) + timing.frames) % timing.frames
}

/** Frames from the nearest sync frame, signed, allowing for the loop going round. */
export function framesFromSync(n: number, syncs: number[], frames: number): number {
  let best = Infinity
  for (const s of syncs) {
    for (const d of [n - s, n - s + frames, n - s - frames]) if (Math.abs(d) < Math.abs(best)) best = d
  }
  return best
}

/** How far round the ring the hand is on frame n: 0 on a sync frame, rising to just under 1 before the next. */
export function sweep(n: number, syncs: number[], frames: number): { phase: number; interval: number } {
  const sorted = [...syncs].sort((a, b) => a - b)
  for (let k = 0; k < sorted.length; k++) {
    const from = sorted[k]!
    const to = k + 1 < sorted.length ? sorted[k + 1]! : sorted[0]! + frames
    const at = n >= from ? n : n + frames
    if (at >= from && at < to) return { phase: (at - from) / (to - from), interval: to - from }
  }
  return { phase: 0, interval: frames }
}

/**
 * The loop's sound, one channel of it: a beep starting on each sync frame's
 * first sample and lasting that frame, silence otherwise. Its length is the
 * loop's, to the nearest sample. A millisecond's raised-cosine ramp each end
 * stops the beep clicking without blurring when it starts.
 */
export function syncAudio(timing: LoopTiming, opts: AvSyncOptions, sampleRate = SAMPLE_RATE): Float32Array {
  const length = Math.round(timing.seconds * sampleRate)
  const pcm = new Float32Array(length)
  const amp = 10 ** (BEEP_DBFS / 20)
  const frameSamples = (sampleRate * timing.fpsDen) / timing.fpsNum
  const beep = Math.max(1, Math.round(frameSamples))
  const ramp = Math.max(1, Math.round(sampleRate * 0.001))
  const hz = Math.max(20, Math.min(20000, opts.toneHz))
  for (const f of syncFrames(timing, opts.everySeconds)) {
    const start = Math.round(f * frameSamples)
    for (let i = 0; i < beep; i++) {
      const edge = Math.min(i, beep - 1 - i)
      const env = edge < ramp ? 0.5 - 0.5 * Math.cos((Math.PI * edge) / ramp) : 1
      pcm[(start + i) % length] = amp * env * Math.sin((2 * Math.PI * hz * i) / sampleRate)
    }
  }
  return pcm
}

/** Where everything goes. Pure, so the tests can check it without a canvas. */
export function avSyncLayout(w: number, h: number) {
  const cx = w / 2
  const cy = h * 0.42
  const r = Math.round(Math.min(h * 0.3, w * 0.3))
  const panelW = Math.max(0, Math.round(cx - r * 1.25 - w * 0.04))
  const panels: Rect[] = panelW > 0
    ? [
        { x: Math.round(w * 0.04), y: Math.round(cy - r), width: panelW, height: Math.round(r * 2) },
        { x: Math.round(w - w * 0.04 - panelW), y: Math.round(cy - r), width: panelW, height: Math.round(r * 2) },
      ]
    : []
  const centre: Rect = { x: Math.round(cx - r * 0.62), y: Math.round(cy - r * 0.62), width: Math.round(r * 1.24), height: Math.round(r * 1.24) }
  const count = SCALE_FRAMES * 2 + 1
  const gap = Math.max(1, Math.round(w * 0.006))
  const boxW = Math.max(1, Math.floor((w * 0.86 - gap * (count - 1)) / count))
  const boxH = Math.max(1, Math.round(Math.min(h * 0.11, boxW * 0.8)))
  const x0 = Math.round((w - (boxW * count + gap * (count - 1))) / 2)
  const y = Math.round(h * 0.8)
  const boxes = Array.from({ length: count }, (_, i) => ({ x: x0 + i * (boxW + gap), y, width: boxW, height: boxH, offset: i - SCALE_FRAMES }))
  return { ring: { cx, cy, r }, panels, centre, boxes, title: { x: 0, y: Math.round(h * 0.93), width: w, height: Math.round(h * 0.06) } }
}

export function drawAvSync(
  ctx: Ctx,
  w: number,
  h: number,
  opts: AvSyncOptions,
  animation: AnimationOptions,
  centre: CentreOptions,
  env: PaintEnv,
) {
  const timing = loopTiming(animation)
  const syncs = syncFrames(timing, opts.everySeconds)
  const n = frameAt(env.t, timing)
  const offset = framesFromSync(n, syncs, timing.frames)
  const flash = offset === 0
  const { phase, interval } = sweep(n, syncs, timing.frames)
  const L = avSyncLayout(w, h)
  const { cx, cy, r } = L.ring

  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, w, h)

  for (const p of L.panels) {
    ctx.fillStyle = flash ? '#ffffff' : '#141414'
    ctx.fillRect(p.x, p.y, p.width, p.height)
  }

  // The ring: a tick per frame of this interval, the sync position at the top in red.
  const thick = Math.max(2, r * 0.05)
  ctx.lineWidth = thick
  ctx.strokeStyle = flash ? '#ffffff' : '#3a3a3a'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  const ticks = interval <= 120 ? interval : 0
  for (let i = 0; i < ticks; i++) {
    const a = -Math.PI / 2 + (i / interval) * Math.PI * 2
    const major = i === 0 || (interval % 4 === 0 && i % (interval / 4) === 0)
    const len = i === 0 ? r * 0.16 : major ? r * 0.1 : r * 0.05
    ctx.strokeStyle = i === 0 ? '#ff3b30' : '#8a8a8a'
    ctx.lineWidth = i === 0 ? thick : Math.max(1, thick * 0.35)
    ctx.beginPath()
    ctx.moveTo(cx + Math.cos(a) * (r - thick), cy + Math.sin(a) * (r - thick))
    ctx.lineTo(cx + Math.cos(a) * (r - thick - len), cy + Math.sin(a) * (r - thick - len))
    ctx.stroke()
  }
  // The hand: a dot on the ring, one tick a frame, at the top on the sync frame.
  const a = -Math.PI / 2 + phase * Math.PI * 2
  ctx.fillStyle = flash ? '#ff3b30' : '#ffffff'
  ctx.beginPath()
  ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.max(2, r * 0.07), 0, Math.PI * 2)
  ctx.fill()

  drawCentrepiece(ctx, L.centre, centre, env)

  // The scale: which box is lit says how many frames from the sync frame this is.
  for (const b of L.boxes) {
    const lit = b.offset === offset
    ctx.fillStyle = lit ? (b.offset === 0 ? '#ff3b30' : '#ffffff') : '#1c1c1c'
    ctx.fillRect(b.x, b.y, b.width, b.height)
    const label = b.offset > 0 ? `+${b.offset}` : b.offset < 0 ? `−${-b.offset}` : '0'
    const size = fitTextSize([label], b.width * 0.8, b.height * 0.6, (line, s) => {
      ctx.font = `700 ${s}px ${MONO}`
      return ctx.measureText(line).width
    })
    if (size >= 6) {
      ctx.font = `700 ${size}px ${MONO}`
      ctx.fillStyle = lit ? '#000000' : '#6a6a6a'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, b.x + b.width / 2, b.y + b.height / 2)
    }
  }

  const caption = `AV sync · beep and flash every ${opts.everySeconds} s · ${opts.toneHz} Hz at ${BEEP_DBFS} dBFS · frame ${n + 1} of ${timing.frames}`
  const size = fitTextSize([caption], L.title.width * 0.9, L.title.height * 0.7, (line, s) => {
    ctx.font = `${s}px ${SANS}`
    return ctx.measureText(line).width
  })
  if (size >= 8) {
    ctx.font = `${size}px ${SANS}`
    ctx.fillStyle = '#9a9a9a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(caption, w / 2, L.title.y + L.title.height / 2)
  }
}
