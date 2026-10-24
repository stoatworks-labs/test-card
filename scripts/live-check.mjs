// Live output, end to end, in a real Chrome with three pretend displays.
//
//   npm run build && npm run serve:dist     # in another terminal: http://localhost:4327
//   node scripts/live-check.mjs [app-url]
//
// Starts a throwaway headless Chrome (its own profile in the temp folder, so
// nothing touches your browser or your screens) with `--screen-info` describing
// a laptop screen and two projectors, allows the page to manage windows and hold
// a wake lock, and then does what a person would: opens Live output, presses Go
// live with a real user gesture, clicks each live window, closes them all. It
// checks the displays are listed, each output goes to the display its size,
// Chrome's one-window-per-click rule is reported, each window lands over its
// display and goes full screen there at 1:1, and Close every live window closes
// them. Exits 1 if any check fails.
//
// Chrome 138 or later (`--screen-info` is headless only). Set CHROME to use
// another binary. Set SHOT to a .png path to also save the panel with both
// windows live: that's docs/screenshots/live-output.png.
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const APP = new URL(process.argv[2] ?? 'http://localhost:4327/')
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333
const DISPLAYS = [
  { x: 0, w: 3024, h: 1964, extra: "devicePixelRatio=2 label='Built-in' workAreaTop=37" },
  { x: 1512, w: 1920, h: 1080, extra: "isInternal=false label='Projector A'" },
  { x: 3432, w: 1920, h: 1200, extra: "isInternal=false label='Projector B'" },
]

// A Chrome left over from a run that was cut short would answer instead of the
// one started here, with its own displays, and every check would be against it.
if (await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false)) {
  throw new Error(`Something is already listening on port ${PORT}; stop it first.`)
}

const profile = mkdtempSync(join(tmpdir(), 'test-card-live-'))
const chrome = spawn(
  CHROME,
  [
    '--headless',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    `--screen-info=${DISPLAYS.map((d) => `{${d.x},0 ${d.w}x${d.h} ${d.extra}}`).join('')}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
let stderr = ''
chrome.stderr.on('data', (d) => (stderr += d))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (ok, what, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}${!ok && detail !== undefined ? `\n      got: ${JSON.stringify(detail)}` : ''}`)
  if (!ok) failures++
}

let version
for (let i = 0; i < 50 && !version; i++) {
  await sleep(200)
  version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json(), () => null)
}
if (!version) {
  chrome.kill()
  throw new Error(`Chrome did not start:\n${stderr}`)
}
const ws = new WebSocket(version.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let seq = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  const p = m.id && pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result)
}
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
const evaluate = async (session, expression, userGesture = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, session)
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails))
  return r.result.value
}

