/**
 * A pretend 2D context that records what a painter draws, for tests that run
 * without a browser.
 *
 * It keeps the transform and the save/restore stack the way a canvas does, and
 * writes down every fill, stroke and text in DEVICE space, with its style and
 * alpha. So a test can ask whether frame N draws exactly what frame 0 drew,
 * whether two outputs of a span draw the same thing where they overlap, and
 * whether a painter leaves the context as it found it. It doesn't rasterise
 * anything: a match here means the same geometry, not the same pixels.
 *
 * Written for the Halloween review (2026-10-21), which used it to check the
 * painters for seams, state leaks and span disagreement.
 */

type Matrix = [number, number, number, number, number, number]

const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export type Drawn = {
  op: string
  style: string
  alpha: number
  pts: [number, number][]
  /** x0, y0, x1, y1 in device space. */
  box: [number, number, number, number]
}

class Gradient {
  stops: string[] = []
  constructor(
    private args: number[],
    private m: Matrix,
    private bad: string[],
  ) {}
  addColorStop(at: number, colour: string) {
    if (!/^#|^rgba?\(/.test(colour) || /NaN|undefined/.test(colour)) this.bad.push(`colour stop ${colour}`)
    this.stops.push(`${at}:${colour}`)
  }
  /** The gradient in device space, so two outputs drawing the same one agree. */
  key(): string {
    const a = this.args
    const k = Math.hypot(this.m[0], this.m[1])
    const pts =
      a.length === 4
        ? [...apply(this.m, a[0]!, a[1]!), ...apply(this.m, a[2]!, a[3]!)]
        : [...apply(this.m, a[0]!, a[1]!), a[2]! * k, ...apply(this.m, a[3]!, a[4]!), a[5]! * k]
    return `gradient(${pts.map((v) => v.toFixed(1)).join(',')}|${this.stops.join(';')})`
  }
}

/** Stands in for `Path2D`, which Node doesn't have. */
export class RecordingPath {
  cmds: number[][] = []
  moveTo(x: number, y: number) {
    this.cmds.push([x, y])
  }
  lineTo(x: number, y: number) {
    this.cmds.push([x, y])
  }
  quadraticCurveTo(a: number, b: number, x: number, y: number) {
    this.cmds.push([a, b, x, y])
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
    this.cmds.push([a, b, c, d, x, y])
  }
  closePath() {}
}

export class RecordingContext {
  m: Matrix
  stack: { m: Matrix; state: Record<string, unknown> }[] = []
  drawn: Drawn[] = []
  /** Anything a real canvas would choke on, or a painter should never do. */
  bad: string[] = []
  private path: [number, number][] = []
  fillStyle: unknown = '#000000'
  strokeStyle: unknown = '#000000'
  globalAlpha = 1
  lineWidth = 1
  lineCap = 'butt'
  lineJoin = 'miter'
  font = '10px sans-serif'
  textAlign = 'start'
  textBaseline = 'alphabetic'
  imageSmoothingEnabled = true

  constructor(m: Matrix = [1, 0, 0, 1, 0, 0]) {
    this.m = m
  }

  private check(name: string, args: number[]) {
    if (args.some((a) => !Number.isFinite(a))) this.bad.push(`${name}(${args.join(',')})`)
  }
  private point(x: number, y: number) {
    this.path.push(apply(this.m, x, y))
  }
  private record(op: string, style: unknown, pts: [number, number][]) {
    if (!pts.length) return
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    this.drawn.push({
      op,
      style: style instanceof Gradient ? style.key() : String(style),
      alpha: this.globalAlpha,
      pts,
      box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    })
  }

