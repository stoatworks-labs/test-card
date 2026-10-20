/**
 * A minimal MP4 writer: one H.264 video track, nothing else.
 *
 * Hand-rolled for the same reasons as zip.ts — the job is small and well
 * specified, and a dependency would be bigger than the code. It writes exactly
 * what a loop needs and no more:
 *
 *   ftyp
 *   moov
 *     mvhd
 *     trak
 *       tkhd
 *       mdia
 *         mdhd, hdlr
 *         minf
 *           vmhd, dinf/dref
 *           stbl
 *             stsd/avc1 (avcC, colr, pasp)
 *             stts, stss, stsc, stsz, stco
 *   mdat
 *
 * moov goes BEFORE mdat ("fast start"), so a player or a media server can read
 * the index without seeking to the end of the file. Every sample has the same
 * duration (one frame), every sample is its own chunk, and there are no
 * B-frames — the encoder is asked for none and `encodeLoop` refuses a stream
 * that has them — so no composition offsets (ctts) or edit list are needed.
 *
 * COLOUR
 * ======
 * The file carries a `colr` box of type `nclx`: BT.709 primaries, transfer and
 * matrix, and the range flag. The pixels were converted to Y′CbCr by this app
 * with that matrix (see video.ts), so the label is a statement of fact rather
 * than a hope, and a player has no excuse to guess BT.601 the way ffmpeg's
 * rgb24 conversion does (AGENTS.md, "Traps").
 *
 * Sizes are capped at 4 GiB because the chunk offsets are 32-bit; past that
 * this throws rather than write a file that plays its first few seconds.
 */

export type Mp4Sample = {
  /** One access unit in AVCC form: 4-byte big-endian length before each NAL. */
  data: Uint8Array
  key: boolean
}

export type Mp4Options = {
  width: number
  height: number
  /** Media timescale: ticks per second. */
  timescale: number
  /** Every sample's duration, in ticks. */
  sampleDuration: number
  /** AVCDecoderConfigurationRecord — WebCodecs' `decoderConfig.description`. */
  avcC: Uint8Array
  colour?: { primaries: number; transfer: number; matrix: number; fullRange: boolean }
}

const enc = new TextEncoder()

class Buf {
  private parts: Uint8Array[] = []
  length = 0
  u8(v: number) {
    return this.bytes(Uint8Array.of(v & 0xff))
  }
  u16(v: number) {
    return this.bytes(Uint8Array.of((v >>> 8) & 0xff, v & 0xff))
  }
  u32(v: number) {
    const b = new Uint8Array(4)
    new DataView(b.buffer).setUint32(0, v >>> 0)
    return this.bytes(b)
  }
  zeros(n: number) {
    return this.bytes(new Uint8Array(n))
  }
  str(s: string) {
    return this.bytes(enc.encode(s))
  }
  bytes(b: Uint8Array) {
    this.parts.push(b)
    this.length += b.length
    return this
  }
  done(): Uint8Array {
    const out = new Uint8Array(this.length)
    let o = 0
    for (const p of this.parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }
}

function box(type: string, ...payload: Uint8Array[]): Uint8Array {
  const size = 8 + payload.reduce((n, p) => n + p.length, 0)
  const b = new Buf().u32(size).str(type)
  for (const p of payload) b.bytes(p)
  return b.done()
}

function fullBox(type: string, version: number, flags: number, ...payload: Uint8Array[]): Uint8Array {
  const head = new Buf().u8(version).u8(flags >>> 16).u8(flags >>> 8).u8(flags).done()
  return box(type, head, ...payload)
}

const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]

function matrix(): Uint8Array {
  const b = new Buf()
  for (const v of MATRIX) b.u32(v)
  return b.done()
}

