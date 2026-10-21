/**
 * The middle of the classic card (and the AV sync pattern): the Stoatworks
 * logo, your own picture, or your own words, fitted into a rectangle.
 *
 * The picture is the same one the "Your image" pattern uses, so it's chosen
 * once and kept in the browser the same way. The logo is vector (see
 * art/logo.ts), so it's as sharp in the middle of an 8K card as a 1080p one.
 */

import type { CentreOptions, Rect } from '../types'
import type { Ctx } from './draw'
import type { PaintEnv } from './env'
import { imagePlacement } from './image'
import { LOGO_HEIGHT, LOGO_LAYERS, LOGO_WIDTH } from './art/logo'

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

let logoPaths: Path2D[] | null = null

/** Built once: the path data never changes. */
function logo(): Path2D[] {
  if (!logoPaths) logoPaths = LOGO_LAYERS.map((layer) => new Path2D(layer.d))
  return logoPaths
}

/** The lines to show, without blank ones. */
export function centreLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * The largest whole font size, in pixels, that fits `lines` into a box: as tall
 * as the box allows, then shrunk until the widest line fits. `measure` gives a
 * line's width at a size, so this stays testable without a canvas.
 *
 * Text doesn't scale in proportion: macOS's system font changes its spacing
 * between sizes, and measured 26 px wider than 26.4 px. So the first guess is
 * scaled, and then checked and stepped down at the size actually used.
 */
export function fitTextSize(lines: string[], boxW: number, boxH: number, measure: (line: string, size: number) => number): number {
  if (!lines.length || boxW <= 0 || boxH <= 0) return 0
  const widest = (size: number) => Math.max(...lines.map((line) => measure(line, size)))
  let size = boxH / lines.length / 1.2
  const first = widest(size)
  if (first > boxW) size *= boxW / first
  size = Math.max(1, Math.floor(size))
  for (let tries = 0; size > 1 && widest(size) > boxW && tries < 40; tries++) size = Math.max(1, Math.floor(size * 0.97))
  return size
}

export function drawCentrepiece(ctx: Ctx, rect: Rect, opts: CentreOptions, env: PaintEnv) {
  ctx.save()
  ctx.beginPath()
  ctx.rect(rect.x, rect.y, rect.width, rect.height)
  ctx.clip()
  ctx.fillStyle = opts.background
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)

  const pad = Math.min(rect.width, rect.height) * 0.08
  const inner = { x: rect.x + pad, y: rect.y + pad, w: rect.width - pad * 2, h: rect.height - pad * 2 }

  if (opts.content === 'image' && env.image) {
    const p = imagePlacement(env.image.width, env.image.height, inner.w, inner.h, 'contain', 'centre', 'centre')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(env.image, inner.x + p.dx, inner.y + p.dy, p.dw, p.dh)
  } else if (opts.content === 'logo') {
    const k = Math.min(inner.w / LOGO_WIDTH, inner.h / LOGO_HEIGHT)
    ctx.translate(rect.x + (rect.width - LOGO_WIDTH * k) / 2, rect.y + (rect.height - LOGO_HEIGHT * k) / 2)
    ctx.scale(k, k)
    logo().forEach((path, i) => {
      ctx.fillStyle = LOGO_LAYERS[i]!.fill
      ctx.fill(path)
    })
  } else {
    // Text, or the image option with no image chosen yet, which says so rather than showing nothing.
    const lines = opts.content === 'text' ? centreLines(opts.text) : ['No image chosen']
    const measure = (line: string, size: number) => {
      ctx.font = `700 ${size}px ${SANS}`
      return ctx.measureText(line).width
    }
    const size = fitTextSize(lines, inner.w, inner.h, measure)
    if (size > 0) {
      ctx.font = `700 ${size}px ${SANS}`
      ctx.fillStyle = opts.colour
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const lineH = size * 1.2
      const top = rect.y + rect.height / 2 - (lineH * lines.length) / 2 + lineH / 2
      lines.forEach((line, i) => ctx.fillText(line, rect.x + rect.width / 2, top + i * lineH))
    }
  }
  ctx.restore()
}
