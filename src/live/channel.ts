/**
 * How the editor and its live windows talk: a BroadcastChannel, nothing else.
 *
 * Live windows are opened with `noopener`, so neither side holds a reference
 * to the other. The editor learns a window is there when it reports in, and a
 * window that stops reporting is gone. An editor that is reloaded asks, and
 * the windows still open answer.
 */

import type { LiveScaling, LiveSource, Size } from './plan'

export const LIVE_CHANNEL = 'test-card/live'

/**
 * How often a live window reports, and how long the editor waits before calling
 * it gone. Generous: a window drawing a huge still can be busy for seconds, and
 * one that really closes says so (`bye`) on its way out.
 */
export const REPORT_MS = 1000
export const GONE_MS = 10_000
/**
 * How long a window just asked for has to report in before the panel says it
 * didn't open, and offers Go live again for its display. A window reports as
 * soon as it has loaded, usually inside a second; much longer and the person
 * waiting for the next display's window is held up for nothing.
 */
export const OPEN_WAIT_MS = 2500

export type LiveStatus = {
  id: string
  screenKey: string
  screenLabel: string
  source: LiveSource
  scaling: LiveScaling
  /** What it is showing, by name, or null when that has gone from the editor. */
  showing: string | null
  raster: Size | null
  /** The window's canvas in device pixels. */
  device: Size
  /** As `describePlacement` puts it. */
  placement: string
  fullscreen: boolean
  /** Frames drawn a second, for a moving pattern; null for a still. */
  fps: number | null
  /** Why it is not showing the pattern, if it is not. */
  problem: string | null
  /**
   * `off`: not the window the sound comes from. `silent`: it is, but the
   * pattern has none. `waiting`: for a click in the window, which a browser
   * needs before it will play anything.
   */
  sound: 'off' | 'silent' | 'waiting' | 'on' | 'muted' | 'failed'
  /** Holding a wake lock, so the display will not sleep. */
  awake: boolean
}

export type LiveMessage =
  // Editor to windows.
  | { type: 'ping' }
  | { type: 'close'; id?: string }
  | { type: 'set'; id?: string; source?: LiveSource; scaling?: LiveScaling; muted?: boolean }
  // Windows to editor.
  | { type: 'status'; status: LiveStatus }
  | { type: 'bye'; id: string }

export type LiveChannel = { post: (m: LiveMessage) => void; close: () => void }

/** Null where there is no BroadcastChannel, in which case live windows run unsupervised. */
export function openLiveChannel(onMessage: (m: LiveMessage) => void): LiveChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  const ch = new BroadcastChannel(LIVE_CHANNEL)
  ch.onmessage = (e: MessageEvent<LiveMessage>) => {
    if (e.data && typeof e.data === 'object' && 'type' in e.data) onMessage(e.data)
  }
  return {
    post: (m) => ch.postMessage(m),
    close: () => ch.close(),
  }
}
