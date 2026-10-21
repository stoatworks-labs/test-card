import { describe, expect, it } from 'vitest'
import { AAC_FRAME, alignToPackets, peakIndex } from './audio'

/**
 * The encoding itself needs a browser's WebCodecs and is checked on real exports
 * (docs/NOTES.md). What can be checked here is the arithmetic the file's timing
 * rests on.
 */
describe('lining the sound up with AAC packets', () => {
  it('pads so priming, padding and the loop end exactly on a packet boundary, and skips the lot', () => {
    for (const delay of [1024, 2112, 2048, 1600]) {
      // 10 s at 48 kHz, 10.01 s (29.97), and 599 frames at 59.94.
      for (const length of [480000, 480480, 479679, 1, 1024]) {
        const { pad, mediaTime } = alignToPackets(delay, length)
        expect(pad).toBeGreaterThanOrEqual(0)
        expect(pad).toBeLessThan(AAC_FRAME)
        expect(mediaTime).toBe(delay + pad)
        expect((mediaTime + length) % AAC_FRAME).toBe(0)
      }
    }
  })

  it('adds nothing when it already lines up', () => {
    expect(alignToPackets(1024, 96000 + 256)).toEqual({ pad: 0, mediaTime: 1024 })
  })
})

describe('finding the click', () => {
  it('finds the loudest sample, whichever way up', () => {
    const pcm = new Float32Array(4096)
    pcm[100] = 0.3
    pcm[2112] = -0.9
    pcm[2113] = 0.5
    expect(peakIndex(pcm)).toBe(2112)
  })
})
