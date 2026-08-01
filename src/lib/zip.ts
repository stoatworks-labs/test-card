/**
 * A minimal ZIP writer, store-only (no compression).
 *
 * WHY HAND-ROLLED
 * ===============
 * The payload is always PNGs, which are already DEFLATE-compressed internally.
 * Running them through DEFLATE again buys ~0% and costs a dependency, so the
 * only method needed is "store". That makes the whole writer about a hundred
 * lines of well-specified structure, which is easier to verify than it is to
 * audit a third-party library — and it is covered by `zip.test.ts`, which checks
 * the CRC-32 against the published test vector and unpacks the output with the
 * system `unzip` to prove real tools accept it.
 *
 * Format: PKWARE APPNOTE 6.3.x, sections 4.3.7 (local header), 4.3.12 (central
 * directory) and 4.3.16 (end of central directory).
 *
 * NOT IMPLEMENTED: ZIP64. An archive is capped at 4 GiB and 65535 entries, and
 * `buildZip` throws rather than silently emitting a corrupt archive. A set of
 * test patterns will not come close — a 4K PNG of flat colour is a few hundred
 * kilobytes — but a silent overflow would be discovered on site, so it throws.
 */

const MAX_UINT32 = 0xffffffff
const MAX_ENTRIES = 0xffff

export type ZipEntry = {
  /** Path within the archive. Forward slashes; no leading slash. */
  name: string
  data: Uint8Array
}

/** CRC-32 (IEEE 802.3 polynomial, reflected 0xEDB88320) — what ZIP requires. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

/**
 * MS-DOS date/time, as ZIP has stored timestamps since 1989.
 *
 * Resolution is two seconds and there is no time zone, so this writes the
 * LOCAL time — which is what every other tool does and what a user expects to
 * see in Finder. Dates before 1980 are not representable and are clamped.
 */
function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getFullYear())
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  }
}

class ByteWriter {
  private parts: Uint8Array[] = []
  length = 0

  u16(v: number) {
    this.parts.push(new Uint8Array([v & 0xff, (v >>> 8) & 0xff]))
    this.length += 2
  }

  u32(v: number) {
    this.parts.push(
      new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]),
    )
    this.length += 4
  }

  bytes(b: Uint8Array) {
    this.parts.push(b)
    this.length += b.length
  }

  concat(): Uint8Array {
    const out = new Uint8Array(this.length)
    let at = 0
    for (const p of this.parts) {
      out.set(p, at)
      at += p.length
    }
    return out
  }
}

/**
 * Filenames are stored UTF-8 with the language-encoding flag (bit 11) set, so
 * non-ASCII screen names survive. Without that flag the name is interpreted as
 * CP437 and anything above ASCII is mojibake in the extracted filename.
 */
const UTF8_FLAG = 0x0800

export function buildZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(
      `ZIP is limited to ${MAX_ENTRIES} entries without ZIP64; got ${entries.length}.`,
    )
  }

  const { date, time } = dosDateTime(now)
  const encoder = new TextEncoder()
  const local = new ByteWriter()
  const central = new ByteWriter()
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name)
    const crc = crc32(entry.data)
    const size = entry.data.length

    if (offset > MAX_UINT32 || size > MAX_UINT32) {
      throw new Error('ZIP exceeds 4 GiB; ZIP64 is not implemented.')
    }

    // Local file header (0x04034b50)
    local.u32(0x04034b50)
    local.u16(20) // version needed: 2.0
    local.u16(UTF8_FLAG)
    local.u16(0) // method: store
    local.u16(time)
    local.u16(date)
    local.u32(crc)
    local.u32(size) // compressed
    local.u32(size) // uncompressed
    local.u16(nameBytes.length)
    local.u16(0) // extra field length
    local.bytes(nameBytes)
    local.bytes(entry.data)

    // Central directory file header (0x02014b50)
    central.u32(0x02014b50)
    central.u16(20) // version made by
    central.u16(20) // version needed
    central.u16(UTF8_FLAG)
    central.u16(0) // method: store
    central.u16(time)
    central.u16(date)
    central.u32(crc)
    central.u32(size)
    central.u32(size)
    central.u16(nameBytes.length)
    central.u16(0) // extra
    central.u16(0) // comment
    central.u16(0) // disk number start
    central.u16(0) // internal attributes
    central.u32(0) // external attributes
    central.u32(offset) // offset of local header
    central.bytes(nameBytes)

    offset = local.length
  }

  const centralBytes = central.concat()
  const end = new ByteWriter()
  // End of central directory (0x06054b50)
  end.u32(0x06054b50)
  end.u16(0) // this disk
  end.u16(0) // disk with central directory
  end.u16(entries.length)
  end.u16(entries.length)
  end.u32(centralBytes.length)
  end.u32(offset)
  end.u16(0) // comment length

  const localBytes = local.concat()
  const endBytes = end.concat()
  const out = new Uint8Array(localBytes.length + centralBytes.length + endBytes.length)
  out.set(localBytes, 0)
  out.set(centralBytes, localBytes.length)
  out.set(endBytes, localBytes.length + centralBytes.length)
  return out
}

/**
 * Make a set of names unique and filesystem-safe, preserving order.
 *
 * Two Resolume screens are routinely called the same thing ("Screen", "Screen"),
 * and a ZIP with duplicate names extracts to a single file with the last one
 * winning — silently losing a pattern. Collisions get a numeric suffix.
 */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((raw) => {
    const base = raw || 'output'
    const key = base.toLowerCase()
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    if (n === 0) return base
    const dot = base.lastIndexOf('.')
    return dot > 0
      ? `${base.slice(0, dot)}-${n + 1}${base.slice(dot)}`
      : `${base}-${n + 1}`
  })
}