function buildMoov(samples: Mp4Sample[], opts: Mp4Options, offsets: number[]): Uint8Array {
  const n = samples.length
  const mediaDuration = n * opts.sampleDuration
  const movieTimescale = 1000
  const movieDuration = Math.round((mediaDuration / opts.timescale) * movieTimescale)

  const mvhd = fullBox(
    'mvhd',
    0,
    0,
    new Buf()
      .u32(0)
      .u32(0)
      .u32(movieTimescale)
      .u32(movieDuration)
      .u32(0x00010000)
      .u16(0x0100)
      .zeros(10)
      .bytes(matrix())
      .zeros(24)
      .u32(2)
      .done(),
  )

  const tkhd = fullBox(
    'tkhd',
    0,
    0x000003, // enabled, in movie
    new Buf()
      .u32(0)
      .u32(0)
      .u32(1)
      .u32(0)
      .u32(movieDuration)
      .zeros(8)
      .u16(0)
      .u16(0)
      .u16(0)
      .u16(0)
      .bytes(matrix())
      .u32(opts.width * 0x10000)
      .u32(opts.height * 0x10000)
      .done(),
  )

  const mdhd = fullBox(
    'mdhd',
    0,
    0,
    new Buf().u32(0).u32(0).u32(opts.timescale).u32(mediaDuration).u16(0x55c4 /* "und" */).u16(0).done(),
  )
  const hdlr = fullBox('hdlr', 0, 0, new Buf().u32(0).str('vide').zeros(12).str('VideoHandler').u8(0).done())

  const compressor = new Uint8Array(32)
  const label = enc.encode('Test Card H.264')
  compressor[0] = label.length
  compressor.set(label, 1)

  const colour = opts.colour
  const colr = colour
    ? box(
        'colr',
        new Buf()
          .str('nclx')
          .u16(colour.primaries)
          .u16(colour.transfer)
          .u16(colour.matrix)
          .u8(colour.fullRange ? 0x80 : 0)
          .done(),
      )
    : new Uint8Array(0)
  const pasp = box('pasp', new Buf().u32(1).u32(1).done())

  const avc1 = box(
    'avc1',
    new Buf()
      .zeros(6)
      .u16(1) // data_reference_index
      .zeros(16)
      .u16(opts.width)
      .u16(opts.height)
      .u32(0x00480000)
      .u32(0x00480000)
      .u32(0)
      .u16(1) // frame_count
      .bytes(compressor)
      .u16(0x0018)
      .u16(0xffff)
      .done(),
    box('avcC', opts.avcC),
    colr,
    pasp,
  )
  const stsd = fullBox('stsd', 0, 0, new Buf().u32(1).done(), avc1)
  const stts = fullBox('stts', 0, 0, new Buf().u32(1).u32(n).u32(opts.sampleDuration).done())
  const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter((i) => i > 0)
  const stssBuf = new Buf().u32(keys.length)
  for (const k of keys) stssBuf.u32(k)
  const stss = fullBox('stss', 0, 0, stssBuf.done())
  const stsc = fullBox('stsc', 0, 0, new Buf().u32(1).u32(1).u32(1).u32(1).done())
  const stszBuf = new Buf().u32(0).u32(n)
  for (const s of samples) stszBuf.u32(s.data.length)
  const stsz = fullBox('stsz', 0, 0, stszBuf.done())
  const stcoBuf = new Buf().u32(n)
  for (const o of offsets) stcoBuf.u32(o)
  const stco = fullBox('stco', 0, 0, stcoBuf.done())

  const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco)
  const vmhd = fullBox('vmhd', 0, 1, new Buf().zeros(8).done())
  const dref = fullBox('dref', 0, 0, new Buf().u32(1).done(), fullBox('url ', 0, 1))
  const minf = box('minf', vmhd, box('dinf', dref), stbl)
  const mdia = box('mdia', mdhd, hdlr, minf)
  const trak = box('trak', tkhd, mdia)
  return box('moov', mvhd, trak)
}

export function buildMp4(samples: Mp4Sample[], opts: Mp4Options): Uint8Array {
  if (!samples.length) throw new Error('No video frames to write.')
  if (!samples[0]!.key) throw new Error('The first frame must be a keyframe, or nothing can start the loop.')
  if (opts.width < 1 || opts.height < 1 || opts.width > 0xffff || opts.height > 0xffff) {
    throw new Error(`${opts.width}x${opts.height} cannot be described in an MP4 sample entry.`)
  }

  const ftyp = box('ftyp', new Buf().str('isom').u32(0x200).str('isom').str('iso2').str('avc1').str('mp41').done())
  const mdatPayload = samples.reduce((n, s) => n + s.data.length, 0)
  // moov's size does not depend on the offset VALUES, so size it once with
  // zeros, then build it for real.
  const moovSize = buildMoov(samples, opts, samples.map(() => 0)).length
  const first = ftyp.length + moovSize + 8
  const total = first + mdatPayload
  if (total > 0xffffffff) {
    throw new Error('The loop would be over 4 GiB, past what 32-bit chunk offsets can address. Shorten it or lower the bitrate.')
  }
  const offsets: number[] = []
  let at = first
  for (const s of samples) {
    offsets.push(at)
    at += s.data.length
  }
  const moov = buildMoov(samples, opts, offsets)

  const out = new Uint8Array(total)
  out.set(ftyp, 0)
  out.set(moov, ftyp.length)
  const mdatHead = new Buf().u32(8 + mdatPayload).str('mdat').done()
  out.set(mdatHead, ftyp.length + moov.length)
  let o = first
  for (const s of samples) {
    out.set(s.data, o)
    o += s.data.length
  }
  return out
}

/** The nclx codes for BT.709 video. */
export const BT709 = { primaries: 1, transfer: 1, matrix: 1 } as const
