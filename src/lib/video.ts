/**
 * Encoding a moving pattern as a seamless H.264 loop, in the browser.
 *
 * WebCodecs' VideoEncoder does the compression; mp4.ts does the container.
 * Every frame is rendered on demand at its exact time — frame n at n·den/num
 * seconds — rather than captured in real time, so a 4K loop that takes a
 * minute to encode is still frame-exact, and frame N would be frame 0.
 *
 * COLOUR IS CONVERTED HERE, NOT BY THE ENCODER
 * ============================================
 * Handing the encoder an RGBA canvas leaves the RGB -> Y′CbCr matrix and range
 * up to the browser, and this repo has already been bitten once by a tool that
 * quietly used BT.601 for HD (AGENTS.md, "ffmpeg's rgb24 output uses the wrong
 * matrix"). So `rgbaToI420` converts with the Rec.709 matrix from colour.ts,
 * into limited-range 4:2:0, and the encoder is handed planes it cannot
 * reinterpret. The file says so in its `colr` box.
 *
 * The level-range setting still means what it means for a PNG: `full` reads
 * the canvas as 0–255 RGB; `legal` reads it as 16–235, so sub-black and
 * super-white in a legal-range pattern survive into the video's footroom and
 * headroom instead of being squeezed twice.
 */

import type { LevelRange } from '../types'
import { CHROMA_SPAN, KB, KG, KR, LUMA_BLACK, LUMA_SPAN } from './colour'
import { BT709, buildMp4, type Mp4Sample } from './mp4'
import type { LoopTiming } from '../patterns/loop'

/**
 * RGBA (canvas order) to planar 4:2:0 Y′CbCr, BT.709, limited range.
 * Chroma is the average of each 2x2 block. Width and height must be even.
 */
export function rgbaToI420(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, range: LevelRange): Uint8Array {
  const ySize = width * height
  const cw = width >> 1
  const ch = height >> 1
  const out = new Uint8Array(ySize + 2 * cw * ch)
  const off = range === 'legal' ? LUMA_BLACK : 0
  const span = range === 'legal' ? LUMA_SPAN : 255
  const cbScale = CHROMA_SPAN / (2 * (1 - KB))
  const crScale = CHROMA_SPAN / (2 * (1 - KR))
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v))

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const r = (rgba[i]! - off) / span
      const g = (rgba[i + 1]! - off) / span
      const b = (rgba[i + 2]! - off) / span
      out[y * width + x] = clamp(LUMA_BLACK + (KR * r + KG * g + KB * b) * LUMA_SPAN)
    }
  }
  const uBase = ySize
  const vBase = ySize + cw * ch
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const i = ((y * 2 + dy) * width + (x * 2 + dx)) * 4
        r += rgba[i]!
        g += rgba[i + 1]!
        b += rgba[i + 2]!
      }
      r = (r / 4 - off) / span
      g = (g / 4 - off) / span
      b = (b / 4 - off) / span
      const yy = KR * r + KG * g + KB * b
      out[uBase + y * cw + x] = clamp(128 + (b - yy) * cbScale)
      out[vBase + y * cw + x] = clamp(128 + (r - yy) * crScale)
    }
  }
  return out
}

/**
 * H.264 levels, as (max frame size in macroblocks, max macroblocks per second,
 * max bitrate in kbit/s for Main and Baseline, level_idc). From ITU-T H.264
 * Table A-1. High profile may go 1.25 times the bitrate; the Main figure is
 * used so a fallback to Main never lands outside its level.
 */
const LEVELS: [number, number, number, number][] = [
  [8192, 245760, 20000, 40],
  [8192, 245760, 50000, 41],
  [8704, 522240, 50000, 42],
  [22080, 589824, 135000, 50],
  [36864, 983040, 240000, 51],
  [36864, 2073600, 240000, 52],
  [139264, 4177920, 240000, 60],
  [139264, 8355840, 480000, 61],
  [139264, 16711680, 800000, 62],
]

/** The lowest H.264 level that admits this raster, rate and bitrate, or null if none does. */
export function avcLevel(width: number, height: number, fps: number, bitrate = 0): number | null {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16)
  const maxSide = Math.max(Math.ceil(width / 16), Math.ceil(height / 16))
  for (const [fs, mbps, kbps, idc] of LEVELS) {
    // A side may not exceed sqrt(8 * MaxFS) macroblocks (A.3.1, item f).
    if (mbs <= fs && mbs * fps <= mbps && maxSide <= Math.sqrt(8 * fs) && bitrate <= kbps * 1000) return idc
  }
  return null
}

