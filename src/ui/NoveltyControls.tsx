/**
 * Controls for the scale-aware and novelty patterns, and for the loop and
 * scale settings they share. Kept apart from PatternPanel so that file still
 * reads as the measurement tool it was.
 */

import { useRef, useState } from 'react'
import type { BrokenFault, DinosaurId, PatternKind, PatternSettings, PumpkinFace } from '../types'
import { Check, Colour, Field, Num } from './PatternPanel'
import { PATTERN_LABELS, setPatternImage } from '../patterns/render'
import { ALL_FAULTS, FAULT_LABELS } from '../patterns/broken'
import { LINEUP_ORDER, SPECIES } from '../patterns/art/dinosaurs'
import { PUMPKIN_FACE_LABELS, PUMPKIN_FACES } from '../patterns/art/halloween'
import { lineup, panToCentre } from '../patterns/novelty'
import { loopTiming } from '../patterns/loop'
import { clearImage, decodeImage, saveImage } from '../state/image-store'
import type { ImageInfo } from '../state/store'

type Patch = (patch: Record<string, unknown>) => void

export function ScaleControls({
  opts,
  patch,
  outputPitch,
  showPitch,
  showFloor,
  showSpan,
}: {
  opts: PatternSettings['scale']
  patch: Patch
  /** The selected output's own pitch, if it has one. */
  outputPitch?: number
  /** Only the patterns drawn at real size care about pitch. */
  showPitch: boolean
  showFloor: boolean
  showSpan: boolean
}) {
  if (!showPitch) {
    return showSpan ? (
      <>
        <h3>Surface</h3>
        <Check
          label="Carry on across outputs (place each by its position in the composition)"
          checked={opts.span}
          onChange={(span) => patch({ span })}
        />
      </>
    ) : null
  }
  return (
    <>
      <h3>Scale</h3>
      {outputPitch ? (
        <p className="hint">
          This output’s pitch is <b>{outputPitch} mm</b>. Outputs with no pitch of their own use the
          fallback below, and say so on the image.
        </p>
      ) : (
        <p className="hint warn">
          The selected output has no pixel pitch, so it is drawn at the fallback below and stamped
          “pitch assumed”. Set the real one under Edit in the output list.
        </p>
      )}
      <div className="row">
        <Num label="Fallback pitch (mm)" value={opts.pitchMm} min={0.05} onChange={(pitchMm) => patch({ pitchMm })} />
        <Field label="Units">
          <select value={opts.units} onChange={(e) => patch({ units: e.target.value })}>
            <option value="metric">Metric</option>
            <option value="imperial">Imperial</option>
          </select>
        </Field>
      </div>
      {showFloor ? (
        <Num
          label="Bottom edge above the floor (mm)"
          value={opts.floorMm}
          min={0}
          onChange={(floorMm) => patch({ floorMm })}
        />
      ) : null}
      {showSpan ? (
        <Check
          label="Carry on across outputs (place each by its position in the composition)"
          checked={opts.span}
          onChange={(span) => patch({ span })}
        />
      ) : null}
    </>
  )
}

