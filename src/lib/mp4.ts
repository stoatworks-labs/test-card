/**
 * A minimal MP4 writer: one H.264 video track, and optionally one AAC track.
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
 * that has them — so the video needs no composition offsets (ctts) or edit list.
 *
 * SOUND
 * =====
 * The AAC track (trak/mdia/minf with smhd, and stsd/mp4a/esds) has the one thing
 * the video doesn't: an edit list. An AAC encoder starts with some samples of
 * priming, and `edts/elst` tells the player to start that many samples in and
 * play the loop's length from there. Without it the sound runs late by the
 * priming (2112 samples, 44 ms, from Chrome on a Mac), which on an AV sync loop
 * is the very thing being measured. AVFoundation also wants the `roll` sample
 * group Apple's encoder writes, or it trims the priming a second time and the
 * sound runs early by the same amount (measured, 2026-10-21). Samples of both tracks go into mdat in time
 * order, so a player reads them together.
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

export type Mp4Audio = {
  /** AAC access units, 1024 samples each. */
  frames: Uint8Array[]
  /** AudioSpecificConfig. */
  asc: Uint8Array
  sampleRate: number
  channels: number
  bitrate: number
  /** Samples to skip at the start (the encoder's priming), by edit list. */
  delay: number
  /** Samples to play after them: the loop's length. */
  length: number
}

const AAC_FRAME = 1024

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

/** An MPEG-4 descriptor: tag, length (one byte will do for these), payload. */
function descriptor(tag: number, ...payload: Uint8Array[]): Uint8Array {
  const length = payload.reduce((n, p) => n + p.length, 0)
  if (length > 127) throw new Error('An MPEG-4 descriptor that long needs a longer length field.')
  const b = new Buf().u8(tag).u8(length)
  for (const p of payload) b.bytes(p)
  return b.done()
}

function audioTrak(audio: Mp4Audio, offsets: number[], movieTimescale: number): Uint8Array {
  const n = audio.frames.length
  const playDuration = Math.round((audio.length / audio.sampleRate) * movieTimescale)
  const tkhd = fullBox(
    'tkhd',
    0,
    0x000003,
    new Buf()
      .u32(0)
      .u32(0)
      .u32(2)
      .u32(0)
      .u32(playDuration)
      .zeros(8)
      .u16(0)
      .u16(0)
      .u16(0x0100) // full volume
      .u16(0)
      .bytes(matrix())
      .u32(0)
      .u32(0)
      .done(),
  )
  // Skip the priming, then play the loop's length.
  const elst = fullBox('elst', 0, 0, new Buf().u32(1).u32(playDuration).u32(audio.delay).u16(1).u16(0).done())
  const mdhd = fullBox('mdhd', 0, 0, new Buf().u32(0).u32(0).u32(audio.sampleRate).u32(n * AAC_FRAME).u16(0x55c4).u16(0).done())
  const hdlr = fullBox('hdlr', 0, 0, new Buf().u32(0).str('soun').zeros(12).str('SoundHandler').u8(0).done())
  const decoderConfig = descriptor(
    0x04,
    new Buf()
      .u8(0x40) // MPEG-4 audio
      .u8(0x15) // audio stream
      .u8(0)
      .u16(0) // buffer size
      .u32(audio.bitrate)
      .u32(audio.bitrate)
      .done(),
    descriptor(0x05, audio.asc),
  )
  const es = descriptor(0x03, new Buf().u16(0).u8(0).done(), decoderConfig, descriptor(0x06, Uint8Array.of(0x02)))
  const mp4a = box(
    'mp4a',
    new Buf()
      .zeros(6)
      .u16(1) // data_reference_index
      .zeros(8)
      .u16(audio.channels)
      .u16(16)
      .u16(0)
      .u16(0)
      .u32(audio.sampleRate * 0x10000)
      .done(),
    fullBox('esds', 0, 0, es),
  )
  const stsd = fullBox('stsd', 0, 0, new Buf().u32(1).done(), mp4a)
  const stts = fullBox('stts', 0, 0, new Buf().u32(1).u32(n).u32(AAC_FRAME).done())
  const stsc = fullBox('stsc', 0, 0, new Buf().u32(1).u32(1).u32(1).u32(1).done())
  const stszBuf = new Buf().u32(0).u32(n)
  for (const f of audio.frames) stszBuf.u32(f.length)
  const stcoBuf = new Buf().u32(n)
  for (const o of offsets) stcoBuf.u32(o)
  // Every AAC frame needs the one before it to decode ("roll" -1), as Apple's own encoder marks it.
  // Without this group AVFoundation (and so Resolume on a Mac) trims the priming itself AND obeys
  // the edit list, and the sound plays 2112 samples early; ffmpeg reads it the same either way.
  const sgpd = fullBox('sgpd', 1, 0, new Buf().str('roll').u32(2).u32(1).u16(0xffff).done())
  const sbgp = fullBox('sbgp', 0, 0, new Buf().str('roll').u32(1).u32(n).u32(1).done())
  const stbl = box('stbl', stsd, stts, stsc, fullBox('stsz', 0, 0, stszBuf.done()), fullBox('stco', 0, 0, stcoBuf.done()), sgpd, sbgp)
  const smhd = fullBox('smhd', 0, 0, new Buf().u16(0).u16(0).done())
  const dref = fullBox('dref', 0, 0, new Buf().u32(1).done(), fullBox('url ', 0, 1))
  const minf = box('minf', smhd, box('dinf', dref), stbl)
  return box('trak', tkhd, box('edts', elst), box('mdia', mdhd, hdlr, minf))
}

