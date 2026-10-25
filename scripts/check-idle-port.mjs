// The idle patterns against Idler, the project they are ported from.
//
//   node scripts/check-idle-port.mjs [path-to-idler]      # default ~/Projects/resolume/idler
//
// Two checks, both against a checkout of Idler, so neither can run in `npm test`:
//
//  - the two scene shaders in src/patterns/idle/gl.ts are Idler's source/Shaders.cpp,
//    character for character;
//  - with the loop fitting switched off (period 0), every saver here builds exactly
//    the mesh, camera and fog Idler's own browser port (demo/plugin.js) builds, for
//    each saver on its as-it-ran preset at three times. That port is itself checked
//    against Idler's C++ by demo/tools/check_geometry.mjs over there.
//
// With fitting on, the savers here deliberately differ from Idler (whole cycles per
// loop, see src/patterns/idle/common.ts); that is what npm test's periodicity checks
// are for. Exits 1 if anything differs.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'

const IDLER = resolve(process.argv[2] ?? join(homedir(), 'Projects/resolume/idler'))
const HERE = resolve(import.meta.dirname, '..')
let failures = 0
const report = (ok, line) => {
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${line}`)
}

// --- shaders ---
const cpp = readFileSync(join(IDLER, 'source/Shaders.cpp'), 'utf8')
const gl = readFileSync(join(HERE, 'src/patterns/idle/gl.ts'), 'utf8')
for (const [fn, name] of [
  ['SceneVertexShader', 'SCENE_VERTEX'],
  ['SceneFragmentShader', 'SCENE_FRAGMENT'],
]) {
  const theirs = new RegExp(`${fn}\\s*\\(\\s*\\)\\s*\\{[\\s\\S]*?static const char\\* source = R"\\(([\\s\\S]*?)\\)";`).exec(cpp)?.[1]
  const ours = new RegExp(`const ${name} = \`([\\s\\S]*?)\``).exec(gl)?.[1]
  report(theirs !== undefined && theirs === ours, `${name} is Shaders.cpp's ${fn}`)
}

// --- meshes ---
const dir = mkdtempSync(join(tmpdir(), 'idle-port-'))
try {
  const bundle = await rolldown({ input: join(HERE, 'src/patterns/idle.ts'), logLevel: 'silent' })
  await bundle.write({ file: join(dir, 'idle.mjs'), format: 'esm' })
  const ours = await import(pathToFileURL(join(dir, 'idle.mjs')).href)
  const idler = await import(pathToFileURL(join(IDLER, 'demo/plugin.js')).href)
  const W = 960
  const H = 540

  const theirScene = (index, time) => {
    const preset = idler.PRESET_TABLE[index]
    const values = {}
    for (const p of idler.buildParams('source')) values[p.id] = p.type === 'text' ? (p.default ?? '') : (p.default ?? 0)
    for (const [k, v] of Object.entries(preset)) if (k !== 'name') values[k] = v
    const s = idler.settingsFromParams({ get: (id) => values[id] }, W, H, time, 'Idler', 0)
    s.saver = preset.saver
    const scene = new idler.Scene()
    idler.SAVER_FACTORIES[preset.saver]().build(s, scene)
    return scene
  }
  const ourScene = (kind, time) => {
    const s = ours.idleSettings(kind, { seed: 1, text: 'Idler', looks: ours.IDLE_AS_IT_RAN }, W / H, 0, 10)
    s.time = time
    s.period = 0
    return ours.buildIdleScene(kind, s)
  }
  const worst = (a, b) => {
    let w = 0
    for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(a[i] - b[i]))
    return a.length === b.length ? w : Infinity
  }

  for (const time of [0, 11.5, 37.25]) {
    ours.IDLE_KINDS.forEach((kind, i) => {
      if (kind === 'marquee' && time === 0) {
        // The one deliberate difference with fitting off: at t = 0 a copy sits exactly on the
        // off-screen edge, and flat.ts's inclusive test leaves out what Idler draws there unseen.
        console.log('skip Scrolling Marquee         t=0  (a copy exactly on the off-screen edge; see flat.ts)')
        return
      }
      const a = ourScene(kind, time)
      const b = theirScene(i, time)
      const mesh = Math.max(...['px', 'py', 'pz', 'nx', 'ny', 'nz', 'cr', 'cg', 'cb', 'ca', 'indices'].map((f) => worst(a.mesh[f], b.mesh[f])))
      const camera = Math.max(worst(a.view, b.view), worst(a.proj, b.proj))
      const fog = Math.abs(a.fogStart - b.fogStart) + Math.abs(a.fogEnd - b.fogEnd)
      report(
        mesh < 1e-9 && camera < 1e-6 && fog < 1e-9 && a.shading === b.shading && a.depthTest === b.depthTest,
        `${idler.SAVER_NAMES[idler.PRESET_TABLE[i].saver].padEnd(22)} t=${time}  ${a.mesh.indices.length / 3} triangles, worst ${mesh.toExponential(1)}`,
      )
    })
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
process.exit(failures ? 1 : 0)
