/**
 * Drawing an idle saver's Scene: WebGL2, with Idler's own scene shaders.
 *
 * Every other pattern here is a 2D canvas painter. These cannot be: five of the
 * savers are perspective 3D with self-overlapping geometry (pipes through their
 * elbows, bricks a hair proud of their mortar), which needs a depth buffer, and
 * a painter's sort of a few hundred thousand triangles would be slower and still
 * wrong where they cross. So the scene is drawn by GL into a canvas of its own
 * and copied into the pattern's 2D context with `drawImage`. That keeps the rest
 * of the app — preview, export, MP4, video tiles, live windows — unchanged: they
 * all still call one painter on a 2D context.
 *
 * The two shaders are Idler's (`source/Shaders.cpp`), copied character for
 * character; `port()` changes the version line and adds precision, nothing
 * else. Idler's second pass, the composite, is left out: on the source plugin
 * it multiplies by Mix, which is 1 here.
 *
 * THE PICTURE IS DRAWN IN PIECES, by cropping the projection. A piece is a
 * window onto the whole frame, so the pieces of one picture are exactly the
 * picture: same sample positions, same depth, same wireframe weight. That one
 * mechanism covers three cases — a raster bigger than a GL canvas should be (a
 * 4x multisampled 8K canvas is over a gigabyte), an output that is one window
 * onto a spanned surface, and a video tile, which is the same raster shifted.
 */

import { mat4Mul, type M4 } from './maths'
import { Shading, type Scene } from './scene'

const SCENE_VERTEX = `#version 410 core

layout( location = 0 ) in vec3 vPosition;
layout( location = 1 ) in vec3 vNormal;
layout( location = 2 ) in vec4 vColour;
layout( location = 3 ) in vec3 vBarycentric;

uniform mat4 View;
uniform mat4 Proj;

out vec3 fNormal;
out vec4 fColour;
out vec3 fBarycentric;
out float fViewDepth;

void main()
{
	vec4 viewPosition = View * vec4( vPosition, 1.0 );

	// mat3( View ) is the correct normal matrix only because nothing here
	// scales non-uniformly -- the savers bake their scaling into the vertex
	// positions on the CPU. If one ever needs a non-uniform model scale it
	// needs the inverse transpose, and the symptom of skipping that is
	// lighting that slides across a stretched face.
	fNormal      = mat3( View ) * vNormal;
	fColour      = vColour;
	fBarycentric = vBarycentric;

	// Positive distance in front of the camera, for the fog. Negated because
	// the camera looks down -Z.
	fViewDepth = -viewPosition.z;

	gl_Position = Proj * viewPosition;
}
`

const SCENE_FRAGMENT = `#version 410 core

in vec3 fNormal;
in vec4 fColour;
in vec3 fBarycentric;
in float fViewDepth;

out vec4 FragColour;

// 0 flat, 1 lit, 2 wireframe. An int rather than three programs because the
// branch is uniform across the draw call and costs nothing measurable, and
// three programs would be three things to keep in step.
uniform int ShadingMode;

// The direction the light travels, in VIEW space -- so the lighting does not
// swing round as a saver's camera orbits. A light fixed in world space reads as
// a searchlight following the object, which is not what any of these did.
uniform vec3 LightDirection;
uniform float Ambient;

// x = start, y = end, in view-space units. Disabled when y <= x.
uniform vec2 FogRange;

// Wireframe line half-width, in pixels.
uniform float EdgeWidth;

void main()
{
	vec3 rgb    = fColour.rgb;
	float alpha = fColour.a;

	if( ShadingMode != 0 )
	{
		vec3 n = normalize( fNormal );

		// Two-sided. The meshes here are closed solids, so a visible back face
		// means the near plane has cut into one -- which happens constantly in
		// 3D Maze, where the camera is inside the corridor. Lighting it by the
		// unflipped normal makes those fragments black and the wall looks
		// holed.
		if( !gl_FrontFacing )
			n = -n;

		float diffuse = max( dot( n, -LightDirection ), 0.0 );

		// Wrapped rather than clamped at the terminator. A pure Lambert on a
		// single light leaves half of every pipe dead black, and the original
		// used a second fill light to avoid exactly that; this is the cheap
		// equivalent.
		diffuse = diffuse * 0.75 + 0.25 * ( 0.5 + 0.5 * dot( n, -LightDirection ) );

		rgb *= Ambient + ( 1.0 - Ambient ) * diffuse;
	}

	if( ShadingMode == 2 )
	{
		// Distance to the nearest edge, in the barycentric's own units, scaled
		// by how fast it changes across a pixel -- which turns it into a
		// distance in pixels and keeps the line the same weight whatever the
		// triangle's size or the output resolution.
		vec3 delta = fwidth( fBarycentric );
		vec3 edges = smoothstep( vec3( 0.0 ), delta * EdgeWidth, fBarycentric );
		float edge = 1.0 - min( min( edges.x, edges.y ), edges.z );

		alpha *= edge;

		// Discard rather than write a transparent fragment: this runs with the
		// depth test on, and a fully transparent fragment still writes depth
		// and would punch a hole in whatever is behind it.
		if( alpha < 0.004 )
			discard;
	}

	if( FogRange.y > FogRange.x )
	{
		float fog = clamp( ( fViewDepth - FogRange.x ) / ( FogRange.y - FogRange.x ), 0.0, 1.0 );

		// Fades toward NOTHING, not toward black. That is what lets a corridor
		// recede into whatever is behind the plugin instead of into a black
		// rectangle the shape of the frame -- and it only works because the
		// target is premultiplied.
		alpha *= 1.0 - fog;
	}

	FragColour = vec4( rgb * alpha, alpha );
}
`

