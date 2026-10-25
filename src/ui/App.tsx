import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { ImportPanel } from './ImportPanel'
import { PatternPanel } from './PatternPanel'
import { Preview } from './Preview'
import { OutputList } from './OutputList'
import { LiveButton, LivePanel } from './LivePanel'
import { superviseLiveWindows } from '../live/supervise'
import {
  buildManifest,
  compositionFileName,
  downloadBlob,
  outputFileName,
  packageZip,
  tileFileName,
  zipFileName,
  type TiledLoop,
} from '../lib/export'
import {
  canvasToPng,
  canvasRange,
  patternAudio,
  renderBlockers,
  renderComposition,
  renderCompositionTo,
  renderOutput,
  renderOutputTo,
  setPatternImage,
  spansSurface,
  stillTime,
} from '../patterns/render'
import { endlessOn, isAnimated } from '../patterns/env'
import { idleRenderFailures } from '../patterns/idle'
import { loopTiming } from '../patterns/loop'
import { resolvePitch } from '../patterns/scale'
import { encodePlan, MAX_LOOP_BYTES, planBytes, planLoop, type EncodeRequest, type LoopPlan } from '../lib/video'
import { AAC_BITRATE, audioProblem, encodeLoopAudio, type EncodedAudio } from '../lib/audio'
import { uniqueNames } from '../lib/zip'
import { clearImage, decodeImage, loadImage } from '../state/image-store'

class Cancelled extends Error {}