  save() {
    const { fillStyle, strokeStyle, globalAlpha, lineWidth, lineCap, lineJoin, font, textAlign, textBaseline } = this
    this.stack.push({ m: this.m, state: { fillStyle, strokeStyle, globalAlpha, lineWidth, lineCap, lineJoin, font, textAlign, textBaseline } })
  }
  restore() {
    const top = this.stack.pop()
    if (!top) {
      this.bad.push('restore without save')
      return
    }
    this.m = top.m
    Object.assign(this, top.state)
  }
  translate(x: number, y: number) {
    this.check('translate', [x, y])
    this.m = multiply(this.m, [1, 0, 0, 1, x, y])
  }
  scale(x: number, y: number) {
    this.check('scale', [x, y])
    this.m = multiply(this.m, [x, 0, 0, y, 0, 0])
  }
  rotate(a: number) {
    this.check('rotate', [a])
    this.m = multiply(this.m, [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0])
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.m = [a, b, c, d, e, f]
  }
  getTransform() {
    const [a, b, c, d, e, f] = this.m
    return { a, b, c, d, e, f }
  }
  resetTransform() {
    // A video tile is the whole picture translated: a reset loses the translation.
    this.bad.push('resetTransform')
    this.m = [1, 0, 0, 1, 0, 0]
  }
  beginPath() {
    this.path = []
  }
  moveTo(x: number, y: number) {
    this.check('moveTo', [x, y])
    this.point(x, y)
  }
  lineTo(x: number, y: number) {
    this.check('lineTo', [x, y])
    this.point(x, y)
  }
  quadraticCurveTo(a: number, b: number, x: number, y: number) {
    this.check('quadraticCurveTo', [a, b, x, y])
    this.point(a, b)
    this.point(x, y)
  }
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number) {
    this.check('bezierCurveTo', [a, b, c, d, x, y])
    this.point(a, b)
    this.point(c, d)
    this.point(x, y)
  }
  closePath() {}
  arc(x: number, y: number, r: number, a0: number, a1: number) {
    this.check('arc', [x, y, r, a0, a1])
    if (r < 0) this.bad.push(`arc radius ${r}`)
    this.point(x - r, y - r)
    this.point(x + r, y + r)
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number) {
    this.check('ellipse', [x, y, rx, ry, rotation])
    if (rx < 0 || ry < 0) this.bad.push(`ellipse radius ${rx},${ry}`)
    const r = Math.max(rx, ry)
    this.point(x - r, y - r)
    this.point(x + r, y + r)
  }
  rect(x: number, y: number, w: number, h: number) {
    this.check('rect', [x, y, w, h])
    this.point(x, y)
    this.point(x + w, y + h)
  }
  clip() {}
  fill(path?: RecordingPath) {
    if (path instanceof RecordingPath) {
      const pts: [number, number][] = []
      for (const c of path.cmds) for (let i = 0; i + 1 < c.length; i += 2) pts.push(apply(this.m, c[i]!, c[i + 1]!))
      this.record('fill path', this.fillStyle, pts)
    } else this.record('fill', this.fillStyle, this.path)
  }
  stroke() {
    this.record('stroke', this.strokeStyle, this.path)
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.check('fillRect', [x, y, w, h])
    this.record('fillRect', this.fillStyle, [apply(this.m, x, y), apply(this.m, x + w, y + h)])
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.record('strokeRect', this.strokeStyle, [apply(this.m, x, y), apply(this.m, x + w, y + h)])
  }
  fillText(text: string, x: number, y: number) {
    this.check('fillText', [x, y])
    this.record(`text ${text}`, this.fillStyle, [apply(this.m, x, y)])
  }
  measureText(text: string) {
    return { width: text.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }
  }
  createLinearGradient(...a: number[]) {
    this.check('createLinearGradient', a)
    return new Gradient(a, this.m, this.bad)
  }
  createRadialGradient(...a: number[]) {
    this.check('createRadialGradient', a)
    if (a[2]! < 0 || a[5]! < 0) this.bad.push(`gradient radius ${a.join(',')}`)
    return new Gradient(a, this.m, this.bad)
  }
  setLineDash() {}
  drawImage() {
    this.record('drawImage', '', [apply(this.m, 0, 0)])
  }

  /** The context as a painter's type, for passing to one. */
  get ctx(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D
  }
}

/** Give Node a `Path2D` for painters that build one. Call before importing them. */
export function installPath2D() {
  ;(globalThis as Record<string, unknown>).Path2D = RecordingPath
}

/** One drawn thing as a string, to two decimal places in device space. */
export function drawnKey(d: Drawn): string {
  return `${d.op}|${d.style}|${d.alpha.toFixed(3)}|${d.pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}`
}