/** Candidate codec strings, best first: High, then Main, then Constrained Baseline. */
export function avcCodecs(width: number, height: number, fps: number, bitrate = 0): string[] {
  const level = avcLevel(width, height, fps, bitrate)
  if (level === null) return []
  const hex = level.toString(16).padStart(2, '0')
  return [`avc1.6400${hex}`, `avc1.4d00${hex}`, `avc1.42e0${hex}`]
}

/** Bitrate for a raster when the user has not set one: generous, for detailed patterns. */
export function autoBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(240e6, Math.max(4e6, width * height * fps * 0.25)))
}

export type EncodeRequest = {
  width: number
  height: number
  timing: LoopTiming
  range: LevelRange
  /** Bits per second; 0 = auto. */
  bitrate: number
  /** Draw the frame at time t, filling the whole canvas. */
  render: (ctx: CanvasRenderingContext2D, t: number) => void
  onProgress?: (done: number, total: number) => void
}

/** Why this browser or raster cannot make a loop, or null if it can (as far as can be known up front). */
export function videoProblem(width: number, height: number): string | null {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return 'This browser has no video encoder (WebCodecs). The PNG export still works; for the MP4, use a current Chrome or Edge.'
  }
  if (width % 2 || height % 2) {
    return `H.264 needs an even width and height, and this is ${width}x${height}. Export a PNG, or correct the raster.`
  }
  return null
}

/**
 * The most a loop may come to. Every encoded frame is held in memory until the
 * file is written, then copied into the MP4 and again into the download, so a
 * tab needs about three times this. Past it the tab would die somewhere around
 * frame 900; better to say so before frame 0.
 */
export const MAX_LOOP_BYTES = 1024 ** 3

/** Roughly how big the loop will be, in bytes, warm-up included. */
export function estimateLoopBytes(width: number, height: number, timing: LoopTiming, bitrate: number): number {
  const fps = timing.fpsNum / timing.fpsDen
  const bps = bitrate || autoBitrate(width, height, fps)
  return (bps * (timing.seconds + 1)) / 8
}

async function pickConfig(req: EncodeRequest): Promise<VideoEncoderConfig> {
  const fps = req.timing.fpsNum / req.timing.fpsDen
  const bitrate = req.bitrate || autoBitrate(req.width, req.height, fps)
  const codecs = avcCodecs(req.width, req.height, fps, bitrate)
  if (!codecs.length) {
    throw new Error(
      avcLevel(req.width, req.height, fps) === null
        ? `${req.width}x${req.height} at ${fps.toFixed(2)} fps is beyond every H.264 level (the ceiling is 8192x4320).`
        : `${(bitrate / 1e6).toFixed(0)} Mb/s is more than H.264 allows at ${req.width}x${req.height}. Lower the bitrate.`,
    )
  }
  for (const codec of codecs) {
    const config: VideoEncoderConfig = {
      codec,
      width: req.width,
      height: req.height,
      bitrate,
      bitrateMode: 'variable',
      framerate: fps,
      latencyMode: 'quality',
      avc: { format: 'avc' },
    }
    try {
      const support = await VideoEncoder.isConfigSupported(config)
      if (support.supported) return support.config ?? config
    } catch {
      // An invalid config throws rather than answering "no"; try the next.
    }
  }
  throw new Error(
    `This browser's H.264 encoder will not take ${req.width}x${req.height} (tried ${codecs.join(', ')}). ` +
      'Large walls often exceed what the built-in encoder supports; export PNGs, or render a smaller output.',
  )
}

/**
 * Give the page a turn between frames, with a message to ourselves rather than
 * a timer. Chrome throttles a background tab's timers to one a second (one a
 * minute after five minutes), which would stretch an export the user tabbed
 * away from into hours; messages are not throttled, and the page still gets to
 * repaint between them. Measured in Chrome 152: a 330-frame 640x360 loop took
 * 2.6 s behind another tab and 2.5–2.6 s in front.
 */
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => resolve()
    ch.port2.postMessage(0)
  })
}