export function LoopControls({ opts, patch }: { opts: PatternSettings['animation']; patch: Patch }) {
  const t = loopTiming(opts)
  return (
    <>
      <h3>Loop</h3>
      <div className="row">
        <Num label="Length (s)" value={opts.seconds} min={1} max={600} onChange={(seconds) => patch({ seconds })} />
        <Field label="Frame rate">
          <select value={opts.fps} onChange={(e) => patch({ fps: e.target.value })}>
            {['23.976', '24', '25', '29.97', '30', '50', '59.94', '60'].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="hint">
        {t.frames} frames, {t.seconds.toFixed(3)} s. Everything that moves does a whole number of
        cycles in that time, so the MP4 loops with no seam.
      </p>
      <div className="row">
        <Num
          label="PNG shows the frame at (s)"
          value={opts.stillAtSeconds}
          min={0}
          onChange={(stillAtSeconds) => patch({ stillAtSeconds })}
        />
        <Num
          label="Bitrate (Mb/s, 0 = auto)"
          value={opts.bitrateMbps}
          min={0}
          onChange={(bitrateMbps) => patch({ bitrateMbps })}
        />
      </div>
    </>
  )
}

/** The tile grid the per-tile patterns use — the same settings as the LED tiles pattern. */
export function TileControls({
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
      <Field label="Tiles">
        <select value={opts.source} onChange={(e) => patch({ source: e.target.value })} disabled={!hasCabinets}>
          <option value="uniform">Uniform grid — I’ll state the tile size</option>
          <option value="cabinets">Imported cabinets (Pixel Peeker)</option>
        </select>
      </Field>
      {opts.source === 'uniform' ? (
        <div className="row">
          <Num label="Tile width (px)" value={opts.tileWidthPx} min={1} onChange={(tileWidthPx) => patch({ tileWidthPx })} />
          <Num label="Tile height (px)" value={opts.tileHeightPx} min={1} onChange={(tileHeightPx) => patch({ tileHeightPx })} />
        </div>
      ) : null}
      <p className="hint">Shared with the LED tiles pattern.</p>
    </>
  )
}

export function RulerControls({ opts, patch }: { opts: PatternSettings['rulers']; patch: Patch }) {
  return (
    <>
      <h3>Rulers</h3>
      <div className="row">
        <Check label="Top" checked={opts.top} onChange={(top) => patch({ top })} />
        <Check label="Left" checked={opts.left} onChange={(left) => patch({ left })} />
        <Check label="Bottom" checked={opts.bottom} onChange={(bottom) => patch({ bottom })} />
        <Check label="Right" checked={opts.right} onChange={(right) => patch({ right })} />
      </div>
      <Check label="Lines across at each labelled distance" checked={opts.gridLines} onChange={(gridLines) => patch({ gridLines })} />
      <Check
        label="Side rulers read height above the floor"
        checked={opts.fromFloor}
        onChange={(fromFloor) => patch({ fromFloor })}
      />
      <div className="row">
        <Colour label="Ticks" value={opts.colour} onChange={(colour) => patch({ colour })} />
        <Colour label="Background" value={opts.background} onChange={(background) => patch({ background })} />
      </div>
      <p className="hint">
        Every tick sits on the pixel whose centre is nearest its true distance, so it is never more
        than half a pitch out. The pattern states that tolerance.
      </p>
    </>
  )
}

export function BananaControls({ opts, patch }: { opts: PatternSettings['bananas']; patch: Patch }) {
  return (
    <>
      <h3>Banana for scale</h3>
      <Field label="How many">
        <select value={opts.layout} onChange={(e) => patch({ layout: e.target.value })}>
          <option value="once">One bunch, in the middle</option>
          <option value="per-tile">One bunch on every LED tile</option>
        </select>
      </Field>
      <Check label="Say how many bananas wide it is" checked={opts.caption} onChange={(caption) => patch({ caption })} />
      <Colour label="Background" value={opts.background} onChange={(background) => patch({ background })} />
    </>
  )
}

export function DinosaurControls({
  opts,
  patch,
  surfaceWidthM,
}: {
  opts: PatternSettings['dinosaurs']
  patch: Patch
  /** Width of what is on screen, for "jump to". */
  surfaceWidthM: number
}) {
  const items = lineup(opts)
  const toggle = (id: DinosaurId, on: boolean) =>
    patch({ species: LINEUP_ORDER.filter((s) => (s === id ? on : opts.species.includes(s))) })
  return (
    <>
      <h3>Life-size dinosaurs</h3>
      <div className="checks">
        {LINEUP_ORDER.map((id) => (
          <Check
            key={id}
            label={`${SPECIES[id].name} (${SPECIES[id].lengthM} m)`}
            checked={opts.species.includes(id)}
            onChange={(on) => toggle(id, on)}
          />
        ))}
        <Check label="A person (1.75 m)" checked={opts.human} onChange={(human) => patch({ human })} />
        <Check label="A banana, obviously" checked={opts.banana} onChange={(banana) => patch({ banana })} />
      </div>
      <div className="row">
        <Num label="Pan (m)" value={Math.round(opts.panM * 100) / 100} onChange={(panM) => patch({ panM })} />
        <Num label="Gap (m)" value={opts.gapM} min={0} onChange={(gapM) => patch({ gapM })} />
      </div>
      <Field label="Centre on">
        <select
          value=""
          onChange={(e) => {
            const kind = e.target.value as Parameters<typeof panToCentre>[1]
            if (kind) patch({ panM: Math.round(panToCentre(items, kind, surfaceWidthM) * 100) / 100 })
          }}
        >
          <option value="">Choose…</option>
          {items.map((it) => (
            <option key={it.kind} value={it.kind}>
              {it.label}
            </option>
          ))}
        </select>
      </Field>
      <p className="hint">
        The line-up is {items.reduce((m, i) => Math.max(m, i.xM + i.widthM), 0).toFixed(1)} m long and
        this surface shows {surfaceWidthM.toFixed(1)} m of it. Anything bigger than the surface is cut
        off by its edges, which is rather the point.
      </p>
      <Check label="Name and size labels" checked={opts.labels} onChange={(labels) => patch({ labels })} />
      <Check label="Sky and floor" checked={opts.scenery} onChange={(scenery) => patch({ scenery })} />
      {!opts.scenery ? (
        <Colour label="Background" value={opts.background} onChange={(background) => patch({ background })} />
      ) : null}
    </>
  )
}

export function HamsterControls({ opts, patch }: { opts: PatternSettings['hamsters']; patch: Patch }) {
  return (
    <>
      <h3>Hamster dance</h3>
      <Num label="Tempo (BPM)" value={opts.bpm} min={20} max={300} onChange={(bpm) => patch({ bpm })} />
      <p className="hint">One hamster per LED tile, a new pose every half beat.</p>
    </>
  )
}

function Seed({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="row seed">
      <Num label="Seed" value={value} min={0} onChange={onChange} />
      <button type="button" className="ghost small" onClick={() => onChange(Math.floor(Math.random() * 100000))}>
        Another
      </button>
    </div>
  )
}

export function OceanControls({ opts, patch }: { opts: PatternSettings['ocean']; patch: Patch }) {
  return (
    <>
      <h3>Ocean</h3>
      <Seed value={opts.seed} onChange={(seed) => patch({ seed })} />
      <Field label="Light">
        <select value={opts.time} onChange={(e) => patch({ time: e.target.value })}>
          <option value="day">Day</option>
          <option value="sunset">Sunset</option>
          <option value="night">Night</option>
        </select>
      </Field>
      <Num label="Swell (0.3 calm – 2.5 rough)" value={opts.swell} min={0.3} max={2.5} onChange={(swell) => patch({ swell })} />
    </>
  )
}

export function SceneControls({
  kind,
  opts,
  patch,
}: {
  kind: PatternKind
  opts: PatternSettings['scene']
  patch: Patch
}) {
  return (
    <>
      <h3>{PATTERN_LABELS[kind]}</h3>
      <Seed value={opts.seed} onChange={(seed) => patch({ seed })} />
      {kind === 'dino-scroll' || kind === 'spooky-forest' ? (
        <Num
          label="Speed (screen widths per loop, nearest ground)"
          value={opts.speed}
          min={1}
          max={20}
          onChange={(speed) => patch({ speed: Math.round(speed) })}
        />
      ) : null}
    </>
  )
}

export function PumpkinControls({ opts, patch }: { opts: PatternSettings['pumpkins']; patch: Patch }) {
  const toggle = (f: PumpkinFace, on: boolean) =>
    patch({ faces: PUMPKIN_FACES.filter((x) => (x === f ? on : opts.faces.includes(x))) })
  return (
    <>
      <h3>Pumpkin patch</h3>
      <Seed value={opts.seed} onChange={(seed) => patch({ seed })} />
      <div className="checks two">
        {PUMPKIN_FACES.map((f) => (
          <Check key={f} label={PUMPKIN_FACE_LABELS[f]} checked={opts.faces.includes(f)} onChange={(on) => toggle(f, on)} />
        ))}
      </div>
      <Check label="Candles flicker" checked={opts.flicker} onChange={(flicker) => patch({ flicker })} />
      <Check label="Blinks, winks and chomps" checked={opts.expressions} onChange={(expressions) => patch({ expressions })} />
      <p className="hint">
        {opts.faces.length
          ? 'One pumpkin per LED tile, each with a face picked from the ones ticked. The seed deals them out.'
          : 'No faces ticked, so the pumpkins are plain and uncarved, and nothing moves.'}
      </p>
    </>
  )
}

export function ClassicControls({ opts, patch }: { opts: PatternSettings['classic']; patch: Patch }) {
  return (
    <>
      <h3>Classic test card</h3>
      <Field label="Colour bars">
        <select value={opts.barsPct} onChange={(e) => patch({ barsPct: Number(e.target.value) })}>
          <option value={75}>75%</option>
          <option value={100}>100%</option>
        </select>
      </Field>
      <Check label="Name the output at the foot of the circle" checked={opts.ident} onChange={(ident) => patch({ ident })} />
      <p className="hint">
        Always drawn in full range. For checking levels, use the bars, the greyscale or{' '}
        the levels check.
      </p>
    </>
  )
}

export function LevelsControls({ opts, patch }: { opts: PatternSettings['levelsCheck']; patch: Patch }) {
  return (
    <>
      <h3>Levels check</h3>
      <Check label="Explain the results on the card" checked={opts.notes} onChange={(notes) => patch({ notes })} />
      <p className="hint">
        Always full range, whatever the level setting below says: the question is what the chain
        does to a full-range picture. Squares vanishing into the black and white means the receiving
        end is stretching limited to full; grey blacks and dull whites with every square still there
        mean the sending end is squashing to limited.
      </p>
    </>
  )
}

/** What goes in the middle: the logo, your picture, or your words. */
export function CentreControls({
  opts,
  patch,
  image,
  onImage,
}: {
  opts: PatternSettings['centre']
  patch: Patch
  image: ImageInfo | null
  onImage: (info: Omit<ImageInfo, 'version'> | null) => void
}) {
  return (
    <>
      <h3>In the middle</h3>
      <Field label="Show">
        <select value={opts.content} onChange={(e) => patch({ content: e.target.value })}>
          <option value="logo">The Stoatworks logo</option>
          <option value="image">Your image</option>
          <option value="text">Your text</option>
        </select>
      </Field>
      {opts.content === 'image' ? <ImagePicker image={image} onImage={onImage} /> : null}
      {opts.content === 'text' ? (
        <Field label="Text (one line per line)">
          <textarea rows={3} value={opts.text} onChange={(e) => patch({ text: e.target.value })} />
        </Field>
      ) : null}
      <div className="row">
        <Colour label="Background" value={opts.background} onChange={(background) => patch({ background })} />
        {opts.content === 'text' ? <Colour label="Text" value={opts.colour} onChange={(colour) => patch({ colour })} /> : null}
      </div>
    </>
  )
}

const BASES: Exclude<PatternKind, 'broken-wall'>[] = [
  'ocean',
  'dino-scroll',
  'volcano',
  'spooky-forest',
  'haunted-house',
  'pumpkins',
  'classic-card',
  'image',
  'smpte-rp219',
  'ebu-bars',
  'grid',
  'solid',
  'greyscale',
  'led-tiles',
  'hamsters',
  'bananas',
  'rulers',
  'dinosaurs',
]

export function BrokenControls({ opts, patch }: { opts: PatternSettings['broken']; patch: Patch }) {
  const toggle = (f: BrokenFault, on: boolean) =>
    patch({ faults: ALL_FAULTS.filter((x) => (x === f ? on : opts.faults.includes(x))) })
  return (
    <>
      <h3>Broken wall</h3>
      <Field label="Picture underneath">
        <select value={opts.base} onChange={(e) => patch({ base: e.target.value })}>
          {BASES.map((k) => (
            <option key={k} value={k}>
              {PATTERN_LABELS[k]}
            </option>
          ))}
        </select>
      </Field>
      <div className="row">
        <Num label="Faulty tiles (%)" value={opts.faultyPct} min={0} max={100} onChange={(faultyPct) => patch({ faultyPct })} />
        <Num label="Modules across" value={opts.modulesX} min={1} onChange={(modulesX) => patch({ modulesX })} />
        <Num label="Down" value={opts.modulesY} min={1} onChange={(modulesY) => patch({ modulesY })} />
      </div>
      <Seed value={opts.seed} onChange={(seed) => patch({ seed })} />
      <div className="checks two">
        {ALL_FAULTS.map((f) => (
          <Check key={f} label={FAULT_LABELS[f]} checked={opts.faults.includes(f)} onChange={(on) => toggle(f, on)} />
        ))}
      </div>
      <Check label="Label each fault on the tile" checked={opts.labels} onChange={(labels) => patch({ labels })} />
      <p className="hint">
        Frozen only shows on a moving picture. Flicker and data noise make any picture move, so
        they turn on the MP4 export.
      </p>
    </>
  )
}

/** Choose, replace or remove the picture the image pattern and the classic card's centre share. */
export function ImagePicker({
  image,
  onImage,
}: {
  image: ImageInfo | null
  onImage: (info: Omit<ImageInfo, 'version'> | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const bmp = await decodeImage(file)
      setPatternImage(bmp)
      onImage({ name: file.name, width: bmp.width, height: bmp.height })
      void saveImage(file, file.name)
    } catch {
      setError(`Could not read ${file.name} as an image.`)
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          void choose(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <div className="row">
        <button type="button" onClick={() => input.current?.click()}>
          {image ? 'Choose another…' : 'Choose an image…'}
        </button>
        {image ? (
          <button
            type="button"
            className="ghost small"
            onClick={() => {
              setPatternImage(null)
              onImage(null)
              void clearImage()
            }}
          >
            Remove
          </button>
        ) : null}
      </div>
      {image ? (
        <p className="hint">
          {image.name} — {image.width} x {image.height}. Kept in this browser only; nothing is uploaded.
        </p>
      ) : null}
      {error ? <p className="hint warn">{error}</p> : null}
    </>
  )
}

export function ImageControls({
  opts,
  patch,
  image,
  onImage,
}: {
  opts: PatternSettings['image']
  patch: Patch
  image: ImageInfo | null
  onImage: (info: Omit<ImageInfo, 'version'> | null) => void
}) {
  return (
    <>
      <h3>Your image</h3>
      <ImagePicker image={image} onImage={onImage} />
      <Field label="Fit">
        <select value={opts.fit} onChange={(e) => patch({ fit: e.target.value })}>
          <option value="contain">Fit inside (letterbox)</option>
          <option value="cover">Fill and crop</option>
          <option value="stretch">Stretch to fill</option>
          <option value="native">1:1 pixels, no scaling</option>
          <option value="tile">Tile at 1:1</option>
        </select>
      </Field>
      <div className="row">
        <Field label="Across">
          <select value={opts.anchorX} onChange={(e) => patch({ anchorX: e.target.value })}>
            <option value="left">Left</option>
            <option value="centre">Centre</option>
            <option value="right">Right</option>
          </select>
        </Field>
        <Field label="Down">
          <select value={opts.anchorY} onChange={(e) => patch({ anchorY: e.target.value })}>
            <option value="top">Top</option>
            <option value="centre">Centre</option>
            <option value="bottom">Bottom</option>
          </select>
        </Field>
      </div>
      <div className="row">
        <Colour label="Background" value={opts.background} onChange={(background) => patch({ background })} />
        <Check label="Smooth when scaling" checked={opts.smoothing} onChange={(smoothing) => patch({ smoothing })} />
      </div>
      {opts.fit === 'native' || opts.fit === 'tile' ? (
        <p className="hint">1:1 never resamples, so a test pattern made elsewhere keeps its single pixels.</p>
      ) : null}
    </>
  )
}
