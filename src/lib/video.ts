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
 *
 * TOO BIG FOR ONE VIDEO, SO TILES
 * ===============================
 * A browser's H.264 encoder stops well short of a big wall. Chrome 152 on a Mac
 * refuses anything over 4096 x 2304 = 9.4 megapixels, whatever its shape:
 * 8192 x 1080 and 2304 x 4096 are fine, 4096 x 2306 is not, and nothing at 8K
 * is. So `planLoop` cuts a raster the encoder will not take whole into a grid
 * of tiles, each a loop of its own, which side by side are the picture frame
 * for frame. It asks the browser rather than a table, since the limit is the
 * browser's and not the standard's: the fewest tiles it will take, without
 * cutting the picture into slivers to save one.
 *
 * Every tile's sides and offsets are even, so its 2x2 chroma blocks are the
 * whole raster's. A tile is drawn by shifting the whole picture under a canvas
 * the size of the tile, so the painters never know.
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

/** The first codec this browser will configure for the raster, rate and bitrate, or null. */
async function findConfig(width: number, height: number, fps: number, bitrate: number): Promise<VideoEncoderConfig | null> {
  for (const codec of avcCodecs(width, height, fps, bitrate)) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
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
  return null
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
  const config = await findConfig(req.width, req.height, fps, bitrate)
  if (config) return config
  throw new Error(
    `This browser's H.264 encoder will not take ${req.width}x${req.height} (tried ${codecs.join(', ')}). ` +
      'Large walls often exceed what the built-in encoder supports; export PNGs, or render a smaller output.',
  )
}

/** One piece of a loop: where it sits in the whole raster, and the bitrate to encode it at. */
export type VideoTile = {
  col: number
  row: number
  x: number
  y: number
  width: number
  height: number
  /** Bits per second; 0 = auto for this tile's size. */
  bitrate: number
}

/** How a loop is to be made: one tile, the whole raster, when the encoder takes it. */
export type LoopPlan = {
  cols: number
  rows: number
  tiles: VideoTile[]
}

/** The most tiles a loop is cut into before giving up. A 16384 x 16384 canvas needs 29 at Chrome's limit. */
export const MAX_VIDEO_TILES = 64

/** Narrower or shorter than this and a tile is not worth a video of its own. */
const MIN_TILE_PX = 16

/**
 * Cut an even raster into `cols` x `rows` tiles. Cuts land on even pixels and
 * are spaced as evenly as that allows, so the tiles differ by at most 2 px and
 * cover the raster exactly, with no gap and no overlap. Bitrate is left at 0.
 */
export function tileGrid(width: number, height: number, cols: number, rows: number): VideoTile[] {
  if (width % 2 || height % 2) throw new Error(`Tiles need an even raster, and this is ${width}x${height}.`)
  const cuts = (total: number, n: number) => Array.from({ length: n + 1 }, (_, i) => 2 * Math.round((i * total) / (2 * n)))
  const xs = cuts(width, cols)
  const ys = cuts(height, rows)
  const tiles: VideoTile[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({ col, row, x: xs[col]!, y: ys[row]!, width: xs[col + 1]! - xs[col]!, height: ys[row + 1]! - ys[row]!, bitrate: 0 })
    }
  }
  return tiles
}

/**
 * The grids worth trying, in the order to try them: by tile count times
 * (1 + how far the tiles are from square, as |ln(width / height)|). Fewer tiles
 * is better, and so is a sane shape. Count alone would cut a 16384 x 16384
 * canvas into 29 strips 565 px wide, 29 being the fewest that fit and prime;
 * this way it is 5 x 6. The whole raster always comes first, and 7680 x 4320
 * in four is 2 x 2 of 3840 x 2160 rather than 4 x 1 of 1920 x 4320.
 */
