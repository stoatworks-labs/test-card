import { useState } from 'react'
import { useStore } from '../state/store'
import type { Output, RasterSource } from '../types'

const SOURCE_NOTE: Record<RasterSource, string> = {
  declared: 'Raster read from the file’s own output device.',
  'slice-bounds':
    'Raster INFERRED from where the slices sit — the file did not record the output size. Check it.',
  computed: 'Raster computed from the design geometry.',
  manual: 'Raster typed in by you.',
}

export function OutputList() {
  const outputs = useStore((s) => s.outputs)
  const selectedId = useStore((s) => s.selectedId)
  const select = useStore((s) => s.select)
  const update = useStore((s) => s.updateOutput)
  const remove = useStore((s) => s.removeOutput)
  const setAll = useStore((s) => s.setAllEnabled)
  const projectName = useStore((s) => s.projectName)
  const setProjectName = useStore((s) => s.setProjectName)

  if (!outputs.length) return null

  const enabledCount = outputs.filter((o) => o.enabled).length

  return (
    <div className="panel">
      <label className="field">
        <span>Project name (used for filenames)</span>
        <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
      </label>

      <div className="list-head">
        <span>
          {enabledCount} of {outputs.length} enabled
        </span>
        <span className="spacer" />
        <button className="ghost small" onClick={() => setAll(true)}>
          All
        </button>
        <button className="ghost small" onClick={() => setAll(false)}>
          None
        </button>
      </div>

      <ul className="outputs">
        {outputs.map((output) => (
          <OutputRow
            key={output.id}
            output={output}
            selected={output.id === selectedId}
            onSelect={() => select(output.id)}
            onChange={(patch) => update(output.id, patch)}
            onRemove={() => remove(output.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function OutputRow({
  output,
  selected,
  onSelect,
  onChange,
  onRemove,
}: {
  output: Output
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Output>) => void
  onRemove: () => void
}) {
  const [editing, setEditing] = useState(false)
  const inferred = output.rasterSource === 'slice-bounds'

  return (
    <li className={selected ? 'output selected' : 'output'}>
      <div className="output-main" onClick={onSelect}>
        <input
          type="checkbox"
          checked={output.enabled}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        <div className="output-text">
          <span className="output-name">{output.name}</span>
          <span className={inferred ? 'output-size warn' : 'output-size'}>
            {output.widthPx} x {output.heightPx}
            {inferred ? ' · inferred' : ''}
            {output.regions.length
              ? ` · ${output.regions.length} region${output.regions.length === 1 ? '' : 's'}`
              : ''}
          </span>
        </div>
        <button
          className="ghost small"
          onClick={(e) => {
            e.stopPropagation()
            setEditing(!editing)
          }}
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {editing ? (
        <div className="output-edit">
          <label className="field">
            <span>Name</span>
            <input value={output.name} onChange={(e) => onChange({ name: e.target.value })} />
          </label>
          <div className="row">
            <label className="field">
              <span>Width</span>
              <input
                type="number"
                min={1}
                value={output.widthPx}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (v > 0) onChange({ widthPx: Math.round(v), rasterSource: 'manual' })
                }}
              />
            </label>
            <label className="field">
              <span>Height</span>
              <input
                type="number"
                min={1}
                value={output.heightPx}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (v > 0) onChange({ heightPx: Math.round(v), rasterSource: 'manual' })
                }}
              />
            </label>
          </div>
          <p className={inferred ? 'hint warn' : 'hint'}>{SOURCE_NOTE[output.rasterSource]}</p>
          {output.device ? <p className="hint">Device: {output.device}</p> : null}
          {output.notes.map((n, i) => (
            <p className="hint warn" key={i}>
              {n}
            </p>
          ))}
          <button className="ghost small danger" onClick={onRemove}>
            Remove this output
          </button>
        </div>
      ) : null}
    </li>
  )
}
