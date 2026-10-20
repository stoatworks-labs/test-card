import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { BT709, buildMp4, type Mp4Sample } from './mp4'

/**
 * The fixture is a real libx264 stream (scripts/make-h264-fixture.sh): 20
 * frames of 64x48 at 10 fps, a keyframe every 5, no B-frames, an AUD before
 * each access unit. These tests turn it into the shape WebCodecs hands over —
 * AVCC samples and an avcC record — mux it, and then check the file two ways:
 * by reading the boxes back, and, where ffmpeg is installed, by asking ffprobe
 * and comparing ffmpeg's decode of the MP4 against its decode of the raw stream.
 */

const FIXTURE = join(__dirname, '../../test/fixtures/h264-64x48.h264')

function nalUnits(bytes: Uint8Array): Uint8Array[] {
  const starts: { at: number; len: number }[] = []
  for (let i = 0; i + 3 <= bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0) {
      if (bytes[i + 2] === 1) {
        starts.push({ at: i, len: 3 })
        i += 2
      } else if (bytes[i + 2] === 0 && bytes[i + 3] === 1) {
        starts.push({ at: i, len: 4 })
        i += 3
      }
    }
  }
  return starts.map((s, k) => bytes.subarray(s.at + s.len, k + 1 < starts.length ? starts[k + 1]!.at : bytes.length))
}

function fromAnnexB(bytes: Uint8Array): { samples: Mp4Sample[]; avcC: Uint8Array } {
  const nals = nalUnits(bytes)
  const sps = nals.find((n) => (n[0]! & 0x1f) === 7)!
  const pps = nals.find((n) => (n[0]! & 0x1f) === 8)!
  const avcC = new Uint8Array([
    1, sps[1]!, sps[2]!, sps[3]!, 0xff, 0xe1, sps.length >> 8, sps.length & 0xff, ...sps,
    1, pps.length >> 8, pps.length & 0xff, ...pps,
  ])
  const units: Uint8Array[][] = []
  for (const n of nals) {
    const type = n[0]! & 0x1f
    if (type === 9) units.push([])
    else if (type !== 7 && type !== 8) units[units.length - 1]!.push(n)
  }
  const samples = units.map((nals) => {
    const size = nals.reduce((a, n) => a + 4 + n.length, 0)
    const data = new Uint8Array(size)
    let o = 0
    for (const n of nals) {
      new DataView(data.buffer).setUint32(o, n.length)
      data.set(n, o + 4)
      o += 4 + n.length
    }
    return { data, key: nals.some((n) => (n[0]! & 0x1f) === 5) }
  })
  return { samples, avcC }
}

type Box = { type: string; start: number; size: number; body: Uint8Array; children?: Box[] }
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf'])

function parse(buf: Uint8Array, from = 0, to = buf.length): Box[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const out: Box[] = []
  let at = from
  while (at + 8 <= to) {
    const size = view.getUint32(at)
    const type = String.fromCharCode(...buf.subarray(at + 4, at + 8))
    const box: Box = { type, start: at, size, body: buf.subarray(at + 8, at + size) }
    if (CONTAINERS.has(type)) box.children = parse(buf, at + 8, at + size)
    out.push(box)
    at += size
  }
  return out
}

function find(boxes: Box[], path: string[]): Box {
  let level = boxes
  let found: Box | undefined
  for (const type of path) {
    found = level.find((b) => b.type === type)
    if (!found) throw new Error(`no ${type} in ${path.join('/')}`)
    level = found.children ?? []
  }
  return found!
}

const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at)

const raw = new Uint8Array(readFileSync(FIXTURE))
const { samples, avcC } = fromAnnexB(raw)
const mp4 = buildMp4(samples, {
  width: 64,
  height: 48,
  timescale: 10000,
  sampleDuration: 1000,
  avcC,
  colour: { ...BT709, fullRange: false },
})
const boxes = parse(mp4)
const STBL = ['moov', 'trak', 'mdia', 'minf', 'stbl']