export default function App() {
  const store = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [liveOpen, setLiveOpen] = useState(false)
  const cancel = useRef(false)

  const selected = store.outputs.find((o) => o.id === store.selectedId) ?? store.outputs[0] ?? null
  const enabled = store.outputs.filter((o) => o.enabled)
  const moving = isAnimated(store.settings)
  const endless = endlessOn(store.settings)
  const setImage = store.setImage

  // Bring back the picture the image pattern was showing before a refresh.
  useEffect(() => {
    let live = true
    void loadImage().then(async (saved) => {
      if (!saved || !live) return
      try {
        const bmp = await decodeImage(saved.blob)
        if (!live) return
        setPatternImage(bmp)
        setImage({ name: saved.name, width: bmp.width, height: bmp.height })
      } catch {
        // A stored file that no longer decodes is just forgotten.
      }
    })
    return () => {
      live = false
    }
  }, [setImage])

  // Live windows report in whether or not the panel is open.
  useEffect(() => superviseLiveWindows(), [])

  const blockers = useMemo(
    () => renderBlockers(store.outputs, store.mode, store.composition),
    [store.outputs, store.mode, store.composition],
  )

  const hasRegions = store.outputs.some((o) => o.regions.length > 0)
  const hasCabinets = store.outputs.some((o) => o.regions.some((r) => r.order !== undefined))

  // How much of the surface is on screen, in metres — for "centre on" in the dinosaur line-up.
  const surfaceWidthM = useMemo(() => {
    if (!selected) return 0
    const pitch = resolvePitch(selected, store.settings.scale).pitchMm
    const cr = selected.compositionRect
    if (spansSurface(store.settings) && store.composition && cr && cr.width > 0) {
      return (store.composition.widthPx * pitch * (selected.widthPx / cr.width)) / 1000
    }
    return (selected.widthPx * pitch) / 1000
  }, [selected, store.settings, store.composition])

  // Which loops this browser will only take as tiles, worked out ahead so the
  // page can say so before anyone presses the button. Errors are left for the
  // export itself to report, in full. The answer carries the inputs it was
  // worked out for, and is not shown against any others.
  const { seconds, fps, bitrateMbps } = store.settings.animation
  const rasters =
    store.mode === 'composition'
      ? store.composition
        ? [{ label: 'The composition', width: store.composition.widthPx, height: store.composition.heightPx }]
        : []
      : enabled.map((o) => ({ label: o.name, width: o.widthPx, height: o.heightPx }))
  const planKey = JSON.stringify({ moving, rasters, seconds, fps, bitrateMbps })
  const [tilingFor, setTilingFor] = useState<{ key: string; found: { label: string; width: number; height: number; plan: LoopPlan }[] }>({
    key: '',
    found: [],
  })
  const tiling = tilingFor.key === planKey ? tilingFor.found : []
  useEffect(() => {
    const ask = JSON.parse(planKey) as { moving: boolean; rasters: typeof rasters; seconds: number; fps: typeof fps; bitrateMbps: number }
    if (!ask.moving) return
    let live = true
    const timing = loopTiming({ seconds: ask.seconds, fps: ask.fps })
    const bitrate = Math.max(0, ask.bitrateMbps) * 1e6
    void Promise.all(
      ask.rasters.map((r) =>
        planLoop(r.width, r.height, timing, bitrate).then(
          (plan) => (plan.tiles.length > 1 ? { ...r, plan } : null),
          () => null,
        ),
      ),
    ).then((found) => {
      if (live) setTilingFor({ key: planKey, found: found.filter((f) => f !== null) })
    })
    return () => {
      live = false
    }
  }, [planKey])

  async function exportLoops() {
    const settings = store.settings
    const timing = loopTiming(settings.animation)
    const range = canvasRange(settings)
    const bitrate = Math.max(0, settings.animation.bitrateMbps) * 1e6
    // Sound, for the patterns that have it: refused up front if the browser can't, encoded once for every file.
    let sound = patternAudio(settings)
    if (sound) {
      const problem = await audioProblem(sound)
      if (problem) throw new Error(problem)
    }

    type Job = { label: string; name: string; width: number; height: number; render: EncodeRequest['render'] }
    // An idle pattern that could not be drawn (no WebGL2, or the context lost part
    // way) paints a notice instead; in a loop nobody watches being made, that is a
    // file of notices. Stop the export instead.
    // An endless pattern has no loop to export, so the MP4 is a slice of the run
    // starting at the PNG's moment: the frames from there, which do not loop.
    const sliceFrom = endlessOn(settings) ? stillTime(settings).t : 0
    const strict =
      (render: EncodeRequest['render']): EncodeRequest['render'] =>
      (ctx, t) => {
        const before = idleRenderFailures()
        render(ctx, sliceFrom + t)
        if (idleRenderFailures() !== before) {
          throw new Error('The idle pattern could not be drawn: this browser has no WebGL2, or lost its graphics context. Try again.')
        }
      }
    const composition = store.mode === 'composition'
    let jobs: Job[]
    if (composition) {
      const comp = store.composition
      if (!comp) throw new Error('No composition size for this import.')
      jobs = [
        {
          label: 'Composition',
          name: compositionFileName(store.projectName, settings, comp.widthPx, comp.heightPx, 'mp4'),
          width: comp.widthPx,
          height: comp.heightPx,
          render: strict((ctx, t) => renderCompositionTo(ctx, store.outputs, comp, settings, t)),
        },
      ]
    } else {
      if (!enabled.length) throw new Error('No outputs are enabled.')
      jobs = enabled.map((output) => ({
        label: output.name,
        name: outputFileName(output, settings, 'mp4'),
        width: output.widthPx,
        height: output.heightPx,
        render: strict((ctx, t) => renderOutputTo(ctx, output, settings, t, store.composition)),
      }))
    }

    // Plan every loop before encoding any, so a raster nothing will fit, or a
    // set too big to hold, is refused before minutes go into the ones ahead.
    const plans: LoopPlan[] = []
    for (const job of jobs) {
      try {
        plans.push(await planLoop(job.width, job.height, timing, bitrate))
      } catch (err) {
        throw new Error(`${job.label}: ${(err as Error).message}`)
      }
    }
    // Every finished file is held until the ZIP is built, so the limit on one
    // loop is the limit on all of them together.
    // The sound goes into every file and every tile: 192 kb/s of AAC each.
    const soundBytes = sound ? (AAC_BITRATE / 8) * timing.seconds : 0
    const total = plans.reduce((sum, p) => sum + planBytes(p, timing) + soundBytes * p.tiles.length, 0)
    if (total > MAX_LOOP_BYTES) {
      throw new Error(
        `Those ${jobs.length} loops would come to about ${(total / 1024 ** 3).toFixed(1)} GB together, more than a browser tab can build. ` +
          'Export fewer outputs at a time, shorten the loop, or lower the bitrate.',
      )
    }
    // Names settled now, and made unique as the ZIP would store them, so the
    // manifest names what is actually in it.
    const wanted = jobs.map((job, i) =>
      plans[i]!.tiles.length === 1 ? [job.name] : plans[i]!.tiles.map((t) => tileFileName(job.name, t)),
    )
    const unique = uniqueNames(wanted.flat())
    let next = 0
    const names = wanted.map((list) => list.map(() => unique[next++]!))

    let audio: EncodedAudio | undefined
    if (sound) {
      setBusy('Encoding the sound…')
      audio = await encodeLoopAudio(sound, (done, total) => {
        if (cancel.current) throw new Cancelled('Cancelled.')
        setBusy(`Encoding the sound — ${Math.round((done / total) * 100)}%`)
      })
      // The samples are done with; a ten-minute loop's are over 100 MB.
      sound = null
    }

    const files: { name: string; data: Uint8Array }[] = []
    const tiled: TiledLoop[] = []
    const cells: string[] = []
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]!
      const loop = plans[i]!
      const parts = loop.tiles.length
      const label = composition
        ? 'Encoding composition'
        : jobs.length > 1
          ? `Encoding ${i + 1} of ${jobs.length}, ${job.label}`
          : `Encoding ${job.label}`
      const data = await encodePlan(loop, {
        timing,
        range,
        audio,
        render: job.render,
        onProgress: (done, frames, tile) => {
          if (cancel.current) throw new Cancelled('Cancelled.')
          setBusy(`${label}${parts > 1 ? `, tile ${tile + 1} of ${parts}` : ''} — frame ${done} of ${frames}`)
        },
      })
      data.forEach((bytes, j) => files.push({ name: names[i]![j]!, data: bytes }))
      if (parts === 1) {
        cells.push(names[i]![0]!)
      } else {
        const placed = loop.tiles.map((t, j) => ({ ...t, name: names[i]![j]! }))
        tiled.push({ label: job.label, width: job.width, height: job.height, cols: loop.cols, rows: loop.rows, files: placed })
        cells.push(`${parts} tiles listed below`)
      }
    }

    if (files.length === 1) {
      downloadBlob(files[0]!.name, files[0]!.data, 'video/mp4')
      return
    }
    setBusy('Packing ZIP…')
    const manifest = composition
      ? buildManifest(store.projectName, [], [], settings, 'mp4', tiled)
      : buildManifest(store.projectName, enabled, cells, settings, 'mp4', tiled)
    downloadBlob(zipFileName(store.projectName, settings, 'mp4'), packageZip(files, manifest), 'application/zip')
  }

  async function run(job: () => Promise<void>) {
    setExportError(null)
    cancel.current = false
    if (blockers.length) {
      setExportError(blockers.map((b) => `${b.output}: ${b.reason}`).join('\n'))
      return
    }
    // Busy before the first await, or a second click starts a second export.
    setBusy('Starting…')
    try {
      await job()
    } catch (err) {
      if (!(err instanceof Cancelled)) setExportError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function exportPngs() {
    if (store.mode === 'composition') {
      if (!store.composition) throw new Error('No composition size for this import.')
      setBusy('Rendering composition…')
      const canvas = renderComposition(store.outputs, store.composition, store.settings)
      const png = await canvasToPng(canvas)
      downloadBlob(
        compositionFileName(
          store.projectName,
          store.settings,
          store.composition.widthPx,
          store.composition.heightPx,
        ),
        png,
        'image/png',
      )
      return
    }

    if (!enabled.length) throw new Error('No outputs are enabled.')

    // A single output downloads as a bare PNG — wrapping one file in a ZIP is
    // just an extra step for whoever receives it.
    if (enabled.length === 1) {
      const output = enabled[0]!
      setBusy(`Rendering ${output.name}…`)
      const png = await canvasToPng(renderOutput(output, store.settings, undefined, store.composition))
      downloadBlob(outputFileName(output, store.settings), png, 'image/png')
      return
    }

    const images: { name: string; data: Uint8Array }[] = []
    for (let i = 0; i < enabled.length; i++) {
      const output = enabled[i]!
      setBusy(`Rendering ${i + 1} of ${enabled.length} — ${output.name}`)
      // Yield to the browser between outputs so the progress text repaints;
      // otherwise a 20-output wall looks frozen for the whole run.
      await new Promise((r) => setTimeout(r, 0))
      const png = await canvasToPng(renderOutput(output, store.settings, undefined, store.composition))
      images.push({ name: outputFileName(output, store.settings), data: png })
    }

    setBusy('Packing ZIP…')
    const zip = packageZip(
      images,
      buildManifest(store.projectName, enabled, images.map((i) => i.name), store.settings),
    )
    downloadBlob(zipFileName(store.projectName, store.settings), zip, 'application/zip')
  }

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <h1>Test Card</h1>
          {/* Opens the shared About dialog — see public/about.js, which delegates
              this attribute from the document, so nothing needs importing here. */}
          <button type="button" data-stoatworks-about>
            About
          </button>
        </div>
        <p>
          Test patterns for every physical output in a Resolume advanced output, a Pixel
          Peeker wall or a Blend Calc array.
        </p>
      </header>

      <div className="layout">
        <aside className="left">
          <ImportPanel onImport={store.loadImport} onAddManual={store.addManualOutput} />
          <OutputList />
        </aside>

        <main>
          {store.warnings.length ? (
            <div className="callout info">
              <strong>From the import</strong>
              <ul>
                {store.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mode-row">
            <div className="segmented">
              <button
                className={store.mode === 'per-output' ? 'active' : ''}
                onClick={() => store.setMode('per-output')}
              >
                One PNG per output
              </button>
              <button
                className={store.mode === 'composition' ? 'active' : ''}
                onClick={() => store.setMode('composition')}
                disabled={!store.composition}
                title={
                  store.composition
                    ? 'A single image at composition size — play it through Resolume and every output should show its own name'
                    : 'This import carried no composition size'
                }
              >
                Single composition canvas
              </button>
            </div>

            <div className="export-buttons">
              <LiveButton open={liveOpen} onClick={() => setLiveOpen(!liveOpen)} />
              {busy ? (
                <>
                  <span className="busy">{busy}</span>
                  <button className="ghost small" onClick={() => (cancel.current = true)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {moving ? (
                    <button className="primary" onClick={() => void run(exportLoops)} disabled={!store.outputs.length}>
                      {store.mode === 'composition'
                        ? tiling.length
                          ? 'Download composition MP4 tiles (ZIP)'
                          : 'Download composition MP4'
                        : enabled.length > 1
                          ? `Download ZIP of ${enabled.length} MP4 ${endless ? 'slices' : 'loops'}${tiling.length ? ', some as tiles' : ''}`
                          : tiling.length
                            ? 'Download MP4 tiles (ZIP)'
                            : endless
                              ? 'Download MP4 slice'
                              : 'Download MP4 loop'}
                    </button>
                  ) : null}
                  <button
                    className={moving ? '' : 'primary'}
                    onClick={() => void run(exportPngs)}
                    disabled={!store.outputs.length}
                  >
                    {store.mode === 'composition'
                      ? 'Download composition PNG'
                      : enabled.length > 1
                        ? `Download ZIP of ${enabled.length} PNGs`
                        : 'Download PNG'}
                  </button>
                </>
              )}
            </div>
          </div>
          {liveOpen ? <LivePanel onClose={() => setLiveOpen(false)} /> : null}

          {moving && endless ? (
            <p className="hint">
              An endless pattern, for live output: it never repeats. The MP4 is a slice of it from{' '}
              {store.settings.animation.stillAtSeconds} s, encoded here in the browser, and does not loop; the PNG
              is its first frame.
            </p>
          ) : moving ? (
            <p className="hint">
              A moving pattern. The MP4 is a seamless H.264 loop, encoded here in the browser; the
              PNG is the frame at {store.settings.animation.stillAtSeconds} s.
            </p>
          ) : null}
          {moving && tiling.length ? (
            <div className="callout info">
              <strong>Too big for this browser to encode as one video, so these come as tiles</strong>
              <ul>
                {tiling.map((t, i) => {
                  const first = t.plan.tiles[0]!
                  const even = t.plan.tiles.every((x) => x.width === first.width && x.height === first.height)
                  return (
                    <li key={i}>
                      <b>{t.label}</b>, {t.width} × {t.height}: {t.plan.cols} × {t.plan.rows} tiles
                      {even ? ' of ' : ' of about '}
                      {first.width} × {first.height}
                    </li>
                  )
                })}
              </ul>
              Each tile is its own seamless loop, the same length as the rest. The ZIP’s manifest says
              where each one sits in the full raster, and so does its file name.
            </div>
          ) : null}

          {store.mode === 'composition' ? (
            <p className="hint">
              One image at composition size with every output’s region drawn and labelled.
              Play it in Resolume and each physical output should light up showing its own
              name — the quickest proof the advanced output map is what you think it is.
            </p>
          ) : null}

          {blockers.length ? (
            <div className="callout error">
              <strong>These cannot be rendered</strong>
              <ul>
                {blockers.map((b, i) => (
                  <li key={i}>
                    <b>{b.output}</b> — {b.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {exportError ? (
            <div className="callout error">
              <strong>Export failed</strong>
              <pre>{exportError}</pre>
            </div>
          ) : null}

          <Preview
            output={selected}
            outputs={store.outputs}
            composition={store.composition}
            mode={store.mode}
            settings={store.settings}
            imageVersion={store.image?.version ?? 0}
          />
        </main>

        <aside className="right">
          <PatternPanel
            settings={store.settings}
            patch={store.patchSettings}
            hasRegions={hasRegions}
            hasCabinets={hasCabinets}
            outputPitch={selected?.pitchMm}
            surfaceWidthM={surfaceWidthM}
            image={store.image}
            onImage={setImage}
          />
        </aside>
      </div>

      <footer>
        <span>
          Patterns are generated in your browser. Nothing is uploaded, and the design file
          never leaves this machine.
        </span>
        <button
          className="ghost small"
          onClick={() => {
            store.reset()
            setPatternImage(null)
            void clearImage()
          }}
        >
          Clear everything
        </button>
      </footer>
    </div>
  )
}