export function tileGrids(width: number, height: number, maxTiles = MAX_VIDEO_TILES): { cols: number; rows: number }[] {
  const grids: { cols: number; rows: number; cost: number }[] = []
  for (let n = 1; n <= maxTiles; n++) {
    for (let cols = 1; cols <= n; cols++) {
      const rows = n / cols
      if (!Number.isInteger(rows) || width / cols < MIN_TILE_PX || height / rows < MIN_TILE_PX) continue
      grids.push({ cols, rows, cost: n * (1 + Math.abs(Math.log(width / cols / (height / rows)))) })
    }
  }
  return grids
    // 5 x 6 and 6 x 5 are equally square, but not to the last bit of a double.
    .sort((a, b) => (Math.abs(a.cost - b.cost) > 1e-9 ? a.cost - b.cost : 0) || a.cols * a.rows - b.cols * b.rows || a.cols - b.cols)
    .map(({ cols, rows }) => ({ cols, rows }))
}

/**
 * How to make this loop: whole if the browser's encoder takes it, else the
 * fewest tiles it takes. A bitrate the user set is for the whole picture, so
 * each tile gets its share by area and the files come to what was asked for;
 * auto stays auto, sized for each tile. Throws, before any frame is drawn, for
 * anything that would fail later: no encoder, an odd raster, no grid the
 * encoder will take, or a set of files too big for the tab.
 */
export async function planLoop(width: number, height: number, timing: LoopTiming, bitrate: number): Promise<LoopPlan> {
  const problem = videoProblem(width, height)
  if (problem) throw new Error(problem)
  const fps = timing.fpsNum / timing.fpsDen
  const answers = new Map<string, Promise<boolean>>()
  const takes = (w: number, h: number, bps: number) => {
    const key = `${w}x${h}@${bps}`
    if (!answers.has(key)) answers.set(key, findConfig(w, h, fps, bps).then((c) => c !== null))
    return answers.get(key)!
  }

  let plan: LoopPlan | null = null
  search: for (const { cols, rows } of tileGrids(width, height)) {
    const tiles = tileGrid(width, height, cols, rows).map((t) => ({
      ...t,
      bitrate: bitrate ? Math.round((bitrate * t.width * t.height) / (width * height)) : 0,
    }))
    // Largest first: if any tile is refused, it is most likely that one.
    for (const t of [...tiles].sort((a, b) => b.width * b.height - a.width * a.height)) {
      if (!(await takes(t.width, t.height, t.bitrate || autoBitrate(t.width, t.height, fps)))) continue search
    }
    plan = { cols, rows, tiles }
    break
  }
  if (!plan) {
    throw new Error(
      `This browser's H.264 encoder will not take ${width}x${height}, whole or cut into as many as ${MAX_VIDEO_TILES} tiles. ` +
        'Export PNGs, or render a smaller output.',
    )
  }
  const size = plan.tiles.reduce((sum, t) => sum + estimateLoopBytes(t.width, t.height, timing, t.bitrate), 0)
  if (size > MAX_LOOP_BYTES) {
    throw new Error(
      `That loop would be about ${(size / 1024 ** 3).toFixed(1)} GB${plan.tiles.length > 1 ? ` across ${plan.tiles.length} tiles` : ''}, ` +
        'more than a browser tab can build. Shorten it, lower the bitrate, or export a smaller output.',
    )
  }
  return plan
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

export type PlanRequest = Omit<EncodeRequest, 'width' | 'height' | 'bitrate' | 'onProgress'> & {
  /** Frames done and total for the tile in hand, and which tile that is. */
  onProgress?: (done: number, total: number, tile: number) => void
}

/**
 * Encode each tile of a plan in turn, one MP4 per tile, in the plan's order.
 * `render` draws the WHOLE picture; each tile sees it shifted so the tile's
 * corner is at the origin, and the canvas, the size of the tile, crops the
 * rest. A plan of one tile is the whole raster, encoded exactly as before.
 */
export async function encodePlan(plan: LoopPlan, req: PlanRequest): Promise<Uint8Array[]> {
  const files: Uint8Array[] = []
  for (const [i, tile] of plan.tiles.entries()) {
    files.push(
      await encodeLoop({
        ...req,
        width: tile.width,
        height: tile.height,
        bitrate: tile.bitrate,
        render: (ctx, t) => {
          ctx.translate(-tile.x, -tile.y)
          req.render(ctx, t)
        },
        onProgress: (done, total) => req.onProgress?.(done, total, i),
      }),
    )
  }
  return files
}
