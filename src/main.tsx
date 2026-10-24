import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import { LiveView } from './ui/LiveView'
import { parseLiveParams } from './live/plan'
import './styles.css'
import { registerServiceWorker } from './register-sw'

// The About dialog's data file ships a version baked at sync time; this is the
// one the build actually produced. Spread, not assign: about-data.js may not
// have run yet, and it merges rather than overwriting. See public/about.js.
window.STOATWORKS_ABOUT = { ...window.STOATWORKS_ABOUT, version: __APP_VERSION__ }

// The same page serves the live windows, so one opens offline wherever the editor does.
const live = parseLiveParams(location.search)
if (live) document.documentElement.classList.add('live')

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')
createRoot(root).render(<StrictMode>{live ? <LiveView params={live} /> : <App />}</StrictMode>)

registerServiceWorker()
