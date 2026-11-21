/**
 * Laying a partial set of settings over a full one.
 *
 * Shared by the store (a saved state from an older build gains any option added
 * since) and by share links (a link carries only what differs from the defaults).
 */

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

export function merge<T>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as Record<string, unknown>
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue
    const cur = out[k]
    // Arrays are values here (safe areas), not things to merge element-wise.
    out[k] = isRecord(v) && isRecord(cur) ? merge(cur, v as DeepPartial<unknown>) : v
  }
  return out as T
}

/**
 * `merge`, for a patch that came from outside: a share link someone pasted.
 *
 * Only keys the base already has are taken, and only when the value is the same
 * sort of thing as the base's (a number for a number, an array for an array). A
 * key from a newer build is dropped rather than carried along, and a damaged
 * value leaves the base's in place rather than reaching a painter as `NaN` or a
 * string where it wanted a number.
 */
export function mergeKnown<T>(base: T, patch: unknown): T {
  if (!isRecord(base) || !isRecord(patch)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, cur] of Object.entries(base)) {
    if (!Object.hasOwn(patch, k)) continue
    const v = patch[k]
    if (isRecord(cur)) {
      out[k] = mergeKnown(cur, v)
    } else if (Array.isArray(cur)) {
      if (Array.isArray(v)) out[k] = v
    } else if (typeof v === typeof cur && (typeof v !== 'number' || Number.isFinite(v))) {
      out[k] = v
    }
  }
  return out as T
}

/**
 * What `value` has that `base` doesn't: the smallest patch that `merge` turns
 * back into `value`. Undefined when there is no difference. Arrays are compared
 * whole and carried whole, to match `merge`.
 */
export function diff<T>(base: T, value: T): DeepPartial<T> | undefined {
  if (isRecord(base) && isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      const d = diff(base[k], v)
      if (d !== undefined) out[k] = d
    }
    return Object.keys(out).length ? (out as DeepPartial<T>) : undefined
  }
  return JSON.stringify(base) === JSON.stringify(value) ? undefined : (value as DeepPartial<T>)
}