/** Desktop GL 4.1 core to GLSL ES 3.00: the version line and the precision, nothing that changes the maths. */
function port(source: string): string {
  return source.replace(/^#version 410 core\n/, '#version 300 es\nprecision highp float;\nprecision highp int;\n')
}

/** Wireframe half-width in pixels, from Line Width: Idler's, measured on the whole frame. */
export function edgeWidthPixels(lineWidth: number, width: number, height: number): number {
  return 0.5 + (lineWidth * 3 * Math.min(width, height)) / 1080
}

/** The largest piece drawn at once, in device pixels a side. 2048 x 2048 at 4x is about 150 MB. */
const PIECE = 2048

/** pos3, normal3, colour4, barycentric3. */
const FLOATS_PER_VERTEX = 13

type Canvas = HTMLCanvasElement | OffscreenCanvas

class Renderer {
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly vertexBuffer: WebGLBuffer
  private readonly indexBuffer: WebGLBuffer
  private readonly uniforms: Record<string, WebGLUniformLocation | null>
  private upload = new Float32Array(0)
  private indexScratch = new Uint32Array(0)
  readonly piece: number

  constructor(
    readonly canvas: Canvas,
    readonly gl: WebGL2RenderingContext,
  ) {
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, port(source))
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader')
      return shader
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, SCENE_VERTEX))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, SCENE_FRAGMENT))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link')
    this.program = program
    this.uniforms = Object.fromEntries(
      ['View', 'Proj', 'ShadingMode', 'LightDirection', 'Ambient', 'FogRange', 'EdgeWidth'].map((n) => [n, gl.getUniformLocation(program, n)]),
    )

    this.vao = gl.createVertexArray()!
    this.vertexBuffer = gl.createBuffer()!
    this.indexBuffer = gl.createBuffer()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
    const stride = FLOATS_PER_VERTEX * 4
    for (const [location, size, offset] of [
      [0, 3, 0],
      [1, 3, 3],
      [2, 4, 6],
      [3, 3, 10],
    ] as const) {
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * 4)
    }
    gl.bindVertexArray(null)

    const limit = Math.min(
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      ...(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array),
    )
    this.piece = Math.max(256, Math.min(PIECE, limit))
  }

  /**
   * The mesh into the buffers. A shared vertex cannot carry three barycentric
   * corners, so wireframe pays for de-indexing and only wireframe does.
   */
  private uploadMesh(scene: Scene): number {
    const gl = this.gl
    const mesh = scene.mesh
    const deIndex = scene.shading === Shading.Wireframe
    const vertexCount = deIndex ? mesh.indices.length : mesh.px.length
    const indexCount = mesh.indices.length
    if (this.upload.length < vertexCount * FLOATS_PER_VERTEX) this.upload = new Float32Array(vertexCount * FLOATS_PER_VERTEX)
    if (this.indexScratch.length < indexCount) this.indexScratch = new Uint32Array(indexCount)
    const buf = this.upload
    let o = 0
    const push = (i: number, b0: number, b1: number, b2: number) => {
      buf[o] = mesh.px[i]!
      buf[o + 1] = mesh.py[i]!
      buf[o + 2] = mesh.pz[i]!
      buf[o + 3] = mesh.nx[i]!
      buf[o + 4] = mesh.ny[i]!
      buf[o + 5] = mesh.nz[i]!
      buf[o + 6] = mesh.cr[i]!
      buf[o + 7] = mesh.cg[i]!
      buf[o + 8] = mesh.cb[i]!
      buf[o + 9] = mesh.ca[i]!
      buf[o + 10] = b0
      buf[o + 11] = b1
      buf[o + 12] = b2
      o += FLOATS_PER_VERTEX
    }
    if (deIndex) {
      for (let t = 0; t + 2 < indexCount; t += 3) {
        push(mesh.indices[t]!, 1, 0, 0)
        push(mesh.indices[t + 1]!, 0, 1, 0)
        push(mesh.indices[t + 2]!, 0, 0, 1)
        this.indexScratch[t] = t
        this.indexScratch[t + 1] = t + 1
        this.indexScratch[t + 2] = t + 2
      }
    } else {
      for (let i = 0; i < vertexCount; i++) push(i, 1, 1, 1)
      this.indexScratch.set(mesh.indices)
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, buf.subarray(0, vertexCount * FLOATS_PER_VERTEX), gl.STREAM_DRAW)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indexScratch.subarray(0, indexCount), gl.STREAM_DRAW)
    return indexCount
  }

  draw(scene: Scene, frame: Frame, put: PutPiece) {
    const gl = this.gl
    const cw = Math.min(frame.width, this.piece)
    const ch = Math.min(frame.height, this.piece)
    // Grow only: a preview after an export keeps the bigger canvas rather than reallocating it every frame.
    if (this.canvas.width < cw || this.canvas.height < ch) {
      this.canvas.width = Math.max(this.canvas.width, cw)
      this.canvas.height = Math.max(this.canvas.height, ch)
    }
    const indexCount = scene.mesh.empty ? 0 : this.uploadMesh(scene)

    gl.useProgram(this.program)
    const u = this.uniforms
    gl.uniformMatrix4fv(u.View!, false, scene.view)
    gl.uniform1i(u.ShadingMode!, scene.shading)
    gl.uniform3f(u.LightDirection!, scene.lightDirection.x, scene.lightDirection.y, scene.lightDirection.z)
    gl.uniform1f(u.Ambient!, scene.ambient)
    gl.uniform2f(u.FogRange!, scene.fogStart, scene.fogEnd)
    gl.uniform1f(u.EdgeWidth!, frame.edgeWidth)

    if (scene.depthTest) {
      gl.enable(gl.DEPTH_TEST)
      gl.depthFunc(gl.LESS)
    } else gl.disable(gl.DEPTH_TEST)
    // Culling stays off: the Flying Windows logo and a FlowerBox mid-fold are single surfaces seen from both sides.
    gl.disable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendEquation(gl.FUNC_ADD)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.SCISSOR_TEST)

    const bg = scene.background
    for (let y = 0; y < frame.height; y += this.piece) {
      for (let x = 0; x < frame.width; x += this.piece) {
        const pw = Math.min(this.piece, frame.width - x)
        const ph = Math.min(this.piece, frame.height - y)
        // The piece at the canvas's top-left, which is GL's bottom-left plus the spare height.
        const top = this.canvas.height - ph
        gl.viewport(0, top, pw, ph)
        gl.scissor(0, top, pw, ph)
        gl.clearColor(bg.x, bg.y, bg.z, 1)
        gl.clearDepth(1)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        if (indexCount > 0) {
          const crop = cropProjection(frame.full, { x: frame.x + x, y: frame.y + y, width: pw, height: ph })
          gl.uniformMatrix4fv(u.Proj!, false, mat4Mul(crop, scene.proj))
          gl.bindVertexArray(this.vao)
          gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_INT, 0)
          gl.bindVertexArray(null)
        }
        put(this.canvas, pw, ph, x, y)
      }
    }
    gl.disable(gl.SCISSOR_TEST)
  }
}

