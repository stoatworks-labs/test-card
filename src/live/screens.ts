/**
 * The displays this computer has, from the Window Management API.
 *
 * Chrome and Edge only, on https or localhost, and behind a permission the
 * browser asks for ("manage windows on all your displays"). Without it a page
 * can neither list the displays nor put a window on any but its own, so every
 * caller has a way through that needs none of this: open a window here, drag
 * it to the display, click it.
 *
 * TypeScript's DOM library does not have this API yet, hence the types below.
 * They describe only what is read.
 */

type ScreenDetailed = {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
  readonly availLeft: number
  readonly availTop: number
  readonly availWidth: number
  readonly availHeight: number
  readonly devicePixelRatio: number
  readonly isPrimary: boolean
  readonly isInternal: boolean
  readonly label: string
}

type ScreenDetails = EventTarget & {
  readonly screens: readonly ScreenDetailed[]
  readonly currentScreen: ScreenDetailed
}

type WindowWithScreens = Window & { getScreenDetails?: () => Promise<ScreenDetails> }

export type ScreenInfo = {
  /** Label and position: displays have no id, and two can share a label. */
  key: string
  label: string
  /** Where it is and how big, in the CSS pixels the OS lays displays out in. */
  left: number
  top: number
  width: number
  height: number
  /** Not under a menu bar, dock or taskbar: where a window can be put. */
  avail: { left: number; top: number; width: number; height: number }
  devicePixelRatio: number
  /**
   * Its raster in device pixels: what a full-screen window on it measures. The
   * browser gives sizes in CSS pixels, so at a fractional scale (125%, 150% on
   * Windows) this is only right to a pixel or so, and `rasterExact` is false.
   * On a Mac at a scaled resolution it's what macOS draws, which it then shrinks
   * to the signal: the browser can't see the signal at all.
   */
  rasterWidth: number
  rasterHeight: number
  rasterExact: boolean
  primary: boolean
  internal: boolean
  /** The display the editor is on. */
  current: boolean
}

export type ScreenAccess =
  /** Not Chrome or Edge. */
  | 'unsupported'
  /** Plain http to another machine: the API exists only on https and localhost. */
  | 'insecure'
  | 'prompt'
  | 'granted'
  | 'denied'

export async function screenAccess(): Promise<ScreenAccess> {
  if (!('getScreenDetails' in window)) return window.isSecureContext ? 'unsupported' : 'insecure'
  try {
    const p = await navigator.permissions.query({ name: 'window-management' as PermissionName })
    return p.state
  } catch {
    // Older Chromes called it window-placement; either way, asking will tell.
    return 'prompt'
  }
}

function describe(s: ScreenDetailed, current: ScreenDetailed, i: number): ScreenInfo {
  const label = s.label.trim() || (s.isInternal ? 'Built-in display' : `Display ${i + 1}`)
  return {
    key: `${label}@${s.left},${s.top}`,
    label,
    left: s.left,
    top: s.top,
    width: s.width,
    height: s.height,
    avail: { left: s.availLeft, top: s.availTop, width: s.availWidth, height: s.availHeight },
    devicePixelRatio: s.devicePixelRatio,
    rasterWidth: Math.round(s.width * s.devicePixelRatio),
    rasterHeight: Math.round(s.height * s.devicePixelRatio),
    rasterExact: Number.isInteger(s.devicePixelRatio),
    primary: s.isPrimary,
    internal: s.isInternal,
    current: s === current,
  }
}

/**
 * Lists the displays, asking for permission the first time, and calls
 * `onChange` whenever one is plugged in, unplugged or rearranged, or the editor
 * moves to another. Rejects if the browser refuses.
 */
export async function watchScreens(onChange: (screens: ScreenInfo[]) => void): Promise<() => void> {
  const get = (window as WindowWithScreens).getScreenDetails
  if (!get) throw new Error('This browser cannot list displays.')
  const details = await get.call(window)
  const read = () =>
    onChange(
      // Left to right, then top to bottom: the order they sit on the desk.
      [...details.screens]
        .sort((a, b) => a.left - b.left || a.top - b.top)
        .map((s, i) => describe(s, details.currentScreen, i)),
    )
  details.addEventListener('screenschange', read)
  details.addEventListener('currentscreenchange', read)
  read()
  return () => {
    details.removeEventListener('screenschange', read)
    details.removeEventListener('currentscreenchange', read)
  }
}
