/**
 * Live output: the parts that are only arithmetic.
 *
 * A live window is a page of its own (`/?live=…`), opened by the editor onto
 * one display and made full screen by a click in it. It is NOT drawn into by
 * the editor: it reads the same saved state the editor writes, and follows it.
 * So it keeps going when the editor tab is reloaded, discarded or closed, and
 * a reload of the live window itself comes back showing the same thing, which
 * on a show day is the property that matters.
 *
 * Everything here is pure, so the decisions a live window makes about where
 * its raster goes are tested without a window: which source a display gets by
 * default, how a raster is placed on a canvas of another size, and what time
 * a moving pattern is at.
 */

/** What a live window shows. */
export type LiveSource =
  | { kind: 'output'; id: string }
  | { kind: 'composition' }
  /**
   * A raster the size of the window's own canvas in device pixels, which is
   * the display's own raster once the window is full screen: always 1:1, with
   * no output needed. The burn-in says what size it came out.
   */
  | { kind: 'display' }

/**
 * `fit` scales the raster to fill the window (1:1 when the sizes match);
 * `pixels` never scales and puts the raster's top-left corner at the window's,
 * which is where any output reads from.
 */
export type LiveScaling = 'fit' | 'pixels'

export type LiveParams = {
  id: string
  source: LiveSource
  scaling: LiveScaling
  /** The display the editor opened it for. Only a label: the window can be dragged anywhere. */
  screenKey: string
  screenLabel: string
  /** This window plays the pattern's sound, when the pattern has any. One window at most. */
  sound: boolean
  /** Its sound is muted from the editor. In the URL so a reload doesn't unmute it. */
  muted: boolean
}

export function sourceToString(s: LiveSource): string {
  return s.kind === 'output' ? `output:${s.id}` : s.kind
}

export function sourceFromString(v: string | null | undefined): LiveSource | null {
  if (!v) return null
  if (v === 'composition' || v === 'display') return { kind: v }
  if (v.startsWith('output:') && v.length > 'output:'.length) return { kind: 'output', id: v.slice('output:'.length) }
  return null
}

export function sameSource(a: LiveSource, b: LiveSource): boolean {
  return sourceToString(a) === sourceToString(b)
}

/** The page a live window opens, relative to the app's own URL. */
export function liveUrl(base: string, p: LiveParams): string {
  const url = new URL(base)
  url.hash = ''
  url.search = new URLSearchParams({
    live: p.id,
    src: sourceToString(p.source),
    fit: p.scaling,
    screen: p.screenKey,
    label: p.screenLabel,
    ...(p.sound ? { sound: '1' } : {}),
    ...(p.muted ? { mute: '1' } : {}),
  }).toString()
  return url.toString()
}

/** Null when the page is not a live window, so the editor loads instead. */
export function parseLiveParams(search: string): LiveParams | null {
  const q = new URLSearchParams(search)
  const id = q.get('live')
  if (!id) return null
  return {
    id,
    source: sourceFromString(q.get('src')) ?? { kind: 'display' },
    scaling: q.get('fit') === 'pixels' ? 'pixels' : 'fit',
    screenKey: q.get('screen') ?? '',
    screenLabel: q.get('label') ?? '',
    sound: q.get('sound') === '1',
    muted: q.get('mute') === '1',
  }
}

export type Size = { width: number; height: number }

export type Placement = {
  /** Device pixels per raster pixel. */
  scale: number
  /** Where the raster's top-left corner lands, in the window's device pixels. */
  x: number
  y: number
  /** The raster's drawn size, in device pixels. */
  width: number
  height: number
  /** Some of the raster is beyond the window's edge. Only `pixels` crops. */
  cropped: boolean
}

export function placeRaster(raster: Size, device: Size, scaling: LiveScaling): Placement {
  const same = raster.width === device.width && raster.height === device.height
  if (scaling === 'pixels' || same) {
    return {
      scale: 1,
      x: 0,
      y: 0,
      width: raster.width,
      height: raster.height,
      cropped: raster.width > device.width || raster.height > device.height,
    }
  }
  const scale = Math.min(device.width / raster.width, device.height / raster.height)
  const width = Math.round(raster.width * scale)
  const height = Math.round(raster.height * scale)
  return {
    scale,
    x: Math.floor((device.width - width) / 2),
    y: Math.floor((device.height - height) / 2),
    width,
    height,
    cropped: false,
  }
}

/** How a placement reads in the window's info and the editor's list. */
export function describePlacement(p: Placement): string {
  if (p.scale === 1) return p.cropped ? '1:1, cropped' : '1:1'
  // Near 100% it's a row or column in a thousand, which rounding would hide.
  const pct = p.scale * 100
  return `scaled ${Math.abs(pct - 100) < 0.5 ? pct.toFixed(1) : Math.round(pct)}%`
}

/**
 * Where a moving pattern is in its loop, from the computer's clock.
 *
 * Every live window works it out from the same clock rather than from when it
 * was opened, so two windows showing a pattern that carries on across outputs
 * stay in step with each other, and a window opened later joins in phase.
 */
export function liveTime(unixMs: number, loopSeconds: number): number {
  const t = (unixMs / 1000) % loopSeconds
  return t < 0 ? t + loopSeconds : t
}

/**
 * A display as the default-source choice needs it. `slack` is how many pixels
 * either way its raster may be out: a browser reports a display in CSS pixels,
 * so at a fractional scale (150% on Windows) the device-pixel size is only known
 * to a pixel or so.
 */
export type DisplayRaster = Size & { key: string; current: boolean; slack: number }

/** Something a display could show, in the order it should be offered. */
export type Candidate = Size & { source: LiveSource }

/**
 * Which source each display gets before anyone chooses.
 *
 * An output whose raster is exactly a display's goes to that display first,
 * since that is almost certainly the output it is. Then the rest go in order,
 * other displays before the one the editor is on, and a display with nothing
 * left over matches its own raster. No candidate is given to two displays.
 */
export function defaultSources(displays: DisplayRaster[], candidates: Candidate[]): Map<string, LiveSource> {
  const order = [...displays.filter((d) => !d.current), ...displays.filter((d) => d.current)]
  const taken = new Set<number>()
  const out = new Map<string, LiveSource>()
  for (const d of order) {
    const fits = (c: Candidate) => Math.abs(c.width - d.width) <= d.slack && Math.abs(c.height - d.height) <= d.slack
    const i = candidates.findIndex((c, j) => !taken.has(j) && fits(c))
    if (i >= 0) {
      taken.add(i)
      out.set(d.key, candidates[i]!.source)
    }
  }
  for (const d of order) {
    if (out.has(d.key)) continue
    const i = candidates.findIndex((_, j) => !taken.has(j))
    if (i >= 0) {
      taken.add(i)
      out.set(d.key, candidates[i]!.source)
    } else {
      out.set(d.key, { kind: 'display' })
    }
  }
  return out
}

/**
 * The `window.open` features that put a live window over a display.
 *
 * Its usable area, not its full bounds: a window is kept below a menu bar or
 * above a taskbar anyway, and full screen takes the rest. `noopener` gives the
 * window a page of its own to run in, so several moving patterns are not all
 * drawn on the editor's one thread, and nothing ties it to the editor tab.
 */
export function windowFeatures(area?: { left: number; top: number; width: number; height: number }): string {
  const base = 'popup,noopener'
  if (!area) return `${base},width=960,height=540`
  const r = (n: number) => Math.round(n)
  return `${base},left=${r(area.left)},top=${r(area.top)},width=${r(area.width)},height=${r(area.height)}`
}