function buildMoov(samples: Mp4Sample[], opts: Mp4Options, offsets: number[], audio?: Mp4Audio, audioOffsets: number[] = []): Uint8Array {
  const n = samples.length
  const mediaDuration = n * opts.sampleDuration
  const movieTimescale = 1000
  const videoDuration = Math.round((mediaDuration / opts.timescale) * movieTimescale)
  const audioDuration = audio ? Math.round((audio.length / audio.sampleRate) * movieTimescale) : 0
  const movieDuration = Math.max(videoDuration, audioDuration)

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
      .u32(audio ? 3 : 2) // next track ID
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
      .u32(videoDuration)
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
  return audio ? box('moov', mvhd, trak, audioTrak(audio, audioOffsets, movieTimescale)) : box('moov', mvhd, trak)
}

export function buildMp4(samples: Mp4Sample[], opts: Mp4Options, audio?: Mp4Audio): Uint8Array {
  if (!samples.length) throw new Error('No video frames to write.')
  if (!samples[0]!.key) throw new Error('The first frame must be a keyframe, or nothing can start the loop.')
  if (opts.width < 1 || opts.height < 1 || opts.width > 0xffff || opts.height > 0xffff) {
    throw new Error(`${opts.width}x${opts.height} cannot be described in an MP4 sample entry.`)
  }
  if (audio && audio.frames.length * AAC_FRAME < audio.delay + audio.length) {
    throw new Error('The sound is shorter than its priming and the loop together.')
  }

  const ftyp = box('ftyp', new Buf().str('isom').u32(0x200).str('isom').str('iso2').str('avc1').str('mp41').done())
  const audioFrames = audio?.frames ?? []
  const mdatPayload = samples.reduce((n, s) => n + s.data.length, 0) + audioFrames.reduce((n, f) => n + f.length, 0)
  // moov's size does not depend on the offset VALUES, so size it once with
  // zeros, then build it for real.
  const moovSize = buildMoov(samples, opts, samples.map(() => 0), audio, audioFrames.map(() => 0)).length
  const first = ftyp.length + moovSize + 8
  const total = first + mdatPayload
  if (total > 0xffffffff) {
    throw new Error('The loop would be over 4 GiB, past what 32-bit chunk offsets can address. Shorten it or lower the bitrate.')
  }
  // Both tracks' samples in the order they play, so a player reads them together.
  type Entry = { data: Uint8Array; time: number; video: boolean }
  const entries: Entry[] = [
    ...samples.map((s, i) => ({ data: s.data, time: (i * opts.sampleDuration) / opts.timescale, video: true })),
    ...audioFrames.map((f, j) => ({ data: f, time: (j * AAC_FRAME) / audio!.sampleRate, video: false })),
  ]
  // Stable: a video frame and a sound frame at the same moment keep video first.
  entries.sort((a, b) => a.time - b.time || Number(b.video) - Number(a.video))
  const offsets: number[] = []
  const audioOffsets: number[] = []
  let at = first
  for (const e of entries) {
    ;(e.video ? offsets : audioOffsets).push(at)
    at += e.data.length
  }
  const moov = buildMoov(samples, opts, offsets, audio, audioOffsets)

  const out = new Uint8Array(total)
  out.set(ftyp, 0)
  out.set(moov, ftyp.length)
  const mdatHead = new Buf().u32(8 + mdatPayload).str('mdat').done()
  out.set(mdatHead, ftyp.length + moov.length)
  let o = first
  for (const e of entries) {
    out.set(e.data, o)
    o += e.data.length
  }
  return out
}

/** The nclx codes for BT.709 video. */
export const BT709 = { primaries: 1, transfer: 1, matrix: 1 } as const
