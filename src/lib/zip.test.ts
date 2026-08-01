import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildZip, crc32, uniqueNames } from './zip'

const dirs: string[] = []
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'test-card-zip-'))
  dirs.push(d)
  return d
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const enc = (s: string) => new TextEncoder().encode(s)

describe('crc32', () => {
  it('matches the published check value for "123456789"', () => {
    // The standard CRC-32/ISO-HDLC check vector.
    expect(crc32(enc('123456789'))).toBe(0xcbf43926)
  })

  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  it('matches a known value for a longer string', () => {
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339)
  })
})

describe('buildZip', () => {
  it('writes the PK signature and a matching entry count', () => {
    const zip = buildZip([{ name: 'a.txt', data: enc('hello') }])
    expect(Array.from(zip.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04])
    // End-of-central-directory entry count is the last-but-two u16 pair.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const eocd = zip.byteLength - 22
    expect(view.getUint32(eocd, true)).toBe(0x06054b50)
    expect(view.getUint16(eocd + 8, true)).toBe(1)
  })

  it('produces an archive the system unzip accepts and extracts correctly', () => {
    const dir = scratch()
    const entries = [
      { name: 'smpte/output-1.png', data: enc('first file contents') },
      { name: 'smpte/output-2.png', data: new Uint8Array([0, 1, 2, 255, 254, 0, 0, 7]) },
      { name: 'readme.txt', data: enc('third') },
    ]
    const path = join(dir, 'out.zip')
    writeFileSync(path, buildZip(entries))

    // -t verifies every CRC in the archive.
    const test = execFileSync('unzip', ['-t', path], { encoding: 'utf8' })
    expect(test).toContain('No errors detected')

    execFileSync('unzip', ['-q', path, '-d', join(dir, 'x')])
    for (const e of entries) {
      const got = new Uint8Array(readFileSync(join(dir, 'x', e.name)))
      expect(Array.from(got), e.name).toEqual(Array.from(e.data))
    }
  })

  it('round-trips non-ASCII filenames, with the UTF-8 flag set', () => {
    const dir = scratch()
    const name = 'Bühne-Süd — Écran 2.png'
    const path = join(dir, 'utf8.zip')
    writeFileSync(path, buildZip([{ name, data: enc('x') }]))

    // Verified with Python's zipfile, NOT the system unzip. macOS ships
    // Info-ZIP 6.00 (2009), which ignores the general-purpose UTF-8 flag
    // (bit 11) altogether: it transliterates the name to the process charset,
    // prints "B++hne-S++d ??? +?cran", and then refuses to extract at all with
    // "Illegal byte sequence" — regardless of LC_ALL. That is a limitation of
    // that binary, not of the archive, so asserting against it would be
    // asserting the wrong thing. Anything with modern Unicode support (Python,
    // Finder's Archive Utility, 7-Zip, Windows Explorer) reads it correctly.
    const script = `
import json, zipfile
z = zipfile.ZipFile(${JSON.stringify(path)})
print(json.dumps({
    "names": z.namelist(),
    "flags": [i.flag_bits for i in z.infolist()],
    "bad": z.testzip(),
}))
`
    const out = JSON.parse(
      execFileSync('python3', ['-c', script], { encoding: 'utf8' }),
    ) as { names: string[]; flags: number[]; bad: string | null }

    expect(out.names).toEqual([name])
    expect(out.bad).toBeNull()
    expect(out.flags[0]! & 0x0800).toBe(0x0800)
  })

  it('writes a structurally valid empty archive', () => {
    const dir = scratch()
    const path = join(dir, 'empty.zip')
    const zip = buildZip([])
    writeFileSync(path, zip)
    // A zero-entry archive is just the end-of-central-directory record.
    expect(zip.length).toBe(22)
    // unzip reports "zipfile is empty" and exits 1 — a warning about content,
    // not a structural complaint. Anything else means a malformed archive.
    try {
      execFileSync('unzip', ['-t', path], { encoding: 'utf8', stdio: 'pipe' })
      throw new Error('expected unzip to warn about an empty archive')
    } catch (err) {
      const e = err as { status?: number; stdout?: string }
      expect(e.status).toBe(1)
      expect(e.stdout).toContain('zipfile is empty')
    }
  })

  it('refuses to write more entries than ZIP can address', () => {
    const many = Array.from({ length: 65536 }, (_, i) => ({
      name: `f${i}`,
      data: new Uint8Array(0),
    }))
    expect(() => buildZip(many)).toThrow(/ZIP64/)
  })
})

describe('uniqueNames', () => {
  it('leaves distinct names alone', () => {
    expect(uniqueNames(['a.png', 'b.png'])).toEqual(['a.png', 'b.png'])
  })

  it('suffixes collisions before the extension', () => {
    // Resolume routinely produces several screens all called "Screen".
    expect(uniqueNames(['Screen.png', 'Screen.png', 'Screen.png'])).toEqual([
      'Screen.png',
      'Screen-2.png',
      'Screen-3.png',
    ])
  })

  it('treats names case-insensitively, since macOS and Windows do', () => {
    expect(uniqueNames(['Out.png', 'out.png'])).toEqual(['Out.png', 'out-2.png'])
  })

  it('suffixes extensionless names at the end', () => {
    expect(uniqueNames(['out', 'out'])).toEqual(['out', 'out-2'])
  })
})
