/**
 * Live output: the pattern, full screen, on the displays plugged into this computer.
 *
 * Lists the displays (Chrome and Edge, once allowed), gives each one an output,
 * the composition or its own raster, and opens a live window on every one that
 * is ticked. The windows are pages of their own (see live/plan.ts); this panel
 * only opens them, and steers the ones that report in over the live channel.
 *
 * Two things a page cannot do, so the panel says them instead: open more than
 * one window per click (unless the site is allowed pop-ups), and make a window
 * full screen from anywhere but a click in that window.
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { Output } from '../types'
import {
  defaultSources,
  liveUrl,
  sourceFromString,
  sourceToString,
  windowFeatures,
  type Candidate,
  type LiveParams,
  type LiveScaling,
  type LiveSource,
} from '../live/plan'
import { screenAccess, watchScreens, type ScreenAccess, type ScreenInfo } from '../live/screens'
import { OPEN_WAIT_MS, type LiveStatus } from '../live/channel'
import { useLiveWindows } from '../live/supervise'

type Opening = { id: string; screenKey: string; label: string; sound: boolean; at: number }

const newId = () => Math.random().toString(36).slice(2, 10)

function openWindow(p: LiveParams, area?: ScreenInfo['avail']) {
  // Null whether it opened or was blocked: `noopener` hides which. The window says when it is up.
  window.open(liveUrl(location.href, p), '_blank', windowFeatures(area))
}

function SourceSelect({
  value,
  onChange,
  outputs,
  composition,
  display,
}: {
  value: string
  onChange: (s: LiveSource) => void
  outputs: Output[]
  composition: { widthPx: number; heightPx: number } | undefined
  /** The display's raster, when it is known. */
  display?: { width: number; height: number }
}) {
  const known =
    value === 'display' || (value === 'composition' && composition) || outputs.some((o) => `output:${o.id}` === value)
  return (
    <select
      value={value}
      onChange={(e) => {
        const s = sourceFromString(e.target.value)
        if (s) onChange(s)
      }}
    >
      {!known ? (
        <option value={value} disabled>
          Gone from the list
        </option>
      ) : null}
      {outputs.map((o) => (
        <option key={o.id} value={`output:${o.id}`}>
          {o.name} — {o.widthPx} × {o.heightPx}
          {o.enabled ? '' : ' (off)'}
        </option>
      ))}
      {composition ? (
        <option value="composition">
          Whole composition — {composition.widthPx} × {composition.heightPx}
        </option>
      ) : null}
      <option value="display">
        The display’s own size{display ? ` — ${display.width} × ${display.height}` : ''}
      </option>
    </select>
  )
}

function describeWindow(w: LiveStatus): string {
  const bits = [w.fullscreen ? 'full screen' : 'not full screen yet: click it']
  if (w.placement) bits.push(w.placement)
  if (w.fps !== null) bits.push(`${w.fps.toFixed(0)} fps`)
  if (w.sound === 'on') bits.push('sound on')
  if (w.sound === 'waiting') bits.push('sound starts when you click it')
  if (w.sound === 'muted') bits.push('sound muted')
  if (w.sound === 'failed') bits.push('could not play the sound')
  if (!w.awake) bits.push('the display may sleep')
  return bits.join(' · ')
}

