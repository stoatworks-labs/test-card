/**
 * The live preview.
 *
 * Renders at a capped size and scales the context, rather than rendering full
 * size and letting CSS shrink the canvas — a 4K canvas per keystroke is slow
 * and, on a wall of many outputs, a memory problem.
 *
 * The consequence is stated on screen rather than hidden: at preview scale a
 * 1px line is sub-pixel and gets antialiased into a grey smudge, and a
 * single-pixel checkerboard averages to flat grey. That is the preview, not the
 * file. Anyone judging a pixel-check pattern by the preview would otherwise
 * conclude the generator is broken.
 *
 * Everything after the scale transform goes through the SAME painters as the
 * export (`renderOutputTo`), not a reimplementation of them. An earlier version
 * had its own copy of the overlay code, and the two had already drifted — the
 * export drew a border round the burn-in plate and the preview did not — which
 * is exactly the class of bug a preview is supposed to catch rather than cause.
 */

import { useEffect, useRef, useState } from 'react'
import type { Output, PatternSettings, RenderMode } from '../types'
import { canvasLimitProblem, renderComposition, renderOutputTo } from '../patterns/render'

const MAX_PREVIEW_PX = 1400

export function Preview({
  output,
  outputs,
  composition,
  mode,
  settings,
}: {
  output: Output | null
  outputs: Output[]
  composition?: { widthPx: number; heightPx: number }
  mode: RenderMode
  settings: PatternSettings
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)

  const target =
    mode === 'composition'
      ? composition
        ? { widthPx: composition.widthPx, heightPx: composition.heightPx }
        : null
      : output
        ? { widthPx: output.widthPx, heightPx: output.heightPx }
        : null

  const targetW = target?.widthPx
  const targetH = target?.heightPx

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !targetW || !targetH) return

    const limit = canvasLimitProblem(targetW, targetH)
    if (limit) {
      setError(limit)
      return
    }
    setError(null)

    const s = Math.min(1, MAX_PREVIEW_PX / Math.max(targetW, targetH))
    setScale(s)
    canvas.width = Math.max(1, Math.round(targetW * s))
    canvas.height = Math.max(1, Math.round(targetH * s))

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (mode === 'composition' && composition) {
      // renderComposition makes its own full-size canvas, so blit it down.
      const full = renderComposition(outputs, composition, settings)
      ctx.drawImage(full, 0, 0, canvas.width, canvas.height)
      return
    }

    if (output) {
      ctx.save()
      ctx.scale(s, s)
      renderOutputTo(ctx, output, settings)
      ctx.restore()
    }
  }, [output, outputs, composition, mode, settings, targetW, targetH])

  if (!target) {
    return (
      <div className="preview empty">
        {mode === 'composition'
          ? 'No composition size is known for this import — switch to per-output.'
          : 'Import a file or add an output to see a pattern.'}
      </div>
    )
  }

  if (error) {
    return (
      <div className="preview empty error">
        <strong>Cannot render this raster.</strong>
        <p>{error}</p>
      </div>
    )
  }

  return (
    <div className="preview">
      <canvas ref={ref} />
      <div className="preview-meta">
        <span>
          {target.widthPx} x {target.heightPx}
        </span>
        <span>preview {Math.round(scale * 100)}%</span>
        {scale < 1 ? (
          <span className="caveat">
            scaled — 1px detail is approximate here, the exported PNG is exact
          </span>
        ) : null}
      </div>
    </div>
  )
}
