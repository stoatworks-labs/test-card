import type { PatternKind, PatternSettings } from '../types'
import { PATTERN_LABELS } from '../patterns/render'

type Patch = (patch: Record<string, unknown>) => void

const KINDS: { kind: PatternKind; hint: string }[] = [
  { kind: 'smpte-rp219', hint: 'Standard bars, pluge and luma ramp' },
  { kind: 'ebu-bars', hint: 'Eight equal 75% bars, full height' },
  { kind: 'grid', hint: 'Your own pitch, with labels and diagonals' },
  { kind: 'alignment', hint: 'Edges, corners, safe areas, centre target' },
  { kind: 'led-tiles', hint: 'One cell per LED cabinet' },
  { kind: 'solid', hint: 'Flat colour field for dead pixels' },
  { kind: 'greyscale', hint: 'Ramp or stepped wedge' },
  { kind: 'pixel-check', hint: '1px checker and line bursts' },
]

export function PatternPanel({
  settings,
  patch,
  hasRegions,
  hasCabinets,
}: {
  settings: PatternSettings
  patch: (p: Record<string, unknown>) => void
  hasRegions: boolean
  hasCabinets: boolean
}) {
  const sub = (key: keyof PatternSettings): Patch => (p) => patch({ [key]: p })

  return (
    <div className="panel">
      <h2>Pattern</h2>

      <div className="kind-grid">
        {KINDS.map(({ kind, hint }) => (
          <button
            key={kind}
            className={settings.kind === kind ? 'kind active' : 'kind'}
            onClick={() => patch({ kind })}
            title={hint}
          >
            <span className="kind-name">{PATTERN_LABELS[kind]}</span>
            <span className="kind-hint">{hint}</span>
          </button>
        ))}
      </div>

      <Field label="Level range">
        <select
          value={settings.levels}
          onChange={(e) => patch({ levels: e.target.value })}
        >
          <option value="full">Full 0–255 (media server, GPU, HDMI full)</option>
          <option value="legal">Legal 16–235 (SDI / broadcast chain)</option>
        </select>
      </Field>
      <p className="hint">
        {settings.levels === 'full'
          ? 'Reference black is 0 and white is 255. Sub-black patches such as the RP 219 pluge clip to black and cannot be judged — switch to legal range for those.'
          : 'Studio swing. Sub-black and super-white survive, so the pluge is meaningful. Sent to a full-range display this will look washed out, which is expected.'}
      </p>

      {settings.kind === 'grid' ? <GridControls opts={settings.grid} patch={sub('grid')} /> : null}
      {settings.kind === 'alignment' ? (
        <AlignmentControls opts={settings.alignment} patch={sub('alignment')} />
      ) : null}
      {settings.kind === 'led-tiles' ? (
        <LedControls opts={settings.led} patch={sub('led')} hasCabinets={hasCabinets} />
      ) : null}
      {settings.kind === 'solid' ? <SolidControls opts={settings.solid} patch={sub('solid')} /> : null}
      {settings.kind === 'greyscale' ? (
        <GreyscaleControls opts={settings.greyscale} patch={sub('greyscale')} />
      ) : null}
      {settings.kind === 'pixel-check' ? (
        <PixelCheckControls opts={settings.pixelCheck} patch={sub('pixelCheck')} />
      ) : null}

      <h3>Burn-in</h3>
      <Check
        label="Label each pattern"
        checked={settings.overlay.enabled}
        onChange={(enabled) => sub('overlay')({ enabled })}
      />
      {settings.overlay.enabled ? (
        <>
          <Check
            label="Output name"
            checked={settings.overlay.showName}
            onChange={(showName) => sub('overlay')({ showName })}
          />
          <Check
            label="Resolution"
            checked={settings.overlay.showResolution}
            onChange={(showResolution) => sub('overlay')({ showResolution })}
          />
          <Check
            label="Pattern and level range"
            checked={settings.overlay.showPattern}
            onChange={(showPattern) => sub('overlay')({ showPattern })}
          />
          <Field label="Extra text">
            <textarea
              rows={2}
              value={settings.overlay.customText}
              placeholder="Show name, date, your initials…"
              onChange={(e) => sub('overlay')({ customText: e.target.value })}
            />
          </Field>
          <Field label="Position">
            <select
              value={settings.overlay.position}
              onChange={(e) => sub('overlay')({ position: e.target.value })}
            >
              <option value="top-left">Top left</option>
              <option value="top-centre">Top centre</option>
              <option value="centre">Centre</option>
              <option value="bottom-centre">Bottom centre</option>
              <option value="bottom-left">Bottom left</option>
            </select>
          </Field>
          <Num
            label="Text size (0 = scale to raster)"
            value={settings.overlay.fontSizePx}
            min={0}
            onChange={(fontSizePx) => sub('overlay')({ fontSizePx })}
          />
        </>
      ) : null}

      {hasRegions ? (
        <>
          <h3>Imported regions</h3>
          <Check
            label="Draw slice / port outlines"
            checked={settings.regionOverlay.enabled}
            onChange={(enabled) => sub('regionOverlay')({ enabled })}
          />
          {settings.regionOverlay.enabled ? (
            <Check
              label="Label them"
              checked={settings.regionOverlay.labels}
              onChange={(labels) => sub('regionOverlay')({ labels })}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

function GridControls({ opts, patch }: { opts: PatternSettings['grid']; patch: Patch }) {
  return (
    <>
      <h3>Grid</h3>
      <Field label="Defined by">
        <select value={opts.mode} onChange={(e) => patch({ mode: e.target.value })}>
          <option value="spacing">Cell size in pixels</option>
          <option value="divisions">Number of divisions</option>
        </select>
      </Field>
      {opts.mode === 'spacing' ? (
        <Num label="Cell size (px)" value={opts.spacingPx} min={2} onChange={(spacingPx) => patch({ spacingPx })} />
      ) : (
        <div className="row">
          <Num label="Across" value={opts.divisionsX} min={1} onChange={(divisionsX) => patch({ divisionsX })} />
          <Num label="Down" value={opts.divisionsY} min={1} onChange={(divisionsY) => patch({ divisionsY })} />
        </div>
      )}
      <div className="row">
        <Num label="Line width" value={opts.lineWidthPx} min={1} onChange={(lineWidthPx) => patch({ lineWidthPx })} />
        <Num label="Heavy every" value={opts.majorEvery} min={0} onChange={(majorEvery) => patch({ majorEvery })} />
        <Num
          label="Heavy width"
          value={opts.majorLineWidthPx}
          min={1}
          onChange={(majorLineWidthPx) => patch({ majorLineWidthPx })}
        />
      </div>
      <div className="row">
        <Colour label="Line" value={opts.colour} onChange={(colour) => patch({ colour })} />
        <Colour label="Heavy" value={opts.majorColour} onChange={(majorColour) => patch({ majorColour })} />
        <Colour label="Background" value={opts.background} onChange={(background) => patch({ background })} />
      </div>
      <Check label="Anchor grid at centre" checked={opts.originCentre} onChange={(originCentre) => patch({ originCentre })} />
      <Check label="Label cells" checked={opts.labelCells} onChange={(labelCells) => patch({ labelCells })} />
      <Check label="Diagonals" checked={opts.diagonals} onChange={(diagonals) => patch({ diagonals })} />
      <Check label="Centre target" checked={opts.centreMarks} onChange={(centreMarks) => patch({ centreMarks })} />
    </>
  )
}

function AlignmentControls({ opts, patch }: { opts: PatternSettings['alignment']; patch: Patch }) {
  return (
    <>
      <h3>Alignment</h3>
      <Check label="1px edge border" checked={opts.edgeBorder} onChange={(edgeBorder) => patch({ edgeBorder })} />
      <Check label="Corner markers" checked={opts.cornerMarkers} onChange={(cornerMarkers) => patch({ cornerMarkers })} />
      {opts.cornerMarkers ? (
        <Num label="Corner arm (px)" value={opts.cornerSizePx} min={8} onChange={(cornerSizePx) => patch({ cornerSizePx })} />
      ) : null}
      <Check label="Centre target" checked={opts.centreTarget} onChange={(centreTarget) => patch({ centreTarget })} />
      <Check label="Diagonals" checked={opts.diagonals} onChange={(diagonals) => patch({ diagonals })} />
      <Check
        label="1px checker patches"
        checked={opts.pixelPatches}
        onChange={(pixelPatches) => patch({ pixelPatches })}
      />
      <Field label="Safe areas (%, comma separated)">
        <input
          type="text"
          value={opts.safeAreas.join(', ')}
          onChange={(e) =>
            patch({
              safeAreas: e.target.value
                .split(',')
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0 && n < 100),
            })
          }
        />
      </Field>
      <div className="row">
        <Colour label="Lines" value={opts.colour} onChange={(colour) => patch({ colour })} />
        <Colour label="Background" value={opts.background} onChange={(background) => patch({ background })} />
      </div>
    </>
  )
}

function LedControls({
  opts,
  patch,
  hasCabinets,
}: {
  opts: PatternSettings['led']
  patch: Patch
  hasCabinets: boolean
}) {
  return (
    <>
      <h3>LED tiles</h3>
      <Field label="Tile source">
        <select
          value={opts.source}
          onChange={(e) => patch({ source: e.target.value })}
          disabled={!hasCabinets}
        >
          <option value="uniform">Uniform grid — I’ll state the tile size</option>
          <option value="cabinets">Imported cabinets (Pixel Peeker)</option>
        </select>
      </Field>
      {!hasCabinets ? (
        <p className="hint">
          Import a Pixel Peeker interchange export (Export → JSON) to draw the real cabinet
          map, including irregular walls and chain order.
        </p>
      ) : null}

      {opts.source === 'uniform' ? (
        <>
          <div className="row">
            <Num label="Tile width (px)" value={opts.tileWidthPx} min={1} onChange={(tileWidthPx) => patch({ tileWidthPx })} />
            <Num label="Tile height (px)" value={opts.tileHeightPx} min={1} onChange={(tileHeightPx) => patch({ tileHeightPx })} />
          </div>
          <div className="row">
            <Num label="Origin X" value={opts.originXPx} onChange={(originXPx) => patch({ originXPx })} />
            <Num label="Origin Y" value={opts.originYPx} onChange={(originYPx) => patch({ originYPx })} />
          </div>
        </>
      ) : null}

      <Check label="Checkerboard fill" checked={opts.checker} onChange={(checker) => patch({ checker })} />
      <div className="row">
        <Colour label="Tile A" value={opts.checkerColourA} onChange={(checkerColourA) => patch({ checkerColourA })} />
        <Colour label="Tile B" value={opts.checkerColourB} onChange={(checkerColourB) => patch({ checkerColourB })} />
        <Colour label="Border" value={opts.borderColour} onChange={(borderColour) => patch({ borderColour })} />
      </div>
      <Num label="Border width" value={opts.borderWidthPx} min={1} onChange={(borderWidthPx) => patch({ borderWidthPx })} />
      <Check label="Label tiles (A1, B2…)" checked={opts.labelTiles} onChange={(labelTiles) => patch({ labelTiles })} />
      {opts.source === 'cabinets' ? (
        <>
          <Check label="Show chain order" checked={opts.labelOrder} onChange={(labelOrder) => patch({ labelOrder })} />
          <Check
            label="Colour by port"
            checked={opts.colourByGroup}
            onChange={(colourByGroup) => patch({ colourByGroup })}
          />
        </>
      ) : null}
    </>
  )
}

function SolidControls({ opts, patch }: { opts: PatternSettings['solid']; patch: Patch }) {
  return (
    <>
      <h3>Solid field</h3>
      <Field label="Colour">
        <select value={opts.field} onChange={(e) => patch({ field: e.target.value })}>
          {['white', 'black', 'red', 'green', 'blue', 'cyan', 'magenta', 'yellow', 'grey50', 'grey18'].map(
            (f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ),
          )}
          <option value="custom">Custom…</option>
        </select>
      </Field>
      {opts.field === 'custom' ? (
        <Colour label="Custom" value={opts.custom} onChange={(custom) => patch({ custom })} />
      ) : (
        <Num label="Level %" value={opts.levelPct} min={0} max={100} onChange={(levelPct) => patch({ levelPct })} />
      )}
    </>
  )
}

function GreyscaleControls({ opts, patch }: { opts: PatternSettings['greyscale']; patch: Patch }) {
  return (
    <>
      <h3>Greyscale</h3>
      <Num
        label="Steps (0 = continuous ramp)"
        value={opts.steps}
        min={0}
        onChange={(steps) => patch({ steps })}
      />
      <Check label="Vertical" checked={opts.vertical} onChange={(vertical) => patch({ vertical })} />
      <Check
        label="Split into R, G, B and neutral"
        checked={opts.perChannel}
        onChange={(perChannel) => patch({ perChannel })}
      />
    </>
  )
}

function PixelCheckControls({ opts, patch }: { opts: PatternSettings['pixelCheck']; patch: Patch }) {
  return (
    <>
      <h3>Pixel check</h3>
      <Num label="Cell size (px)" value={opts.cellPx} min={1} onChange={(cellPx) => patch({ cellPx })} />
      <Check
        label="Add 1px line bursts"
        checked={opts.lineBursts}
        onChange={(lineBursts) => patch({ lineBursts })}
      />
      <p className="hint">
        If any of this renders as flat grey on the real output, something in the chain is
        scaling. That is the whole test.
      </p>
    </>
  )
}

// --- small controls -------------------------------------------------------

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

export function Num({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
      />
    </Field>
  )
}

export function Check({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Colour({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Field label={label}>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}