export function LivePanel({ onClose }: { onClose: () => void }) {
  const outputs = useStore((s) => s.outputs)
  const composition = useStore((s) => s.composition)
  const mode = useStore((s) => s.mode)
  const selectedId = useStore((s) => s.selectedId)
  const kind = useStore((s) => s.settings.kind)
  const { windows, post, supervised } = useLiveWindows()

  const [access, setAccess] = useState<ScreenAccess | null>(null)
  const [screens, setScreens] = useState<ScreenInfo[] | null>(null)
  const [refused, setRefused] = useState<string | null>(null)
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [scaling, setScaling] = useState<LiveScaling>(() => useLiveWindows.getState().windows[0]?.scaling ?? 'fit')
  const [opening, setOpening] = useState<Opening[]>([])
  const [now, setNow] = useState(() => performance.now())
  const stopWatching = useRef<(() => void) | null>(null)
  const asking = useRef(false)
  const mounted = useRef(true)

  const listen = async () => {
    // One watch, however many clicks, and none left running by a panel that has gone.
    if (stopWatching.current || asking.current) return
    asking.current = true
    try {
      const stop = await watchScreens(setScreens)
      if (!mounted.current) return stop()
      stopWatching.current = stop
      setAccess('granted')
      setRefused(null)
    } catch (err) {
      if (!mounted.current) return
      setAccess(await screenAccess())
      setRefused((err as Error).message || 'The browser refused.')
    } finally {
      asking.current = false
    }
  }
  useEffect(() => {
    mounted.current = true
    void screenAccess().then((a) => {
      if (!mounted.current) return
      setAccess(a)
      if (a === 'granted') void listen()
    })
    return () => {
      mounted.current = false
      stopWatching.current?.()
      stopWatching.current = null
    }
    // Once, on opening the panel; `listen` only ever starts one watch.
  }, [])

  // A window asked for is done with once it reports in, whatever happens to it after.
  useEffect(() => {
    setOpening((prev) => {
      const left = prev.filter((o) => !windows.some((w) => w.id === o.id))
      return left.length === prev.length ? prev : left
    })
  }, [windows])
  // Age the rest, so one that never turned up is reported.
  const waiting = opening.some((o) => now - o.at <= OPEN_WAIT_MS)
  useEffect(() => {
    if (!waiting) return
    const t = window.setInterval(() => setNow(performance.now()), 500)
    return () => window.clearInterval(t)
  }, [waiting])
  const reported = (o: Opening) => windows.some((w) => w.id === o.id)
  const young = (o: Opening) => !reported(o) && performance.now() - o.at <= OPEN_WAIT_MS

  const here = screens?.find((s) => s.current)?.label ?? null

  // What each display shows unless someone says otherwise.
  const enabled = outputs.filter((o) => o.enabled)
  const ordered = [...enabled.filter((o) => o.id === selectedId), ...enabled.filter((o) => o.id !== selectedId)]
  const candidates: Candidate[] = [
    ...(mode === 'composition' && composition
      ? [{ source: { kind: 'composition' } as const, width: composition.widthPx, height: composition.heightPx }]
      : []),
    ...ordered.map((o) => ({ source: { kind: 'output', id: o.id } as const, width: o.widthPx, height: o.heightPx })),
  ]
  const defaults = screens
    ? defaultSources(
        screens.map((s) => ({
          key: s.key,
          width: s.rasterWidth,
          height: s.rasterHeight,
          current: s.current,
          slack: s.rasterExact ? 0 : Math.ceil(s.devicePixelRatio),
        })),
        candidates,
      )
    : new Map<string, LiveSource>()
  const sourceOf = (s: ScreenInfo) => chosen[s.key] ?? sourceToString(defaults.get(s.key) ?? { kind: 'display' })
  const isPicked = (s: ScreenInfo) => picked[s.key] ?? (!s.current || (screens?.length ?? 0) === 1)
  // The window on a display: by the name it reports for where it is now, when
  // that name is unique, since a display's key moves when the desk is rearranged.
  const liveOn = (s: ScreenInfo) =>
    ((screens ?? []).filter((x) => x.label === s.label).length === 1
      ? windows.find((w) => w.screenLabel === s.label)
      : undefined) ?? windows.find((w) => w.screenKey === s.key)
  // Not reported in, and nothing else live on its display either.
  const failed = opening.filter(
    (o) => !reported(o) && now - o.at > OPEN_WAIT_MS && !(screens ?? []).some((s) => s.key === o.screenKey && liveOn(s)),
  )
  const soundTaken = () => windows.some((w) => w.sound !== 'off') || opening.some((o) => o.sound && young(o))

  const toOpen = (screens ?? []).filter((s) => isPicked(s) && !liveOn(s) && !opening.some((o) => o.screenKey === s.key && young(o)))

  function goLive() {
    let sound = !soundTaken()
    const asked: Opening[] = []
    for (const s of toOpen) {
      const id = newId()
      const source = sourceFromString(sourceOf(s)) ?? { kind: 'display' }
      openWindow({ id, source, scaling, screenKey: s.key, screenLabel: s.label, sound, muted: false }, s.avail)
      asked.push({ id, screenKey: s.key, label: s.label, sound, at: performance.now() })
      sound = false
    }
    // A display asked for again replaces what it was waiting for.
    setOpening((prev) => [...prev.filter((o) => young(o) && !asked.some((a) => a.screenKey === o.screenKey)), ...asked])
    setNow(performance.now())
  }

  // Without the display list: one window, wherever the browser puts it.
  const [hereSource, setHereSource] = useState<string | null>(null)
  const fallbackSource = hereSource ?? sourceToString(candidates[0]?.source ?? { kind: 'display' })
  function openHere() {
    const id = newId()
    const sound = !soundTaken()
    openWindow({
      id,
      source: sourceFromString(fallbackSource) ?? { kind: 'display' },
      scaling,
      screenKey: '',
      screenLabel: '',
      sound,
      muted: false,
    })
    setOpening((prev) => [...prev.filter(young), { id, screenKey: '', label: 'The new window', sound, at: performance.now() }])
    setNow(performance.now())
  }

  function changeScaling(s: LiveScaling) {
    setScaling(s)
    post({ type: 'set', scaling: s })
  }

  const fallback = (
    <div className="live-here">
      <label className="field">
        <span>Shows</span>
        <SourceSelect
          value={fallbackSource}
          onChange={(s) => setHereSource(sourceToString(s))}
          outputs={outputs}
          composition={composition}
        />
      </label>
      <button onClick={openHere}>Open a live window</button>
    </div>
  )

  return (
    <section className="panel live-panel">
      <div className="live-head">
        <h2>Live output</h2>
        <span className="spacer" />
        <button className="ghost small" onClick={onClose}>
          Hide
        </button>
      </div>
      <p className="hint">
        The pattern, full screen, on the displays plugged into this computer. Change anything here and
        the live windows follow it; they keep going if this tab is reloaded.
      </p>

      {access === 'granted' && screens ? (
        <ul className="live-screens">
          {screens.map((s) => {
            const live = liveOn(s)
            const value = live ? sourceToString(live.source) : sourceOf(s)
            return (
              <li key={s.key}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={isPicked(s)}
                    onChange={(e) => setPicked({ ...picked, [s.key]: e.target.checked })}
                  />
                  <span>
                    <b>{s.label}</b>
                    <span className="dim">
                      {' '}
                      {s.rasterExact ? '' : 'about '}
                      {s.rasterWidth} × {s.rasterHeight}
                      {s.devicePixelRatio !== 1 ? ` (${s.width} × ${s.height} at ${s.devicePixelRatio}×)` : ''}
                      {s.current ? ' · this display' : ''}
                    </span>
                    {live ? <span className="live-badge">live</span> : null}
                  </span>
                </label>
                <SourceSelect
                  value={value}
                  onChange={(src) =>
                    live
                      ? post({ type: 'set', id: live.id, source: src })
                      : setChosen({ ...chosen, [s.key]: sourceToString(src) })
                  }
                  outputs={outputs}
                  composition={composition}
                  display={{ width: s.rasterWidth, height: s.rasterHeight }}
                />
              </li>
            )
          })}
        </ul>
      ) : access === 'granted' ? (
        <p className="hint">Finding displays…</p>
      ) : access === 'prompt' ? (
        <>
          <p className="hint">
            To list your displays and put a window on each, the browser will ask whether this page may manage
            windows on all your displays.
          </p>
          <div className="btn-row">
            <button onClick={() => void listen()}>Find my displays</button>
          </div>
          <p className="hint">Or open one here, drag it to its display, and click it:</p>
          {fallback}
        </>
      ) : access === 'denied' ? (
        <>
          <p className="hint warn">
            This page has been refused access to your displays{refused ? ` (${refused})` : ''}. Allow{' '}
            <b>Window management</b> in the site’s settings (the icon left of the address) to list them. Until
            then, open a window here, drag it to its display, and click it:
          </p>
          {fallback}
        </>
      ) : access === 'unsupported' || access === 'insecure' ? (
        <>
          <p className="hint">
            {access === 'insecure'
              ? 'Listing displays needs https or localhost, and this copy is on plain http (as the desktop app’s is, opened from another machine).'
              : 'This browser can’t list displays or put a window on another one; Chrome and Edge can.'}{' '}
            Open a window here, drag it to its display, and click it:
          </p>
          {fallback}
        </>
      ) : null}

      <div className="live-actions">
        <div className="segmented">
          <button className={scaling === 'fit' ? 'active' : ''} onClick={() => changeScaling('fit')}>
            Fit the display
          </button>
          <button className={scaling === 'pixels' ? 'active' : ''} onClick={() => changeScaling('pixels')}>
            1:1 pixels, from the top left
          </button>
        </div>
        {access === 'granted' && screens ? (
          <button className="primary" onClick={goLive} disabled={!toOpen.length}>
            {toOpen.length
              ? `Go live on ${toOpen.length === 1 ? toOpen[0]!.label : `${toOpen.length} displays`}`
              : 'Go live'}
          </button>
        ) : null}
      </div>
      <p className="hint">
        Then click each live window once, or press F in it: a browser only goes full screen from a click in the
        window itself. Esc leaves full screen; I shows or hides its info. A raster that isn’t the display’s size is
        scaled to fit, unless you pick 1:1.
        {kind === 'av-sync' ? ' The beep comes from the first window opened, once it has been clicked.' : ''}
      </p>

      {failed.length ? (
        <div className="callout info">
          <strong>
            {failed.map((f) => f.label).join(', ')} didn’t open
          </strong>
          <p>
            A browser lets a page open one window per click. Press{' '}
            {access === 'granted' && screens ? <b>Go live</b> : <b>Open a live window</b>} again for each one
            left, or allow pop-ups for this site (the icon at the right of the address bar) and they’ll all open
            at once.
          </p>
        </div>
      ) : null}

      {windows.length ? (
        <>
          <h3>Live now</h3>
          <ul className="live-windows">
            {windows.map((w) => (
              <li key={w.id}>
                <div className="live-row">
                  <span>
                    <b>{w.showing ?? 'Nothing'}</b> on {w.screenLabel || 'a display'}
                    {w.screenLabel && w.screenLabel === here ? ' (this display)' : ''}
                  </span>
                  <span className="spacer" />
                  <SourceSelect
                    value={sourceToString(w.source)}
                    onChange={(src) => post({ type: 'set', id: w.id, source: src })}
                    outputs={outputs}
                    composition={composition}
                    display={w.source.kind === 'display' ? w.device : undefined}
                  />
                  {w.sound !== 'off' && w.sound !== 'silent' ? (
                    <button className="ghost small" onClick={() => post({ type: 'set', id: w.id, muted: w.sound !== 'muted' })}>
                      {w.sound === 'muted' ? 'Unmute' : 'Mute'}
                    </button>
                  ) : null}
                  <button className="ghost small" onClick={() => post({ type: 'close', id: w.id })}>
                    Close
                  </button>
                </div>
                <div className={`hint${w.problem || !w.fullscreen || w.placement !== '1:1' ? ' warn' : ''}`}>
                  {w.problem ?? describeWindow(w)}
                </div>
              </li>
            ))}
          </ul>
          <div className="btn-row">
            <button className="ghost small" onClick={() => post({ type: 'close' })}>
              Close every live window
            </button>
          </div>
        </>
      ) : null}
      {!supervised ? (
        <p className="hint warn">This browser can’t list the windows it opens, so close them yourself when done.</p>
      ) : null}
    </section>
  )
}

/** The button that opens the panel, saying how many windows are live. */
export function LiveButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const count = useLiveWindows((s) => s.windows.length)
  return (
    <button className={open ? 'active-outline' : ''} onClick={onClick} aria-expanded={open}>
      Live output{count ? ` · ${count} live` : ''}
    </button>
  )
}
