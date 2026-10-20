import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { ImportPanel } from './ImportPanel'
import { PatternPanel } from './PatternPanel'
import { Preview } from './Preview'
import { OutputList } from './OutputList'
import {
  buildManifest,
  compositionFileName,
  downloadBlob,
  outputFileName,
  packageZip,
  zipFileName,
} from '../lib/export'
import {
  canvasToPng,
  canvasRange,
  renderBlockers,
  renderComposition,
  renderCompositionTo,
  renderOutput,
  renderOutputTo,
  setPatternImage,
  spansSurface,
} from '../patterns/render'
import { isAnimated } from '../patterns/env'
import { loopTiming } from '../patterns/loop'
import { resolvePitch } from '../patterns/scale'
import { encodeLoop, videoProblem } from '../lib/video'
import { clearImage, decodeImage, loadImage } from '../state/image-store'

class Cancelled extends Error {}

export default function App() {
  const store = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const cancel = useRef(false)

  const selected = store.outputs.find((o) => o.id === store.selectedId) ?? store.outputs[0] ?? null
  const enabled = store.outputs.filter((o) => o.enabled)
  const moving = isAnimated(store.settings)
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

  async function exportLoops() {
    const settings = store.settings
    const timing = loopTiming(settings.animation)
    const range = canvasRange(settings)
    const bitrate = Math.max(0, settings.animation.bitrateMbps) * 1e6
    const check = (o: { name: string; widthPx: number; heightPx: number }) => {
      const problem = videoProblem(o.widthPx, o.heightPx)
      if (problem) throw new Error(`${o.name}: ${problem}`)
    }
    const progress = (label: string) => (done: number, total: number) => {
      if (cancel.current) throw new Cancelled('Cancelled.')
      setBusy(`${label} — frame ${done} of ${total}`)
    }

    if (store.mode === 'composition') {
      const comp = store.composition
      if (!comp) throw new Error('No composition size for this import.')
      check({ name: 'Composition', ...comp })
      const mp4 = await encodeLoop({
        width: comp.widthPx,
        height: comp.heightPx,
        timing,
        range,
        bitrate,
        render: (ctx, t) => renderCompositionTo(ctx, store.outputs, comp, settings, t),
        onProgress: progress('Encoding composition'),
      })
      downloadBlob(compositionFileName(store.projectName, settings, comp.widthPx, comp.heightPx, 'mp4'), mp4, 'video/mp4')
      return
    }

    if (!enabled.length) throw new Error('No outputs are enabled.')
    enabled.forEach(check)
    const files: { name: string; data: Uint8Array }[] = []
    for (let i = 0; i < enabled.length; i++) {
      const output = enabled[i]!
      const label = enabled.length > 1 ? `Encoding ${i + 1} of ${enabled.length}, ${output.name}` : `Encoding ${output.name}`
      const mp4 = await encodeLoop({
        width: output.widthPx,
        height: output.heightPx,
        timing,
        range,
        bitrate,
        render: (ctx, t) => renderOutputTo(ctx, output, settings, t, store.composition),
        onProgress: progress(label),
      })
      files.push({ name: outputFileName(output, settings, 'mp4'), data: mp4 })
    }
    if (files.length === 1) {
      downloadBlob(files[0]!.name, files[0]!.data, 'video/mp4')
      return
    }
    setBusy('Packing ZIP…')
    const zip = packageZip(files, buildManifest(store.projectName, enabled, files.map((f) => f.name), settings, 'mp4'))
    downloadBlob(zipFileName(store.projectName, settings, 'mp4'), zip, 'application/zip')
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
                        ? 'Download composition MP4'
                        : enabled.length > 1
                          ? `Download ZIP of ${enabled.length} MP4 loops`
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
          {moving ? (
            <p className="hint">
              A moving pattern. The MP4 is a seamless H.264 loop, encoded here in the browser; the
              PNG is the frame at {store.settings.animation.stillAtSeconds} s.
            </p>
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
