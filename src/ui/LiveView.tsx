/**
 * A live window: one display's worth of pattern, full screen, following the editor.
 *
 * Opened by the editor's Live output panel; see live/plan.ts for why it is a
 * page of its own rather than something the editor draws into. It reads the
 * editor's saved state and follows every change to it.
 *
 * It draws through the same painters as the preview and the export
 * (`renderOutputTo`, `renderCompositionTo`), never a copy of them, for the
 * preview's reason: a live output that drifted from the PNG would be worse than
 * none.
 *
 * A browser only goes full screen from a click or key press in the window
 * itself, and only plays sound after one, so the first click here does both.
 */

import { useEffect, useRef, useState } from 'react'
import type { Output, PatternSettings } from '../types'
import { followSavedState, useStore } from '../state/store'
import {
  canvasLimitProblem,
  patternAudio,
  renderComposition,
  renderCompositionTo,
  renderOutput,
  renderOutputTo,
  getPatternImage,
  setPatternImage,
} from '../patterns/render'
import { endlessOn, isAnimated } from '../patterns/env'
import { loopTiming } from '../patterns/loop'
import { decodeImage, loadImage, onImageChanged } from '../state/image-store'
import { describePlacement, liveTime, liveUrl, placeRaster, type LiveParams, type Size } from '../live/plan'
import { openLiveChannel, REPORT_MS, type LiveStatus } from '../live/channel'
import { screenAccess, watchScreens } from '../live/screens'
import { LiveSound } from '../live/sound'
import { unixMs } from '../live/clock'

/** How long the info stays up after the mouse stops, once full screen. */
const INFO_MS = 2500

type Target =
  | { problem: string; name: string | null }
  | {
      problem: null
      name: string
      raster: Size
      draw: (ctx: CanvasRenderingContext2D, t?: number) => void
      still: () => HTMLCanvasElement
    }

function resolveTarget(
  p: LiveParams,
  outputs: Output[],
  composition: { widthPx: number; heightPx: number } | undefined,
  settings: PatternSettings,
  device: Size,
  displayName: string,
): Target {
  let found: Exclude<Target, { problem: string }>
  if (p.source.kind === 'output') {
    const id = p.source.id
    const output = outputs.find((o) => o.id === id)
    if (!output) {
      return { problem: 'The output this window was showing has gone from the editor. Choose another under Live output.', name: null }
    }
    found = {
      problem: null,
      name: output.name,
      raster: { width: output.widthPx, height: output.heightPx },
      draw: (ctx, t) => renderOutputTo(ctx, output, settings, t, composition),
      still: () => renderOutput(output, settings, undefined, composition),
    }
  } else if (p.source.kind === 'composition') {
    if (!composition) return { problem: 'This import has no composition size, so there is no composition to show.', name: null }
    found = {
      problem: null,
      name: 'Composition',
      raster: { width: composition.widthPx, height: composition.heightPx },
      draw: (ctx, t) => renderCompositionTo(ctx, outputs, composition, settings, t),
      still: () => renderComposition(outputs, composition, settings),
    }
  } else {
    // Stood up for the occasion and never stored: an output exactly the size of this window.
    const output: Output = {
      id: 'display',
      name: displayName,
      widthPx: device.width,
      heightPx: device.height,
      rasterSource: 'declared',
      source: 'manual',
      regions: [],
      notes: [],
      enabled: true,
    }
    found = {
      problem: null,
      name: displayName,
      raster: device,
      draw: (ctx, t) => renderOutputTo(ctx, output, settings, t),
      still: () => renderOutput(output, settings),
    }
  }
  const limit = canvasLimitProblem(found.raster.width, found.raster.height)
  return limit ? { problem: limit, name: found.name } : found
}

