/**
 * The editor's view of its live windows: the ones that have reported in
 * lately, kept in a store of their own so a report a second from each window
 * re-renders the live panel and not the whole app.
 */

import { create } from 'zustand'
import { GONE_MS, openLiveChannel, type LiveMessage, type LiveStatus } from './channel'

type LiveState = {
  windows: LiveStatus[]
  /** False where there is no BroadcastChannel: windows open, but cannot be listed or steered. */
  supervised: boolean
  post: (m: LiveMessage) => void
}

export const useLiveWindows = create<LiveState>(() => ({ windows: [], supervised: false, post: () => {} }))

/** Starts listening; returns the way to stop. Call once, from the app. */
export function superviseLiveWindows(): () => void {
  const seen = new Map<string, { status: LiveStatus; at: number }>()
  const publish = () => useLiveWindows.setState({ windows: [...seen.values()].map((v) => v.status) })
  const ch = openLiveChannel((m) => {
    if (m.type === 'status') {
      seen.set(m.status.id, { status: m.status, at: performance.now() })
      publish()
    } else if (m.type === 'bye') {
      if (seen.delete(m.id)) publish()
    }
  })
  if (!ch) return () => {}
  useLiveWindows.setState({ supervised: true, post: ch.post })
  // Windows opened before this page was (re)loaded say so when asked.
  ch.post({ type: 'ping' })
  const sweep = window.setInterval(() => {
    const now = performance.now()
    let gone = false
    for (const [id, v] of seen) {
      if (now - v.at > GONE_MS) {
        seen.delete(id)
        gone = true
      }
    }
    if (gone) publish()
  }, 1000)
  return () => {
    window.clearInterval(sweep)
    ch.close()
    useLiveWindows.setState({ windows: [], supervised: false, post: () => {} })
  }
}
