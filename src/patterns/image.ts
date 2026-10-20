/**
 * Your own picture, fitted to the raster.
 *
 * The fit is pure maths — where the image's rectangle lands — so the five modes
 * are tested rather than eyeballed. "Native" and "tile" place the image at
 * whole-pixel positions and 1:1, which is what you want when the picture IS a
 * test pattern made elsewhere: any scaling at all would blur its 1px detail.
 */

import type { ImageFit, ImageOptions } from '../types'
import type { Ctx } from './draw'
import type { PaintEnv } from './env'

export type Placement = { dx: number; dy: number; dw: number; dh: number }

export function imagePlacement(
  imgW: number,
  imgH: number,
  boxW: number,
  boxH: number,
  fit: ImageFit,
  anchorX: ImageOptions['anchorX'],
  anchorY: ImageOptions['anchorY'],
): Placement {
  let dw: number
  let dh: number
  switch (fit) {
    case 'stretch':
      return { dx: 0, dy: 0, dw: boxW, dh: boxH }
    case 'contain': {
      const s = Math.min(boxW / imgW, boxH / imgH)
      dw = imgW * s
      dh = imgH * s
      break
    }
    case 'cover': {
      const s = Math.max(boxW / imgW, boxH / imgH)
      dw = imgW * s
      dh = imgH * s
      break
    }
    default:
      dw = imgW
      dh = imgH
  }
  const ax = anchorX === 'left' ? 0 : anchorX === 'right' ? 1 : 0.5
  const ay = anchorY === 'top' ? 0 : anchorY === 'bottom' ? 1 : 0.5
  // `+ 0` turns the -0 a top-left anchor gives on an overflowing image into 0.
  let dx = (boxW - dw) * ax + 0
  let dy = (boxH - dh) * ay + 0
  if (fit === 'native' || fit === 'tile') {
    // Whole pixels, or a 1:1 image is resampled across a half-pixel and blurs.
    dx = Math.round(dx)
    dy = Math.round(dy)
  }
  return { dx, dy, dw, dh }
}

export function drawImagePattern(ctx: Ctx, w: number, h: number, opts: ImageOptions, env: PaintEnv) {
  ctx.fillStyle = opts.background
  ctx.fillRect(0, 0, w, h)
  const img = env.image
  if (!img || !img.width || !img.height) {
    const size = Math.max(14, Math.min(w, h) / 22)
    ctx.fillStyle = '#888888'
    ctx.font = `${Math.round(size)}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('No image loaded — choose one under Pattern → Image', w / 2, h / 2)
    return
  }
  const box = env.world
  const p = imagePlacement(img.width, img.height, box.widthPx, box.heightPx, opts.fit, opts.anchorX, opts.anchorY)
  ctx.save()
  ctx.translate(-env.view.x, -env.view.y)
  ctx.imageSmoothingEnabled = opts.smoothing && opts.fit !== 'native' && opts.fit !== 'tile'
  ctx.imageSmoothingQuality = 'high'
  if (opts.fit === 'tile') {
    // A repeating pattern rather than one drawImage per tile: a 1 px image
    // tiled over an 8K surface would otherwise be 33 million calls.
    const pattern = ctx.createPattern(img, 'repeat')
    if (pattern) {
      pattern.setTransform(new DOMMatrix().translate(p.dx, p.dy))
      ctx.fillStyle = pattern
      ctx.fillRect(env.view.x, env.view.y, w, h)
    }
  } else {
    ctx.drawImage(img, p.dx, p.dy, p.dw, p.dh)
  }
  ctx.restore()
}