/**
 * What to draw, in device pixels: the whole frame's size, and the window onto it
 * that this canvas is (`x`, `y` from the frame's top-left; `width` x `height`).
 */
export type Frame = {
  full: { width: number; height: number }
  x: number
  y: number
  width: number
  height: number
  edgeWidth: number
}

/** Called with each finished piece: copy `pw` x `ph` from the canvas's top-left to (x, y) of the window. */
export type PutPiece = (source: CanvasImageSource, pw: number, ph: number, x: number, y: number) => void

/**
 * The matrix that turns the whole frame's clip space into one window's: the
 * window's rectangle of NDC stretched to -1..1. Applied after the projection,
 * so the view, the lighting and the fog never know the frame was cut up.
 */
export function cropProjection(full: { width: number; height: number }, win: { x: number; y: number; width: number; height: number }): M4 {
  const m = new Float32Array(16)
  m[0] = full.width / win.width
  m[5] = full.height / win.height
  m[10] = 1
  m[15] = 1
  // NDC of the window's edges: x from the left, y up from the bottom.
  const left = (2 * win.x) / full.width - 1
  const right = (2 * (win.x + win.width)) / full.width - 1
  const top = 1 - (2 * win.y) / full.height
  const bottom = 1 - (2 * (win.y + win.height)) / full.height
  m[12] = -(left + right) / (right - left)
  m[13] = -(top + bottom) / (top - bottom)
  return m
}

