/**
 * Sound for a loop: PCM in, AAC out, with the encoder's start-up delay measured.
 *
 * An AAC encoder starts its output with a few frames of "priming", so the
 * decoded sound runs late by that many samples unless the file says to skip
 * them. MP4 says it with an edit list (see mp4.ts). The amount depends on the
 * encoder: Chrome on a Mac (Apple's AAC underneath) primes 2112 samples, 44 ms
 * at 48 kHz, more than a frame at any frame rate, which on an AV sync loop is
 * the whole question. Other encoders prime differently, so rather than trust a
 * number, every export measures it: a one-sample click goes through the same
 * encoder settings, is decoded again, and the delay is where the click came out.
 */

export const AAC_CODEC = 'mp4a.40.2'
export const AAC_FRAME = 1024

/** One channel of a loop's sound, copied to every channel of the file. */
export type LoopAudio = { sampleRate: number; channels: number; pcm: Float32Array }

export type EncodedAudio = {
  /** AAC access units, AAC_FRAME samples each. */
  frames: Uint8Array[]
  /** The AudioSpecificConfig: WebCodecs' `decoderConfig.description`. */
  asc: Uint8Array
  sampleRate: number
  channels: number
  bitrate: number
  /** Samples of priming at the start of the decoded stream, measured. */
  delay: number
  /** The loop's own length, in samples. */
  length: number
}

/** The index of the largest magnitude in a signal. */
export function peakIndex(pcm: Float32Array): number {
  let best = -1
  let at = -1
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]!)
    if (v > best) {
      best = v
      at = i
    }
  }
  return at
}

/**
 * 192 kb/s is one of the four bitrates Windows' Media Foundation AAC encoder accepts
 * (96, 128, 160, 192), which is what Chrome uses there. Don't change it casually.
 */
export const AAC_BITRATE = 192_000

function config(audio: Pick<LoopAudio, 'sampleRate' | 'channels'>): AudioEncoderConfig {
  return { codec: AAC_CODEC, sampleRate: audio.sampleRate, numberOfChannels: audio.channels, bitrate: AAC_BITRATE }
}

/**
 * Silence to put in front of the sound so the priming, the padding and the loop
 * together end exactly on a packet boundary, and where the file should then start
 * playing. An edit that ends part way through a packet is obeyed to the sample by
 * AVFoundation, but ffmpeg keeps that whole last packet, so a file looped by ffmpeg
 * gained the rest of it every time round: 4 ms a loop at 30 fps, 15 ms at 29.97.
 */
export function alignToPackets(delay: number, length: number): { pad: number; mediaTime: number } {
  const pad = (AAC_FRAME - ((delay + length) % AAC_FRAME)) % AAC_FRAME
  return { pad, mediaTime: delay + pad }
}

/** Let the page breathe between batches, without a timer that a background tab would throttle. */
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => resolve()
    ch.port2.postMessage(0)
  })
}

/** Why this browser can't make the sound, or null if it can. */
export async function audioProblem(audio: Pick<LoopAudio, 'sampleRate' | 'channels'>): Promise<string | null> {
  if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') {
    return 'This browser cannot encode audio (it has no WebCodecs AudioEncoder), and this loop needs sound. Chrome or Edge can.'
  }
  const support = await AudioEncoder.isConfigSupported(config(audio)).catch(() => ({ supported: false }))
  return support.supported ? null : 'This browser cannot encode AAC audio, which this loop needs. Chrome or Edge on a Mac or on Windows can.'
}

/**
 * Encode one channel's samples, copied to every channel, in AAC_FRAME blocks, a few
 * at a time so a ten-minute loop isn't queued all at once. `onProgress` may throw to
 * cancel; the encoder is closed whatever happens.
 */
