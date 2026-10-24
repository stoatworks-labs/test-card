/**
 * A live window's sound: the pattern's own loop (AV sync's beeps), played in
 * step with the picture.
 *
 * Every live window takes its picture's time from the computer's clock (see
 * `liveTime` and clock.ts). The sound comes out on the audio device's clock,
 * which runs a little fast or slow against that one, so a buffer simply set
 * looping would wander away from the picture, a few milliseconds every minute
 * or so. Instead
 * every pass of the loop is started on its own, at the moment the computer's
 * clock says that pass begins, mapped onto the audio clock through
 * `getOutputTimestamp`. The two can only wander apart within one loop, and the
 * seam where they are put back together is silent: AV sync keeps its first and
 * last half second quiet for the MP4's sake, and it serves here too.
 *
 * What this does not know is how long the browser takes to get a frame onto
 * the screen, or what the audio device adds beyond what it reports. Neither has
 * been measured, which is why the guide sends anyone measuring a system to the
 * MP4.
 */

import type { LoopAudio } from '../lib/audio'
import { unixMs } from './clock'

/** How far ahead a pass is put in the audio device's queue. */
const LEAD_S = 1.5
/** How often to look for the next pass to queue. Well under LEAD_S, so a throttled timer still makes it. */
const TICK_MS = 250

const unixNow = () => unixMs() / 1000

export class LiveSound {
  private readonly buffer: AudioBuffer
  private readonly sources = new Set<AudioBufferSourceNode>()
  private timer = 0
  /** The last pass queued, by its index on the computer's clock. */
  private queued = -Infinity

  constructor(
    private readonly ctx: AudioContext,
    audio: LoopAudio,
    private readonly loopSeconds: number,
  ) {
    // The loop's one channel goes to every channel, as it does in the MP4.
    this.buffer = ctx.createBuffer(audio.channels, audio.pcm.length, audio.sampleRate)
    for (let c = 0; c < audio.channels; c++) this.buffer.copyToChannel(audio.pcm as Float32Array<ArrayBuffer>, c)
  }

  start() {
    // Join the pass that is already going, a moment from now.
    const at = unixNow() + 0.1
    const k = Math.floor(at / this.loopSeconds)
    this.play(this.contextTimeAt(at), at - k * this.loopSeconds)
    this.queued = k
    this.tick()
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
  }

  stop() {
    window.clearInterval(this.timer)
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // Never started, or already finished.
      }
    }
    this.sources.clear()
  }

  private tick() {
    const horizon = unixNow() + LEAD_S
    for (let k = this.queued + 1; k * this.loopSeconds <= horizon; k++) {
      this.play(this.contextTimeAt(k * this.loopSeconds), 0)
      this.queued = k
    }
  }

  private play(when: number, offset: number) {
    // Late (a throttled timer, a stalled tab): start now, that far in.
    const late = Math.max(0, this.ctx.currentTime - when)
    if (offset + late >= this.buffer.duration) return
    const src = this.ctx.createBufferSource()
    src.buffer = this.buffer
    src.connect(this.ctx.destination)
    src.onended = () => this.sources.delete(src)
    src.start(when + late, offset + late)
    this.sources.add(src)
  }

  /** The audio clock's time for the moment the computer's clock reads `unix` seconds, as heard. */
  private contextTimeAt(unix: number): number {
    const ts = this.ctx.getOutputTimestamp?.()
    if (ts?.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return ts.contextTime + (unix - unixMs(ts.performanceTime) / 1000)
    }
    // No timestamp until the device is running: the current time, less what it says it adds.
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0
    return this.ctx.currentTime + (unix - unixNow()) - latency
  }
}