const CONTEXT: WebGLContextAttributes = {
  antialias: true,
  depth: true,
  alpha: false,
  premultipliedAlpha: true,
  // drawImage must see the piece just drawn, not a cleared buffer.
  preserveDrawingBuffer: true,
}

/**
 * A renderer on an OffscreenCanvas, or failing that a DOM canvas: Safari 16.4 to
 * 16.x has OffscreenCanvas but no WebGL2 on it. Null if neither gives a live
 * context, or if one is lost before the shaders compile (a GPU process still
 * restarting hands out contexts that are lost already).
 */
function makeRenderer(): Renderer | null {
  const canvases: (() => Canvas | null)[] = [
    () => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null),
    () => (typeof document !== 'undefined' ? document.createElement('canvas') : null),
  ]
  for (const make of canvases) {
    try {
      const canvas = make()
      const gl = canvas?.getContext('webgl2', CONTEXT) as WebGL2RenderingContext | null | undefined
      if (canvas && gl && !gl.isContextLost()) return new Renderer(canvas, gl)
    } catch {
      // A context lost while compiling throws from a null shader; try the next, or later.
    }
  }
  return null
}

let renderer: Renderer | null = null
/** Once a context has worked, a failure is a loss to wait out, not an absence. */
let everWorked = false
let retryAt = 0
/** How long to leave it between attempts: each costs a canvas and a context request. */
const RETRY_MS = 2000

function getRenderer(): Renderer | null {
  if (renderer && renderer.gl.isContextLost()) renderer = null
  if (renderer) return renderer
  const now = typeof performance !== 'undefined' ? performance.now() : 0
  if (now < retryAt) return null
  renderer = makeRenderer()
  if (renderer) everWorked = true
  else retryAt = now + RETRY_MS
  return renderer
}

/**
 * What happened to a draw: `drawn`; `none`, no WebGL2 here (yet); or `lost`, the
 * context went during this draw or has not come back from an earlier loss.
 */
export type RenderResult = 'drawn' | 'none' | 'lost'

let failures = 0
/** Draws that did not happen since the page loaded. An export checks it did not move. */
export const renderFailures = (): number => failures

/** Draw a scene in pieces, handing each to `put`. */
export function renderScene(scene: Scene, frame: Frame, put: PutPiece): RenderResult {
  const r = getRenderer()
  if (r) {
    r.draw(scene, frame, put)
    if (!r.gl.isContextLost()) return 'drawn'
    renderer = null
  }
  failures += 1
  return everWorked ? 'lost' : 'none'
}

/** For checking context loss by hand from a browser console; nothing in the app uses it. */
export const _internals = { context: (): WebGL2RenderingContext | null => renderer?.gl ?? null }