/** Render and encode the whole loop. Resolves to the finished MP4's bytes. */
export async function encodeLoop(req: EncodeRequest): Promise<Uint8Array> {
  const problem = videoProblem(req.width, req.height)
  if (problem) throw new Error(problem)
  const size = estimateLoopBytes(req.width, req.height, req.timing, req.bitrate)
  if (size > MAX_LOOP_BYTES) {
    throw new Error(
      `That loop would be about ${(size / 1024 ** 3).toFixed(1)} GB, more than a browser tab can build. ` +
        'Shorten it, lower the bitrate, or export a smaller output.',
    )
  }
  const config = await pickConfig(req)

  const chunks: { data: Uint8Array; key: boolean; timestamp: number }[] = []
  let avcC: Uint8Array | null = null
  let failure: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      chunks.push({ data, key: chunk.type === 'key', timestamp: chunk.timestamp })
      const desc = meta?.decoderConfig?.description
      if (desc) {
        const bytes =
          desc instanceof ArrayBuffer
            ? new Uint8Array(desc.slice(0))
            : new Uint8Array((desc as ArrayBufferView).buffer, (desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteLength).slice()
        // The MP4 carries one decoder configuration. An encoder that changes
        // its mind mid-stream would make a file whose later frames decode
        // against the wrong parameter sets, so refuse rather than write it.
        if (!avcC) avcC = bytes
        else if (bytes.length !== avcC.length || bytes.some((v, i) => v !== avcC![i])) {
          failure = new Error('The encoder changed its stream parameters part way through, which this MP4 writer cannot record.')
        }
      }
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e))
    },
  })
  encoder.configure(config)

  const canvas = document.createElement('canvas')
  canvas.width = req.width
  canvas.height = req.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Could not get a 2D canvas context.')

  const { frames, fpsNum, fpsDen } = req.timing
  const gop = Math.max(1, Math.round(fpsNum / fpsDen))
  const usPerFrame = (1e6 * fpsDen) / fpsNum
  // WARM-UP. Rate control starts a stream with no history, so it codes the
  // first frame unlike every later one — and in a loop the first frame is the
  // seam, played straight after the last. So the last second of the loop is
  // encoded first and thrown away, and the loop proper starts on a forced
  // keyframe with the rate control already settled. Measured on browser-made
  // loops (Chrome 152, hardware encoder), as the mean luma step from the last
  // frame back to the first: volcano 1.00 -> 0.60 and ocean 2.76 -> 2.42 grey
  // levels, against 0.49 and 2.36 for the step into any other keyframe of the
  // same loop. A fixed quantiser did as well but ran on the software encoder,
  // ten times slower.
  const warm = Math.min(frames, gop)
  const total = warm + frames
  try {
    for (let k = 0; k < total; k++) {
      if (failure) throw failure
      // Warm-up frames are the loop's own tail, so the encoder settles on the
      // very pictures that precede frame 0 when the file plays round.
      const n = k < warm ? frames - warm + k : k - warm
      const t = (n * fpsDen) / fpsNum
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, req.width, req.height)
      req.render(ctx, t)
      const rgba = ctx.getImageData(0, 0, req.width, req.height).data
      const planes = rgbaToI420(rgba, req.width, req.height, req.range)
      const frame = new VideoFrame(planes, {
        format: 'I420',
        codedWidth: req.width,
        codedHeight: req.height,
        timestamp: Math.round(k * usPerFrame),
        duration: Math.round(usPerFrame),
        colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
      })
      encoder.encode(frame, { keyFrame: k === 0 || (k >= warm && n % gop === 0) })
      frame.close()
      req.onProgress?.(k + 1, total)
      // Let the encoder drain and the page repaint; a wall of 4K frames queued
      // at once is a memory problem, and a frozen tab looks like a crash.
      // Back-pressure by yielding until the queue drains. Waiting on the
      // `dequeue` event instead can lose the race (it fires before the
      // listener goes on) and sit out a fallback timer; that version took
      // 3.3 s for the loop above.
      while (encoder.encodeQueueSize > 2) await yieldToPage()
      if (k % 4 === 3) await yieldToPage()
    }
    await encoder.flush()
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
  if (failure) throw failure
  if (!avcC) throw new Error('The encoder produced no decoder configuration (avcC).')
  if (chunks.length !== total) throw new Error(`The encoder returned ${chunks.length} frames for ${total}.`)
  for (let i = 1; i < chunks.length; i++) {
    if (chunks[i]!.timestamp <= chunks[i - 1]!.timestamp) {
      throw new Error('The encoder reordered frames (B-frames), which this MP4 writer does not support.')
    }
  }
  const loopChunks = chunks.slice(warm)
  if (!loopChunks[0]?.key) throw new Error('The encoder did not start the loop on a keyframe.')

  const samples: Mp4Sample[] = loopChunks.map((c) => ({ data: c.data, key: c.key }))
  const timescale = fpsDen === 1 ? fpsNum * 1000 : fpsNum
  const sampleDuration = fpsDen === 1 ? 1000 : fpsDen
  return buildMp4(samples, {
    width: req.width,
    height: req.height,
    timescale,
    sampleDuration,
    avcC: avcC as Uint8Array,
    colour: { ...BT709, fullRange: false },
  })
}
