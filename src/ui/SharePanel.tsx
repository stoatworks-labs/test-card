/**
 * Share links: the panel that makes one, and the editor's side of opening one.
 *
 * The link carries the whole setup in its fragment (see state/share.ts), so the
 * same page on another machine opens it to the same pattern on the same outputs.
 * Opening one replaces whatever was set up here, so the banner offers it back.
 *
 * Only the editor opens links. A live window follows the editor's saved state
 * and must never write it (AGENTS.md, rule 12), so it ignores the fragment.
 */

import { useEffect, useRef, useState } from 'react'
import { currentSetup, useStore, type Setup } from '../state/store'
import { decodeShare, encodeShare, shareToken, shareUrl, usesPicture } from '../state/share'
import { DEFAULT_SETTINGS } from '../state/defaults'
import { diff } from '../state/merge'
import { PATTERN_LABELS } from '../patterns/render'

/** Past this many characters, say that some apps cut links short. */
const LONG_LINK = 2000

export function ShareButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className={open ? 'active-outline' : ''} onClick={onClick} aria-expanded={open}>
      Share link
    </button>
  )
}

export function SharePanel({ onClose }: { onClose: () => void }) {
  const outputs = useStore((s) => s.outputs)
  const settings = useStore((s) => s.settings)
  const projectName = useStore((s) => s.projectName)
  const composition = useStore((s) => s.composition)
  const mode = useStore((s) => s.mode)
  const warnings = useStore((s) => s.warnings)
  const hasImage = useStore((s) => s.image !== null)
  const [link, setLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'yes' | 'select' | null>(null)
  const field = useRef<HTMLInputElement>(null)

  // Remade on every change while the panel is open, so the link is always the setup on screen.
  useEffect(() => {
    let live = true
    setCopied(null)
    encodeShare({ outputs, settings, projectName, composition, mode }, warnings).then(
      (token) => {
        if (!live) return
        setLink(shareUrl(location.href, token))
        setError(null)
      },
      (err: Error) => {
        if (live) setError(`This browser could not make a link: ${err.message}`)
      },
    )
    return () => {
      live = false
    }
  }, [outputs, settings, projectName, composition, mode, warnings])

  async function copy() {
    if (!link) return
    try {
      // Absent on plain http, which is how the desktop launcher's copy is reached from another machine.
      await navigator.clipboard.writeText(link)
      setCopied('yes')
    } catch {
      field.current?.select()
      setCopied('select')
    }
  }

  const picture = usesPicture(settings)

  return (
    <section className="panel share-panel">
      <div className="live-head">
        <h2>Share link</h2>
        <span className="spacer" />
        <button className="ghost small" onClick={onClose}>
          Hide
        </button>
      </div>
      <p className="hint">
        Open this link on another computer to get this exact setup: the outputs, the pattern and every
        setting. The setup is written into the link itself, so nothing is uploaded, but anyone you send it to
        can read your output names.
      </p>
      {error ? (
        <p className="hint warn">{error}</p>
      ) : (
        <div className="share-row">
          <input
            ref={field}
            className="share-link"
            readOnly
            value={link ?? 'Making the link…'}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Share link"
            spellCheck={false}
          />
          <button className="primary" onClick={() => void copy()} disabled={!link}>
            Copy link
          </button>
        </div>
      )}
      {copied === 'yes' ? <p className="hint">Copied.</p> : null}
      {copied === 'select' ? (
        <p className="hint">This page can’t reach the clipboard, so the link is selected: copy it from the box.</p>
      ) : null}
      {link && link.length > LONG_LINK ? (
        <p className="hint">
          A long link ({link.length.toLocaleString()} characters), because it carries
          {outputs.some((o) => o.regions.length) ? ' every slice and cabinet of the import' : ' every output'}. Some
          apps cut links this long short; if it arrives broken, send it in an email or a text file.
        </p>
      ) : null}
      {picture ? (
        <p className="hint warn">
          {hasImage
            ? 'Your picture isn’t in the link: load the same picture on the other computer.'
            : 'This pattern shows a picture, and a link can’t carry one: load it on each computer.'}
        </p>
      ) : null}
      {!outputs.length ? (
        <p className="hint warn">There are no outputs yet, so the link carries the pattern and its settings only.</p>
      ) : null}
    </section>
  )
}

/** What opening a link did: replaced the setup (and what it replaced), or failed. */
export type Opened =
  | { ok: true; setup: Setup; previous: ReturnType<typeof currentSetup> }
  | { ok: false; message: string }

/**
 * Open a share link in the page's fragment: at load, and when a link is pasted
 * into a tab that already has the page open (which changes only the fragment,
 * so the page does not reload).
 */
export function useSharedLink(): [Opened | null, () => void] {
  const [opened, setOpened] = useState<Opened | null>(null)
  const replaceSetup = useStore((s) => s.replaceSetup)

  useEffect(() => {
    let live = true
    const open = () => {
      const token = shareToken(location.hash)
      if (!token) return
      decodeShare(token).then(
        (shared) => {
          // Strict mode mounts twice; only the mount still standing applies the link.
          if (!live) return
          const previous = currentSetup()
          replaceSetup(shared.setup, shared.warnings)
          // Off the address, so a reload keeps what is changed from here on.
          dropFragment()
          setOpened({ ok: true, setup: shared.setup, previous })
        },
        (err: Error) => {
          if (!live) return
          dropFragment()
          setOpened({ ok: false, message: err.message })
        },
      )
    }
    open()
    window.addEventListener('hashchange', open)
    return () => {
      live = false
      window.removeEventListener('hashchange', open)
    }
  }, [replaceSetup])

  return [opened, () => setOpened(null)]
}

function dropFragment() {
  history.replaceState(history.state, '', location.pathname + location.search)
}

export function SharedBanner({ opened, onDismiss }: { opened: Opened; onDismiss: () => void }) {
  const replaceSetup = useStore((s) => s.replaceSetup)
  if (!opened.ok) {
    return (
      <div className="callout error">
        <strong>That share link couldn’t be opened</strong>
        <p>{opened.message}</p>
        <div className="btn-row">
          <button className="ghost small" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    )
  }
  const { setup, previous } = opened
  const n = setup.outputs.length
  // Worth offering back when it differs from the link, and was more than an untouched page.
  const hadSomething =
    (previous.setup.outputs.length > 0 || diff(DEFAULT_SETTINGS, previous.setup.settings) !== undefined) &&
    JSON.stringify(previous.setup) !== JSON.stringify(setup)
  return (
    <div className="callout info">
      <strong>Opened a shared setup{setup.projectName !== 'test-card' ? `: ${setup.projectName}` : ''}</strong>
      <p>
        {n ? `${n} output${n === 1 ? '' : 's'}` : 'No outputs'}, {PATTERN_LABELS[setup.settings.kind]}
        {setup.mode === 'composition' ? ', as one composition canvas' : ''}.
        {hadSomething ? ' It replaced what was set up here.' : ''}
      </p>
      {usesPicture(setup.settings) ? (
        <p className="warn">This pattern shows a picture, which a link can’t carry: load the same picture here.</p>
      ) : null}
      <div className="btn-row">
        {hadSomething ? (
          <button
            className="small"
            onClick={() => {
              replaceSetup(previous.setup, previous.warnings)
              onDismiss()
            }}
          >
            Undo, put mine back
          </button>
        ) : null}
        <button className="ghost small" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  )
}