try {
  console.log(`${version.Browser}, ${APP.href}`)
  await send('Browser.grantPermissions', { origin: APP.origin, permissions: ['windowManagement', 'wakeLockScreen'] })

  const { targetId: editorId } = await send('Target.createTarget', { url: APP.href, newWindow: true, width: 1480, height: 940 })
  const { sessionId: editor } = await send('Target.attachToTarget', { targetId: editorId, flatten: true })
  await sleep(1500)
  // Two outputs, each the size of one projector, listed in the opposite order.
  await evaluate(
    editor,
    `(() => {
      const mk = (id, name, w, h) => ({ id, name, widthPx: w, heightPx: h, rasterSource: 'manual', source: 'manual', regions: [], notes: [], enabled: true })
      localStorage.setItem('test-card/state/1', JSON.stringify({ outputs: [mk('b', 'Wall B', 1920, 1200), mk('a', 'Wall A', 1920, 1080)], projectName: 'live-check', mode: 'per-output' }))
      location.reload()
    })()`,
  )
  await sleep(1500)
  await evaluate(editor, `[...document.querySelectorAll('button')].find(b => b.textContent.startsWith('Live output')).click()`)
  await sleep(1200)

  const rows = await evaluate(
    editor,
    `[...document.querySelectorAll('.live-screens li')].map(li => ({ label: li.querySelector('b').textContent, ticked: li.querySelector('input').checked, shows: li.querySelector('select').value }))`,
  )
  check(rows.length === 3, 'lists all three displays', rows)
  check(rows[0]?.label === 'Built-in' && rows[0]?.ticked === false, 'leaves the editor’s own display unticked', rows[0])
  check(rows[1]?.shows === 'output:a' && rows[2]?.shows === 'output:b', 'gives each output the display its size', rows)

  const livePages = async () =>
    (await send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page' && t.url.includes('?live='))
  const goLive = () => evaluate(editor, `document.querySelector('.live-actions button.primary').click()`, true)

  await goLive()
  await sleep(2000)
  check((await livePages()).length === 1, 'one window per click, as Chrome allows', (await livePages()).map((p) => p.url))
  await sleep(3000)
  const panel = await evaluate(editor, `document.querySelector('.live-panel').innerText`)
  check(/Projector B didn’t open/.test(panel), 'says which display’s window did not open', panel)

  await goLive()
  await sleep(2500)
  const pages = await livePages()
  check(pages.length === 2, 'the second click opens the second window', pages.map((p) => p.url))

  for (const p of pages) {
    const label = new URL(p.url).searchParams.get('label')
    const display = DISPLAYS.find((d) => d.extra.includes(`'${label}'`))
    const { bounds } = await send('Browser.getWindowForTarget', { targetId: p.targetId })
    check(bounds.left === display?.x && bounds.top === 0, `${label}: opens over its display`, bounds)
    const { sessionId } = await send('Target.attachToTarget', { targetId: p.targetId, flatten: true })
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: 200, y: 200, button: 'left', clickCount: 1 }, sessionId)
    }
    await sleep(1500)
    const after = await evaluate(
      sessionId,
      `({ fullscreen: !!document.fullscreenElement, canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height] })`,
    )
    const { bounds: fs } = await send('Browser.getWindowForTarget', { targetId: p.targetId })
    check(after.fullscreen && fs.windowState === 'fullscreen' && fs.left === display?.x, `${label}: a click makes it full screen on its display`, { after, fs })
    check(after.canvas[0] === display?.w && after.canvas[1] === display?.h, `${label}: its canvas is the display’s raster`, after.canvas)
  }

  await sleep(1500)
  const live = await evaluate(editor, `document.querySelector('.live-windows')?.innerText ?? ''`)
  check((live.match(/full screen · 1:1(?! ·)/g) ?? []).length === 2, 'the editor sees both, full screen, 1:1, display held awake', live)

  if (process.env.SHOT) {
    const r = await evaluate(
      editor,
      `(() => { const p = document.querySelector('.live-panel'); p.scrollIntoView({ block: 'start', behavior: 'instant' }); const b = p.getBoundingClientRect(); return { x: b.x + scrollX, y: b.y + scrollY, w: b.width, h: b.height } })()`,
    )
    const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x - 12, y: r.y - 12, width: r.w + 24, height: r.h + 24, scale: 1 } }, editor)
    writeFileSync(process.env.SHOT, Buffer.from(data, 'base64'))
    console.log(`saved ${process.env.SHOT}`)
  }

  // One closed the way a person would, from the window itself...
  await send('Target.closeTarget', { targetId: pages[0].targetId })
  await sleep(1500)
  const byHand = await evaluate(editor, `document.querySelectorAll('.live-windows li').length`)
  check(byHand === 1, 'a window closed by hand drops off the editor’s list', byHand)
  // ...and the rest from the editor.
  await evaluate(editor, `[...document.querySelectorAll('button')].find(b => b.textContent === 'Close every live window').click()`)
  await sleep(1500)
  check((await livePages()).length === 0, 'Close every live window closes them', (await livePages()).map((p) => p.url))
  await sleep(3500)
  const after = await evaluate(editor, `document.querySelector('.live-panel').innerText`)
  check(!/didn’t open/.test(after) && !/Live now/i.test(after), 'and doesn’t later call them windows that never opened', after)
} finally {
  ws.close()
  chrome.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}
console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