describe('buildMp4 — structure', () => {
  it('the fixture really is 20 frames with a keyframe every 5', () => {
    expect(samples).toHaveLength(20)
    expect(samples.map((s, i) => (s.key ? i : -1)).filter((i) => i >= 0)).toEqual([0, 5, 10, 15])
  })

  it('puts ftyp, then moov, then mdat — the index before the data', () => {
    expect(boxes.map((b) => b.type)).toEqual(['ftyp', 'moov', 'mdat'])
    expect(boxes.reduce((n, b) => n + b.size, 0)).toBe(mp4.length)
  })

  it('has the whole sample table', () => {
    expect(find(boxes, STBL).children!.map((b) => b.type)).toEqual(['stsd', 'stts', 'stss', 'stsc', 'stsz', 'stco'])
  })

  it('times every frame the same and totals the right duration', () => {
    const stts = find(boxes, [...STBL, 'stts']).body
    expect(u32(stts, 4)).toBe(1)
    expect(u32(stts, 8)).toBe(20)
    expect(u32(stts, 12)).toBe(1000)
    const mdhd = find(boxes, ['moov', 'trak', 'mdia', 'mdhd']).body
    expect(u32(mdhd, 12)).toBe(10000)
    expect(u32(mdhd, 16)).toBe(20000)
    const mvhd = find(boxes, ['moov', 'mvhd']).body
    expect(u32(mvhd, 16)).toBe(2000) // ms
  })

  it('lists exactly the keyframes as sync samples, 1-based', () => {
    const stss = find(boxes, [...STBL, 'stss']).body
    const n = u32(stss, 4)
    expect(Array.from({ length: n }, (_, i) => u32(stss, 8 + i * 4))).toEqual([1, 6, 11, 16])
  })

  it('points every chunk offset at that sample’s bytes, at its size', () => {
    const stsz = find(boxes, [...STBL, 'stsz']).body
    const stco = find(boxes, [...STBL, 'stco']).body
    expect(u32(stsz, 8)).toBe(20)
    for (let i = 0; i < 20; i++) {
      const size = u32(stsz, 12 + i * 4)
      const offset = u32(stco, 8 + i * 4)
      expect(size).toBe(samples[i]!.data.length)
      expect(Array.from(mp4.subarray(offset, offset + size))).toEqual(Array.from(samples[i]!.data))
    }
  })

  it('labels the colour as BT.709, limited range', () => {
    const stsd = find(boxes, [...STBL, 'stsd']).body
    const at = Array.from(stsd).findIndex((_, i) => String.fromCharCode(...stsd.subarray(i, i + 4)) === 'colr')
    expect(at).toBeGreaterThan(0)
    const colr = stsd.subarray(at + 4)
    expect(String.fromCharCode(...colr.subarray(0, 4))).toBe('nclx')
    expect([colr[4]! * 256 + colr[5]!, colr[6]! * 256 + colr[7]!, colr[8]! * 256 + colr[9]!]).toEqual([1, 1, 1])
    expect(colr[10]! & 0x80).toBe(0)
  })

  it('refuses a loop that does not start on a keyframe, or has no frames', () => {
    const opts = { width: 64, height: 48, timescale: 10000, sampleDuration: 1000, avcC }
    expect(() => buildMp4(samples.slice(1), opts)).toThrow(/keyframe/)
    expect(() => buildMp4([], opts)).toThrow(/No video frames/)
  })
})

function has(cmd: string): boolean {
  try {
    execFileSync(cmd, ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const dirs: string[] = []
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

// ffmpeg is not a dependency of this repo, so these skip without it — but on a
// machine that has it they are the real proof: a third party reads the file.
describe.skipIf(!has('ffprobe') || !has('ffmpeg'))('buildMp4 — read by ffmpeg', () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-card-mp4-'))
  dirs.push(dir)
  const file = join(dir, 'out.mp4')
  writeFileSync(file, mp4)

  it('ffprobe sees one 64x48 H.264 stream, 20 frames, 2 s, BT.709 limited range', () => {
    const json = JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file]).toString(),
    )
    const s = json.streams[0]
    expect(json.streams).toHaveLength(1)
    expect(s.codec_name).toBe('h264')
    expect([s.width, s.height]).toEqual([64, 48])
    expect(Number(s.nb_read_frames)).toBe(20)
    expect(Number(json.format.duration)).toBeCloseTo(2, 6)
    expect(s.r_frame_rate).toBe('10/1')
    expect(s.color_primaries).toBe('bt709')
    expect(s.color_range).toBe('tv')
  })

  it('decodes to exactly the frames the raw stream decodes to', () => {
    const md5 = (input: string, ...pre: string[]) =>
      execFileSync('ffmpeg', ['-v', 'error', ...pre, '-i', input, '-f', 'framemd5', '-'])
        .toString()
        .split('\n')
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => l.split(',').pop()!.trim())
    const fromMp4 = md5(file)
    expect(fromMp4).toHaveLength(20)
    expect(fromMp4).toEqual(md5(FIXTURE, '-f', 'h264'))
  })
})