async function encode(audio: LoopAudio, onProgress?: (done: number, total: number) => void): Promise<{ frames: Uint8Array[]; asc: Uint8Array }> {
  const frames: Uint8Array[] = []
  let asc: Uint8Array | null = null
  let failure: Error | null = null
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      frames.push(data)
      const desc = meta?.decoderConfig?.description
      if (desc && !asc) {
        asc =
          desc instanceof ArrayBuffer
            ? new Uint8Array(desc.slice(0))
            : new Uint8Array((desc as ArrayBufferView).buffer, (desc as ArrayBufferView).byteOffset, (desc as ArrayBufferView).byteLength).slice()
      }
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e))
    },
  })
  const { pcm, channels, sampleRate } = audio
  try {
    encoder.configure(config(audio))
    for (let at = 0; at < pcm.length; at += AAC_FRAME) {
      while (encoder.encodeQueueSize > 16) await yieldToPage()
      if (failure) throw failure
      if (at % (AAC_FRAME * 256) === 0) {
        onProgress?.(at, pcm.length)
        await yieldToPage()
      }
      const n = Math.min(AAC_FRAME, pcm.length - at)
      const planar = new Float32Array(n * channels)
      for (let c = 0; c < channels; c++) planar.set(pcm.subarray(at, at + n), c * n)
      const data = new AudioData({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((at * 1e6) / sampleRate),
        data: planar,
      })
      encoder.encode(data)
      data.close()
    }
    await encoder.flush()
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
  if (failure) throw failure
  if (!asc) throw new Error('The audio encoder produced no decoder configuration.')
  return { frames, asc }
}

/** Decode AAC frames back to one channel of samples. */
async function decode(frames: Uint8Array[], asc: Uint8Array, audio: Pick<LoopAudio, 'sampleRate' | 'channels'>): Promise<Float32Array> {
  const parts: Float32Array[] = []
  let failure: Error | null = null
  const decoder = new AudioDecoder({
    output: (data) => {
      const part = new Float32Array(data.numberOfFrames)
      data.copyTo(part, { planeIndex: 0, format: 'f32-planar' })
      parts.push(part)
      data.close()
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e))
    },
  })
  try {
    decoder.configure({ codec: AAC_CODEC, sampleRate: audio.sampleRate, numberOfChannels: audio.channels, description: asc })
    frames.forEach((data, i) =>
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: Math.round((i * AAC_FRAME * 1e6) / audio.sampleRate), data })),
    )
    await decoder.flush()
  } finally {
    if (decoder.state !== 'closed') decoder.close()
  }
  if (failure) throw failure
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** How many samples late this encoder's output starts: a click in, decoded, found again. */
export async function measureDelay(audio: Pick<LoopAudio, 'sampleRate' | 'channels'>): Promise<number> {
  const click = Math.round(audio.sampleRate / 2)
  const pcm = new Float32Array(audio.sampleRate)
  pcm[click] = 0.9
  const { frames, asc } = await encode({ ...audio, pcm })
  const delay = peakIndex(await decode(frames, asc, audio)) - click
  // AAC-LC can't start sooner than one frame in: a smaller answer means a decoder that
  // trimmed some priming itself, or dropped its first output, and an edit list built
  // on it would be wrong without anything saying so.
  if (delay < AAC_FRAME || delay > 8 * AAC_FRAME) {
    throw new Error(`The audio encoder's start-up delay measured ${delay} samples, which can't be right; not writing a file whose sync can't be trusted.`)
  }
  return delay
}

export async function encodeLoopAudio(audio: LoopAudio, onProgress?: (done: number, total: number) => void): Promise<EncodedAudio> {
  const problem = await audioProblem(audio)
  if (problem) throw new Error(problem)
  const delay = await measureDelay(audio)
  const length = audio.pcm.length
  const { pad, mediaTime } = alignToPackets(delay, length)
  const padded = new Float32Array(pad + length)
  padded.set(audio.pcm, pad)
  const { frames, asc } = await encode({ ...audio, pcm: padded }, onProgress)
  if (frames.length * AAC_FRAME < mediaTime + length) {
    throw new Error(`The audio encoder returned ${frames.length} frames, too few to hold the loop.`)
  }
  return { frames, asc, sampleRate: audio.sampleRate, channels: audio.channels, bitrate: AAC_BITRATE, delay: mediaTime, length }
}