export function LiveView({ params: opened }: { params: LiveParams }) {
  const { outputs, composition, settings } = useStore()
  const [params, setParams] = useState(opened)
  const muted = params.muted
  const ref = useRef<HTMLCanvasElement>(null)
  const [device, setDevice] = useState<Size>({ width: 0, height: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const [moved, setMoved] = useState(true)
  const [pinned, setPinned] = useState<boolean | null>(null)
  const [imageVersion, setImageVersion] = useState(0)
  const [here, setHere] = useState<string | null>(null)
  const [awake, setAwake] = useState<'on' | 'off' | 'unavailable'>('off')
  const [audioRunning, setAudioRunning] = useState(false)
  const [audioFailed, setAudioFailed] = useState(false)
  const [closeRefused, setCloseRefused] = useState(false)
  const audioCtx = useRef<AudioContext | null>(null)
  const [fps, setFps] = useState<number | null>(null)
  const status = useRef<LiveStatus | null>(null)

  const displayName = here || params.screenLabel || 'This display'
  const target =
    device.width > 0 && device.height > 0
      ? resolveTarget(params, outputs, composition, settings, device, displayName)
      : null
  const placement = target && target.problem === null ? placeRaster(target.raster, device, params.scaling) : null
  const moving = isAnimated(settings)
  // patternAudio's own test, without building the samples on every render.
  const audible = params.sound && !muted && settings.kind === 'av-sync'
  const sound: LiveStatus['sound'] = !params.sound
    ? 'off'
    : muted
      ? 'muted'
      : !audible
        ? 'silent'
        : audioFailed
          ? 'failed'
          : audioRunning
            ? 'on'
            : 'waiting'

  // Follow the editor: its saved state, and the picture it keeps beside it.
  useEffect(() => followSavedState(), [])
  useEffect(() => {
    let live = true
    let asked = 0
    const load = () => {
      const mine = ++asked
      void loadImage().then(async (saved) => {
        const bmp = saved ? await decodeImage(saved.blob).catch(() => null) : null
        // A later change overtook this one (a big photo still decoding when a
        // small one replaced it), or the page is going: this picture is stale.
        if (!live || mine !== asked) return void bmp?.close()
        const old = getPatternImage()
        setPatternImage(bmp)
        if (old instanceof ImageBitmap && old !== bmp) old.close()
        setImageVersion((v) => v + 1)
      })
    }
    load()
    const stop = onImageChanged(load)
    return () => {
      live = false
      stop()
    }
  }, [])

  // Which display this is, by name, when the browser has already said this page may know.
  useEffect(() => {
    let stop: (() => void) | null = null
    let live = true
    void screenAccess().then((access) => {
      if (access !== 'granted' || !live) return
      void watchScreens((screens) => setHere(screens.find((s) => s.current)?.label ?? null)).then(
        (s) => (live ? (stop = s) : s()),
        () => {},
      )
    })
    return () => {
      live = false
      stop?.()
    }
  }, [])

  // The canvas is exactly the window, in device pixels: 1:1 is only 1:1 if nothing resamples it.
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ro = new ResizeObserver(([e]) => {
      if (!e) return
      const box = e.devicePixelContentBoxSize?.[0]
      const width = box ? box.inlineSize : Math.round(e.contentRect.width * devicePixelRatio)
      const height = box ? box.blockSize : Math.round(e.contentRect.height * devicePixelRatio)
      setDevice((d) => (d.width === width && d.height === height ? d : { width, height }))
    })
    try {
      ro.observe(canvas, { box: 'device-pixel-content-box' })
    } catch {
      ro.observe(canvas)
    }
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !device.width || !device.height) return
    if (canvas.width !== device.width) canvas.width = device.width
    if (canvas.height !== device.height) canvas.height = device.height
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    const blank = () => {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, device.width, device.height)
    }
    if (!target || target.problem !== null || !placement) {
      blank()
      setFps(null)
      return
    }
    const p = placement
    const paint = (t?: number, full?: HTMLCanvasElement) => {
      blank()
      ctx.save()
      ctx.beginPath()
      ctx.rect(p.x, p.y, p.width, p.height)
      ctx.clip()
      if (full) {
        // A still that does not fit: its real pixels, resampled. Upscaling keeps
        // them square rather than smearing them, so a pixel check stays one.
        ctx.imageSmoothingEnabled = p.scale < 1
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(full, p.x, p.y, p.width, p.height)
      } else {
        ctx.setTransform(p.scale, 0, 0, p.scale, p.x, p.y)
        target.draw(ctx, t)
      }
      ctx.restore()
    }

    if (!moving) {
      // On the next frame, so a burst of changes from the editor (a slider being
      // dragged) is drawn once, not once per change: a scaled still is a
      // full-size render first, and that can be a 16k-wide one.
      const raf = requestAnimationFrame(() => paint(undefined, p.scale === 1 ? undefined : target.still()))
      setFps(null)
      return () => cancelAnimationFrame(raf)
    }
    // Moving: drawn at the window's scale each frame, as the preview does,
    // since a full-size render per frame would be too slow for a big raster.
    const loop = loopTiming(settings.animation).seconds
    const endless = endlessOn(settings)
    let raf = 0
    let frames = 0
    let since = performance.now()
    const tick = (now: number) => {
      paint(liveTime(unixMs(now), loop, endless))
      frames++
      if (now - since >= 1000) {
        setFps(Math.round((frames * 10000) / (now - since)) / 10)
        frames = 0
        since = now
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // `target` is rebuilt every render; these are what it is built from.
  }, [params.source, params.scaling, outputs, composition, settings, device, imageVersion, displayName, moving])

  // Sound, in the one window the editor gave it to, once a click has allowed it.
  const audioKey = audible ? JSON.stringify([settings.animation.seconds, settings.animation.fps, settings.avSync]) : null
  useEffect(() => {
    const ctx = audioCtx.current
    if (!audioKey || !audioRunning || !ctx) return
    const now = useStore.getState().settings
    const audio = patternAudio(now)
    if (!audio) return
    const s = new LiveSound(ctx, audio, loopTiming(now.animation).seconds)
    s.start()
    return () => s.stop()
  }, [audioKey, audioRunning])

  // Keep the display from sleeping while it is showing something.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null
    let asking = false
    let live = true
    const get = () => {
      if (!('wakeLock' in navigator)) {
        setAwake('unavailable')
        return
      }
      if (document.visibilityState !== 'visible' || lock || asking) return
      asking = true
      navigator.wakeLock
        .request('screen')
        .then(
          (l) => {
            if (!live) return void l.release()
            lock = l
            setAwake('on')
            l.addEventListener('release', () => {
              lock = null
              if (live) setAwake('off')
            })
          },
          () => live && setAwake('unavailable'),
        )
        .finally(() => (asking = false))
    }
    get()
    document.addEventListener('visibilitychange', get)
    return () => {
      live = false
      document.removeEventListener('visibilitychange', get)
      void lock?.release()
    }
  }, [])

  // Full screen, info, and the keys.
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  useEffect(() => {
    let timer = 0
    const wake = () => {
      setMoved(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setMoved(false), INFO_MS)
    }
    wake()
    window.addEventListener('mousemove', wake)
    return () => {
      window.removeEventListener('mousemove', wake)
      window.clearTimeout(timer)
    }
  }, [])

  const startSound = () => {
    if (!params.sound || audioRunning) return
    try {
      const ctx = (audioCtx.current ??= new AudioContext({ latencyHint: 'interactive' }))
      // Suspended or interrupted later (another app took the device, the Mac
      // slept): say so, and the next click starts it again.
      ctx.onstatechange = () => setAudioRunning(ctx.state === 'running')
      ctx.resume().then(
        () => setAudioRunning(ctx.state === 'running'),
        () => setAudioFailed(true),
      )
    } catch {
      setAudioFailed(true)
    }
  }
  const enterFullscreen = () => {
    if (document.fullscreenElement) return
    void document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {})
  }
  const activate = () => {
    enterFullscreen()
    startSound()
  }
  const activateRef = useRef(activate)
  activateRef.current = activate
  const showInfo = pinned ?? (!fullscreen || moved)
  const showInfoRef = useRef(showInfo)
  showInfoRef.current = showInfo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen()
        else activateRef.current()
      } else if (k === 'enter' || k === ' ') {
        activateRef.current()
      } else if (k === 'i') {
        setPinned(!showInfoRef.current)
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Report in to the editor, and do what it asks.
  const id = params.id
  const problem = closeRefused
    ? 'Asked to close, but this window wasn’t opened by Test Card, so the browser won’t let it close itself. Close it yourself.'
    : (target?.problem ?? null)
  status.current = {
    id,
    screenKey: params.screenKey,
    screenLabel: here || params.screenLabel,
    source: params.source,
    scaling: params.scaling,
    showing: target?.name ?? null,
    raster: target && target.problem === null ? target.raster : null,
    device,
    placement: placement ? describePlacement(placement) : '',
    fullscreen,
    fps: moving ? fps : null,
    problem,
    sound,
    awake: awake === 'on',
  }
  useEffect(() => {
    const ch = openLiveChannel((m) => {
      if (m.type === 'ping') report()
      else if (m.type === 'close' && (!m.id || m.id === id)) {
        // Goodbye first: one posted from `pagehide` as the window goes is often lost.
        bye()
        window.close()
        // Still here: a page may only close a window a script opened, and this
        // one was opened some other way.
        window.setTimeout(() => setCloseRefused(true), 500)
      }
      else if (m.type === 'set' && (!m.id || m.id === id)) {
        setParams((p) => ({
          ...p,
          source: m.source ?? p.source,
          scaling: m.scaling ?? p.scaling,
          muted: m.muted ?? p.muted,
        }))
      }
    })
    const report = () => status.current && ch?.post({ type: 'status', status: status.current })
    report()
    const timer = window.setInterval(report, REPORT_MS)
    const bye = () => ch?.post({ type: 'bye', id })
    window.addEventListener('pagehide', bye)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', bye)
      ch?.close()
    }
  }, [id])

  // A reload comes back showing the same thing.
  useEffect(() => {
    history.replaceState(null, '', liveUrl(location.href, params))
  }, [params])
  useEffect(() => {
    document.title = `${target?.name ?? 'Nothing'} — Test Card live`
  }, [target?.name])

  return (
    <div className={`live-view${fullscreen && !showInfo ? ' no-cursor' : ''}`} onClick={activate}>
      <canvas ref={ref} className="live-canvas" />
      {problem ? (
        <div className="live-problem">
          <p>{problem}</p>
        </div>
      ) : null}
      {showInfo ? (
        <div className="live-info">
          <div className="live-title">
            <b>LIVE</b> {target?.name ?? '—'}
          </div>
          {target && target.problem === null && placement ? (
            <div>
              raster {target.raster.width} × {target.raster.height} · window {device.width} × {device.height} px ·{' '}
              <span className={placement.scale === 1 && !placement.cropped ? '' : 'warn'}>
                {describePlacement(placement)}
              </span>
              {placement.scale !== 1 ? <span className="warn"> — 1px detail is approximate</span> : null}
            </div>
          ) : null}
          <div>
            {here ? `on ${here}` : params.screenLabel ? `opened for ${params.screenLabel}` : 'on this display'}
            {moving && fps !== null ? ` · ${fps.toFixed(1)} fps` : ''}
            {sound === 'waiting' ? ' · sound starts when you click' : ''}
            {sound === 'on' ? ' · sound on' : ''}
            {sound === 'muted' ? ' · sound muted' : ''}
            {sound === 'failed' ? <span className="warn"> · this browser would not play the sound</span> : null}
            {awake === 'unavailable' ? <span className="warn"> · can’t stop the display sleeping here</span> : null}
          </div>
          <div className="live-keys">
            {fullscreen ? 'Esc leaves full screen' : 'Click, or press F, for full screen'} · I {showInfo ? 'hides' : 'shows'}{' '}
            this
          </div>
        </div>
      ) : null}
    </div>
  )
}
