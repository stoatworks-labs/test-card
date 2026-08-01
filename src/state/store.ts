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

type State = Persisted & {
  warnings: string[]
  selectedId: string | null

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
    const raw = localStorage.getItem(KEY)
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

const initial: Persisted = load() ?? {
  outputs: [],
  settings: DEFAULT_SETTINGS,
  projectName: 'test-card',
  mode: 'per-output',
}

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
      }),
  }
})

export const _internals = { merge }
