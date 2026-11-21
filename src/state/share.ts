/**
 * Share links: the whole setup, written into a URL.
 *
 * The outputs, the pattern and every setting go into the link's fragment
 * (`#share=…`), so another machine opening it gets the same pattern on the same
 * rasters. A fragment never leaves the browser, so nothing is uploaded: the
 * server serves the page and never sees the setup.
 *
 * The token is JSON, DEFLATEd and base64url'd. Settings are carried as the
 * difference from DEFAULT_SETTINGS, which keeps a link to plain bars a few
 * dozen characters long. The cost: changing a default changes what an existing
 * link shows for that setting. Outputs are carried whole, cabinet maps
 * included, since a pattern without its rasters is not the same pattern.
 *
 * What a link cannot carry is the picture (the image pattern, or a card's
 * centre). `usesPicture` says when a setup needs one, so the UI can say so.
 */

import type { Output, PatternKind, PatternSettings, RenderMode } from '../types'
import { DEFAULT_SETTINGS } from './defaults'
import { diff, mergeKnown, type DeepPartial } from './merge'
import { PATTERN_LABELS } from '../patterns/render'
import type { Setup } from './store'

export const SHARE_VERSION = 1

/** The fragment key: `#share=<token>`. */
const KEY = 'share'

/** What decompresses past this is refused: a link is not a way to fill a tab's memory. */
const MAX_JSON_BYTES = 16 * 1024 * 1024

const DEFAULT_PROJECT = 'test-card'

type Payload = {
  v: number
  /** Settings, as the difference from the defaults. */
  s?: DeepPartial<PatternSettings>
  o?: Output[]
  p?: string
  c?: { widthPx: number; heightPx: number }
  m?: RenderMode
  /** The import's warnings, so whoever opens it sees the same caveats. */
  w?: string[]
}

export type Shared = { setup: Setup; warnings: string[] }

export class ShareLinkError extends Error {}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

export async function encodeShare(setup: Setup, warnings: string[] = []): Promise<string> {
  const payload: Payload = { v: SHARE_VERSION }
  const s = diff(DEFAULT_SETTINGS, setup.settings)
  if (s) payload.s = s
  if (setup.outputs.length) payload.o = setup.outputs
  if (setup.projectName !== DEFAULT_PROJECT) payload.p = setup.projectName
  if (setup.composition) payload.c = setup.composition
  if (setup.mode !== 'per-output') payload.m = setup.mode
  if (warnings.length) payload.w = warnings
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  return toBase64Url(await deflate(bytes))
}

/** The page's own address with the token in its fragment. Any query string is dropped. */
export function shareUrl(pageHref: string, token: string): string {
  const url = new URL(pageHref)
  url.search = ''
  url.hash = `${KEY}=${token}`
  return url.toString()
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

/** The token in a `#share=…` fragment, or null when the fragment is something else. */
export function shareToken(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const token = params.get(KEY)
  return token ? token : null
}

export async function decodeShare(token: string): Promise<Shared> {
  let payload: unknown
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(await inflate(fromBase64Url(token)))
    payload = JSON.parse(json)
  } catch (err) {
    if (err instanceof ShareLinkError) throw err
    throw new ShareLinkError('The link is damaged or cut short: its setup could not be read.')
  }
  if (!isRecord(payload) || typeof payload.v !== 'number') {
    throw new ShareLinkError('That is not a Test Card share link.')
  }
  if (payload.v > SHARE_VERSION) {
    throw new ShareLinkError('The link was made by a newer Test Card. Reload the page to get it, then open the link again.')
  }
  if (payload.v !== SHARE_VERSION) throw new ShareLinkError('That is not a Test Card share link.')

  const settings = mergeKnown(DEFAULT_SETTINGS, payload.s ?? {})
  if (!Object.hasOwn(PATTERN_LABELS, settings.kind)) settings.kind = DEFAULT_SETTINGS.kind
  if (!Object.hasOwn(PATTERN_LABELS, settings.broken.base) || settings.broken.base === ('broken-wall' as PatternKind)) {
    settings.broken = { ...settings.broken, base: DEFAULT_SETTINGS.broken.base }
  }

  const outputs = payload.o ?? []
  if (!Array.isArray(outputs) || !outputs.every(isOutput)) {
    throw new ShareLinkError('The outputs in the link are damaged.')
  }
  const composition = isSize(payload.c) ? { widthPx: payload.c.widthPx, heightPx: payload.c.heightPx } : undefined
  const mode: RenderMode = payload.m === 'composition' && composition ? 'composition' : 'per-output'
  const projectName = typeof payload.p === 'string' && payload.p ? payload.p : DEFAULT_PROJECT
  const warnings = Array.isArray(payload.w) ? payload.w.filter((w): w is string => typeof w === 'string') : []

  return { setup: { outputs, settings, projectName, composition, mode }, warnings }
}

// ---------------------------------------------------------------------------
// What a link can't carry
// ---------------------------------------------------------------------------

/** Whether the pattern shows the loaded picture, which a link does not carry. */
export function usesPicture(settings: PatternSettings): boolean {
  const kind = settings.kind === 'broken-wall' ? settings.broken.base : settings.kind
  if (kind === 'image') return true
  return (kind === 'classic-card' || kind === 'av-sync') && settings.centre.content === 'image'
}

// ---------------------------------------------------------------------------
// Checks on what came out of a link
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'

function isSize(v: unknown): v is { widthPx: number; heightPx: number } {
  return isRecord(v) && isNum(v.widthPx) && isNum(v.heightPx) && v.widthPx > 0 && v.heightPx > 0
}

function isRect(v: unknown): boolean {
  return isRecord(v) && isNum(v.x) && isNum(v.y) && isNum(v.width) && isNum(v.height)
}

function isOutput(v: unknown): v is Output {
  if (!isRecord(v)) return false
  if (!isStr(v.id) || !isStr(v.name) || !isStr(v.rasterSource) || !isStr(v.source)) return false
  if (!isNum(v.widthPx) || !isNum(v.heightPx) || v.widthPx <= 0 || v.heightPx <= 0) return false
  if (typeof v.enabled !== 'boolean' || !Array.isArray(v.notes) || !Array.isArray(v.regions)) return false
  if (v.compositionRect !== undefined && !isRect(v.compositionRect)) return false
  if (v.pitchMm !== undefined && !isNum(v.pitchMm)) return false
  return v.regions.every(
    (r) => isRecord(r) && isStr(r.id) && isStr(r.label) && isRect(r.rect) && (r.input === undefined || isRect(r.input)),
  )
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_JSON_BYTES) {
      await reader.cancel()
      throw new ShareLinkError('The link holds more than a setup could need, so it was not opened.')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  // In slices: String.fromCharCode with a whole cabinet map spread into it overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
