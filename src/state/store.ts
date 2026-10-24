/**
 * App state.
 *
 * Persisted to localStorage so a half-configured set of outputs survives a
 * refresh on a show site with a flaky connection. Only the outputs and the
 * settings are stored — never a rendered image, which would blow the quota on
 * the first 4K pattern.
 */

import { create } from 'zustand'
import type { ImportResult, Output, PatternSettings, RenderMode } from '../types'
import { DEFAULT_SETTINGS } from './defaults'

const KEY = 'test-card/state/1'

type Persisted = {
  outputs: Output[]
  settings: PatternSettings
  projectName: string
  composition?: { widthPx: number; heightPx: number }
  mode: RenderMode
}

/** What is known about the loaded image. The pixels live in render.ts, never here. */
export type ImageInfo = { name: string; width: number; height: number; version: number }

type State = Persisted & {
  warnings: string[]
  selectedId: string | null
  /** Not persisted: the image itself is in IndexedDB, see image-store.ts. */
  image: ImageInfo | null
  setImage: (info: Omit<ImageInfo, 'version'> | null) => void

  loadImport: (result: ImportResult) => void
  addManualOutput: (name: string, width: number, height: number) => void
  updateOutput: (id: string, patch: Partial<Output>) => void
  removeOutput: (id: string) => void
  setAllEnabled: (enabled: boolean) => void
  select: (id: string | null) => void
  setMode: (mode: RenderMode) => void
  setProjectName: (name: string) => void
  patchSettings: (patch: DeepPartial<PatternSettings>) => void
  reset: () => void
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

function merge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue
    const cur = out[k]
    // Arrays are values here (safe areas), not things to merge element-wise.
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object'
        ? merge(cur, v as DeepPartial<unknown>)
        : v
  }
  return out as T
}

function load(): Persisted | null {
  try {
    return parse(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

function parse(raw: string | null): Persisted | null {
  try {
    if (!raw) return null
    const parsed = JSON.parse(raw) as Persisted
    if (!Array.isArray(parsed.outputs)) return null
    // Settings are merged over the defaults so a stored state from an older
    // build gains any newly added option instead of rendering with it undefined.
    return { ...parsed, settings: merge(DEFAULT_SETTINGS, parsed.settings ?? {}) }
  } catch {
    return null
  }
}

const EMPTY: Persisted = {
  outputs: [],
  settings: DEFAULT_SETTINGS,
  projectName: 'test-card',
  mode: 'per-output',
}

const initial: Persisted = load() ?? EMPTY

export const useStore = create<State>((set, get) => {
  const persist = () => {
    const { outputs, settings, projectName, composition, mode } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ outputs, settings, projectName, composition, mode }))
    } catch {
      // Quota or private browsing — losing persistence is not worth an error.
    }
  }

  const after = <T extends Partial<State>>(patch: T) => {
    set(patch)
    persist()
  }

  return {
    ...initial,
    warnings: [],
    selectedId: initial.outputs[0]?.id ?? null,
    image: null,
    setImage: (info) => set({ image: info ? { ...info, version: (get().image?.version ?? 0) + 1 } : null }),

    loadImport: (result) =>
      after({
        outputs: result.outputs,
        projectName: result.projectName,
        composition: result.composition,
        warnings: result.warnings,
        selectedId: result.outputs[0]?.id ?? null,
        // A design with no composition size cannot render composition mode, so
        // do not leave the app pointing at a mode it cannot fulfil.
        mode: result.composition ? get().mode : 'per-output',
      }),

    addManualOutput: (name, width, height) => {
      const output: Output = {
        id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        widthPx: width,
        heightPx: height,
        rasterSource: 'manual',
        source: 'manual',
        regions: [],
        notes: [],
        enabled: true,
      }
      after({ outputs: [...get().outputs, output], selectedId: output.id })
    },

    updateOutput: (id, patch) =>
      after({ outputs: get().outputs.map((o) => (o.id === id ? { ...o, ...patch } : o)) }),

    removeOutput: (id) => {
      const outputs = get().outputs.filter((o) => o.id !== id)
      after({
        outputs,
        selectedId: get().selectedId === id ? (outputs[0]?.id ?? null) : get().selectedId,
      })
    },

    setAllEnabled: (enabled) =>
      after({ outputs: get().outputs.map((o) => ({ ...o, enabled })) }),

    select: (selectedId) => set({ selectedId }),
    setMode: (mode) => after({ mode }),
    setProjectName: (projectName) => after({ projectName }),
    patchSettings: (patch) => after({ settings: merge(get().settings, patch) }),

    reset: () =>
      after({
        outputs: [],
        settings: DEFAULT_SETTINGS,
        projectName: 'test-card',
        composition: undefined,
        warnings: [],
        selectedId: null,
        mode: 'per-output',
        image: null,
      }),
  }
})

/**
 * Keep this page's state in step with what another tab saves.
 *
 * For live windows: they show what the editor has set up, and the editor
 * already writes every change to localStorage, which fires `storage` in every
 * other page of this origin. Nothing is written back from here, so a live
 * window can never overwrite the editor's state with a stale copy.
 *
 * What hasn't changed stays the same object, so renaming the project or nudging
 * one setting doesn't make a live window redraw everything else.
 */
export function followSavedState(): () => void {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const apply = (raw: string | null) => {
    if (raw === null) {
      useStore.setState({ ...EMPTY, composition: undefined })
      return
    }
    // Something unreadable is ignored rather than taken as "empty".
    const next = parse(raw)
    if (!next) return
    const cur = useStore.getState()
    useStore.setState({
      outputs: same(cur.outputs, next.outputs) ? cur.outputs : next.outputs,
      settings: same(cur.settings, next.settings) ? cur.settings : next.settings,
      composition: same(cur.composition, next.composition) ? cur.composition : next.composition,
      projectName: next.projectName,
      mode: next.mode,
    })
  }
  const onStorage = (e: StorageEvent) => {
    // A null key is the whole of storage being cleared.
    if (e.key !== KEY && e.key !== null) return
    apply(e.key === null ? null : e.newValue)
  }
  window.addEventListener('storage', onStorage)
  // Anything saved between this page reading its state and listening for more.
  try {
    apply(localStorage.getItem(KEY))
  } catch {
    // No storage to read: nothing to follow either.
  }
  return () => window.removeEventListener('storage', onStorage)
}

export const _internals = { merge }
