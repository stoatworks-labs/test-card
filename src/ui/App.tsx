import { useMemo, useState } from 'react'
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
  renderBlockers,
  renderComposition,
  renderOutput,
} from '../patterns/render'

export default function App() {
  const store = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const selected = store.outputs.find((o) => o.id === store.selectedId) ?? store.outputs[0] ?? null
  const enabled = store.outputs.filter((o) => o.enabled)

  const blockers = useMemo(
    () => renderBlockers(store.outputs, store.mode, store.composition),
    [store.outputs, store.mode, store.composition],
  )

  const hasRegions = store.outputs.some((o) => o.regions.length > 0)
  const hasCabinets = store.outputs.some((o) => o.regions.some((r) => r.order !== undefined))

  async function exportNow() {
    setExportError(null)
    if (blockers.length) {
      setExportError(blockers.map((b) => `${b.output}: ${b.reason}`).join('\n'))
      return
    }

    try {
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
        const png = await canvasToPng(renderOutput(output, store.settings))
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
        const png = await canvasToPng(renderOutput(output, store.settings))
        images.push({ name: outputFileName(output, store.settings), data: png })
      }

      setBusy('Packing ZIP…')
      const zip = packageZip(
        images,
        buildManifest(store.projectName, enabled, images.map((i) => i.name), store.settings),
      )
      downloadBlob(zipFileName(store.projectName, store.settings), zip, 'application/zip')
    } catch (err) {
      setExportError((err as Error).message)
    } finally {
      setBusy(null)
    }
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

            <button className="primary" onClick={() => void exportNow()} disabled={!!busy || !store.outputs.length}>
              {busy ??
                (store.mode === 'composition'
                  ? 'Download composition PNG'
                  : enabled.length > 1
                    ? `Download ZIP of ${enabled.length} PNGs`
                    : 'Download PNG')}
            </button>
          </div>

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
          />
        </main>

        <aside className="right">
          <PatternPanel
            settings={store.settings}
            patch={store.patchSettings}
            hasRegions={hasRegions}
            hasCabinets={hasCabinets}
          />
        </aside>
      </div>

      <footer>
        <span>
          Patterns are generated in your browser. Nothing is uploaded, and the design file
          never leaves this machine.
        </span>
        <button className="ghost small" onClick={store.reset}>
          Clear everything
        </button>
      </footer>
    </div>
  )
}
