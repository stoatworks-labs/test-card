import { useRef, useState } from 'react'
import type { ImportResult } from '../types'
import { detectAndParse } from '../import/detect'
import { parseBlendCalcProject, type StaleAxis } from '../import/blendcalc'
import { RASTER_PRESETS } from '../state/defaults'
import { Check, Field, Num } from './PatternPanel'

type Pending = {
  doc: unknown
  defaults: {
    hOverlap: number
    vOverlap: number
    columns: number
    rows: number
    staleAxis: StaleAxis
    name: string
  }
}

export function ImportPanel({
  onImport,
  onAddManual,
}: {
  onImport: (result: ImportResult) => void
  onAddManual: (name: string, w: number, h: number) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [dragging, setDragging] = useState(false)

  async function handleFile(file: File) {
    setError(null)
    setPending(null)
    try {
      const text = await file.text()
      const got = detectAndParse(text, file.name)
      if (got.kind === 'ready') onImport(got.result)
      else setPending({ doc: got.doc, defaults: got.defaults })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="panel">
      <h2>Outputs</h2>

      <div
        className={dragging ? 'dropzone over' : 'dropzone'}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const file = e.dataTransfer.files[0]
          if (file) void handleFile(file)
        }}
        onClick={() => fileRef.current?.click()}
      >
        <strong>Drop a design file</strong>
        <span>Resolume advanced output ·  Pixel Peeker JSON · Blend Calc design</span>
        <input
          ref={fileRef}
          type="file"
          accept=".xml,.json,application/xml,text/xml,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
            e.target.value = ''
          }}
        />
      </div>

      {error ? (
        <div className="callout error">
          <strong>That file could not be used</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {pending ? (
        <BlendCalcDialog
          pending={pending}
          onCancel={() => setPending(null)}
          onConfirm={(opts) => {
            try {
              onImport(parseBlendCalcProject(pending.doc, opts))
              setPending(null)
            } catch (err) {
              setError((err as Error).message)
            }
          }}
        />
      ) : null}

      <ManualAdd onAdd={onAddManual} />
    </div>
  )
}

/**
 * Blend Calc needs two things its design file does not carry — see the header of
 * import/blendcalc.ts. This asks for exactly those and explains why, rather than
 * guessing and producing a wrong canvas silently.
 */
function BlendCalcDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: Pending
  onCancel: () => void
  onConfirm: (opts: {
    nativeWidth: number
    nativeHeight: number
    hOverlap: number
    vOverlap: number
  }) => void
}) {
  const d = pending.defaults
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1200)
  const [h, setH] = useState(d.hOverlap * 100)
  const [v, setV] = useState(d.vOverlap * 100)

  const staleLabel = d.staleAxis === 'v' ? 'Vertical' : d.staleAxis === 'h' ? 'Horizontal' : null

  return (
    <div className="callout">
      <strong>Blend Calc design: “{d.name}”</strong>
      <p>
        {d.columns} x {d.rows} array. Two things are not in the file and have to come from
        you.
      </p>

      <h4>1. Projector native resolution</h4>
      <p className="hint">
        The file stores a reference into Blend Calc’s projector library, not the
        resolution itself.
      </p>
      <Field label="Preset">
        <select
          onChange={(e) => {
            const p = RASTER_PRESETS[Number(e.target.value)]
            if (p) {
              setWidth(p.width)
              setHeight(p.height)
            }
          }}
          defaultValue=""
        >
          <option value="" disabled>
            Choose…
          </option>
          {RASTER_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <Num label="Width" value={width} min={1} onChange={setWidth} />
        <Num label="Height" value={height} min={1} onChange={setHeight} />
      </div>

      <h4>2. Overlap</h4>
      {staleLabel ? (
        <p className="warn">
          This design uses a fit mode, so Blend Calc <em>solves</em> the{' '}
          {staleLabel.toLowerCase()} overlap and never writes it back — the value below is
          a stale input. Read “{staleLabel} blend (solved)” off Blend Calc’s own screen and
          type it here, or import its Resolume XML export instead, which needs none of
          this.
        </p>
      ) : (
        <p className="hint">
          This design is in manual mode, so both overlaps below came from the file and are
          trustworthy.
        </p>
      )}
      <div className="row">
        <Num
          label={`Horizontal %${d.staleAxis === 'h' ? ' (stale)' : ''}`}
          value={Number(h.toFixed(2))}
          min={0}
          max={90}
          onChange={setH}
        />
        <Num
          label={`Vertical %${d.staleAxis === 'v' ? ' (stale)' : ''}`}
          value={Number(v.toFixed(2))}
          min={0}
          max={90}
          onChange={setV}
        />
      </div>

      <div className="btn-row">
        <button
          className="primary"
          onClick={() =>
            onConfirm({
              nativeWidth: width,
              nativeHeight: height,
              hOverlap: h / 100,
              vOverlap: v / 100,
            })
          }
        >
          Lay out {d.columns * d.rows} projector{d.columns * d.rows === 1 ? '' : 's'}
        </button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function ManualAdd({ onAdd }: { onAdd: (name: string, w: number, h: number) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('Output 1')
  const [width, setWidth] = useState(1920)
  const [height, setHeight] = useState(1080)
  const [count, setCount] = useState(1)

  if (!open) {
    return (
      <button className="ghost wide" onClick={() => setOpen(true)}>
        + Add an output by hand
      </button>
    )
  }

  return (
    <div className="callout">
      <Field label="Name">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Preset">
        <select
          onChange={(e) => {
            const p = RASTER_PRESETS[Number(e.target.value)]
            if (p) {
              setWidth(p.width)
              setHeight(p.height)
            }
          }}
          defaultValue=""
        >
          <option value="" disabled>
            Choose…
          </option>
          {RASTER_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <Num label="Width" value={width} min={1} onChange={setWidth} />
        <Num label="Height" value={height} min={1} onChange={setHeight} />
        <Num label="How many" value={count} min={1} max={64} onChange={setCount} />
      </div>
      <div className="btn-row">
        <button
          className="primary"
          onClick={() => {
            for (let i = 0; i < Math.max(1, count); i++) {
              onAdd(count > 1 ? `${name} ${i + 1}` : name, width, height)
            }
            setOpen(false)
          }}
        >
          Add
        </button>
        <button onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}

export { Check }
