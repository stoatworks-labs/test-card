/**
 * Controls for the idle patterns — Idler's own controls, for one saver at a
 * time. Each saver keeps its own look, starting as it ran on the machine, and
 * the seven generic scene controls are named for what they mean to that saver.
 */

import type { IdleKind, IdleLook, PatternSettings } from '../types'
import { Colour, Field } from './PatternPanel'
import { Seed } from './NoveltyControls'
import { PATTERN_LABELS } from '../patterns/render'
import { ENDLESS_RUN_SECONDS, IDLE_AS_IT_RAN, IDLE_CONTROLS, isIdle3d, offersFlat, usesCamDistance } from '../patterns/idle'
import { camTiltFromParam, fovFromParam, hueCycleFromParam, speedFromParam } from '../patterns/idle/common'

type Patch = (patch: Record<string, unknown>) => void

const SCENE_CONTROLS = ['density', 'complexity', 'size', 'length', 'lineWidth', 'variation'] as const
const degrees = (radians: number) => `${Math.round((radians * 180) / Math.PI)}°`
const percent = (v: number) => `${Math.round(v * 100)}%`

function Slider({ label, value, show, onChange }: { label: string; value: number; show: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="field">
      <span>
        {label} <b className="readout">{show(value)}</b>
      </span>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}

export function IdleControls({
  kind,
  opts,
  patch,
  endless = false,
}: {
  kind: IdleKind
  opts: PatternSettings['idle']
  patch: Patch
  /** Running endless (`endlessOn`): Idler's own speeds, and a new network every run. */
  endless?: boolean
}) {
  const look = opts.looks[kind] ?? IDLE_AS_IT_RAN[kind]
  const set = (p: Partial<IdleLook>) => patch({ looks: { [kind]: p } })
  const names = IDLE_CONTROLS[kind]
  const threeD = isIdle3d(kind)
  const growing = kind === 'maze' || kind === 'pipes'

  return (
    <>
      <h3>{PATTERN_LABELS[kind]}</h3>
      <div className="row seed">
        <Seed value={opts.seed} onChange={(seed) => patch({ seed })} />
        <button type="button" className="ghost small" onClick={() => set({ ...IDLE_AS_IT_RAN[kind] })} title="Idler's preset for this saver">
          As it ran
        </button>
      </div>
      {kind === 'marquee' || kind === 'text-3d' ? (
        <Field label="Text">
          <input type="text" value={opts.text} onChange={(e) => patch({ text: e.target.value })} />
        </Field>
      ) : null}

      <Slider label="Speed" value={look.speed} show={(v) => `${speedFromParam(v).toFixed(2)}×`} onChange={(speed) => set({ speed })} />
      {SCENE_CONTROLS.map((key) => {
        // On the 3D savers Line Width is the wireframe's weight too.
        const label = names[key] ?? (key === 'lineWidth' && threeD && look.shading === 'wireframe' ? 'Wireframe line' : null)
        return label ? <Slider key={key} label={label} value={look[key]} show={percent} onChange={(v) => set({ [key]: v })} /> : null
      })}

      {threeD ? (
        <>
          <Field label="Shading">
            <select value={look.shading} onChange={(e) => set({ shading: e.target.value as IdleLook['shading'] })}>
              {offersFlat(kind) ? <option value="flat">Flat</option> : null}
              <option value="lit">Lit</option>
              <option value="wireframe">Wireframe</option>
            </select>
          </Field>
          <Slider label="Field of view" value={look.fov} show={(v) => degrees(fovFromParam(v))} onChange={(fov) => set({ fov })} />
          {usesCamDistance(kind) ? (
            <Slider label="Camera distance" value={look.camDistance} show={percent} onChange={(camDistance) => set({ camDistance })} />
          ) : null}
          <Slider label="Camera tilt" value={look.camTilt} show={(v) => degrees(camTiltFromParam(v))} onChange={(camTilt) => set({ camTilt })} />
          <Slider label="Fog" value={look.fog} show={(v) => (v > 0.001 ? percent(v) : 'off')} onChange={(fog) => set({ fog })} />
        </>
      ) : null}

      <Field label="Colour">
        <select value={look.colourMode} onChange={(e) => set({ colourMode: e.target.value as IdleLook['colourMode'] })}>
          <option value="classic">Classic — the saver’s own palette</option>
          <option value="tint">Tint — one colour, the saver’s shading</option>
          <option value="spread">Spread — a fan of hues from one colour</option>
          <option value="cycle">Cycle — one colour, rotating</option>
        </select>
      </Field>
      {look.colourMode !== 'classic' ? <Colour label="Base colour" value={look.colour} onChange={(colour) => set({ colour })} /> : null}
      {look.colourMode === 'spread' ? (
        <Slider label="Hue spread" value={look.hueSpread} show={(v) => `${Math.round(v * 360)}°`} onChange={(hueSpread) => set({ hueSpread })} />
      ) : null}
      {look.colourMode === 'spread' || look.colourMode === 'cycle' ? (
        <Slider
          label="Hue cycle"
          value={look.hueCycle}
          show={(v) => `${hueCycleFromParam(v).toFixed(3)} turn/s`}
          onChange={(hueCycle) => set({ hueCycle })}
        />
      ) : null}
      <Colour label="Background" value={look.background} onChange={(background) => set({ background })} />

      {endless ? (
        <p className="hint">
          Endless: Idler’s own speeds, none rounded to the loop.
          {growing
            ? ` Every ${ENDLESS_RUN_SECONDS} s of the saver’s time it starts a new ${kind === 'pipes' ? 'box of pipes' : 'maze'} from a seed of its own, so it never builds the same one twice.`
            : ''}
        </p>
      ) : (
        <p className="hint">
          Every speed in it is rounded to a whole number of cycles in the loop, so the MP4 has no seam; a
          longer loop leaves more of Idler’s own speeds alone.
          {growing
            ? kind === 'pipes'
              ? ' Each loop is one run from the seed: the box clears 40% of the way through, so the still at 0 s is a grown network.'
              : ' Each loop is one walk from the seed, fading out and back in halfway through the loop, where it starts again.'
            : ''}
        </p>
      )}
    </>
  )
}
