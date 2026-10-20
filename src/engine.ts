/**
 * Test Card's pattern engine, for embedding in something that is not this app.
 *
 * Everything an embedder needs to draw a pattern for an Output it built
 * itself: the settings and their defaults, the painters behind them, and the
 * canvas limits. No React, no store, no IndexedDB — this entry must stay
 * importable from a plain page with nothing but a 2D canvas, because that is
 * what LivePremier Plus does with it: it bundles this file with rolldown
 * (`tools/sync-test-card.mjs` there), builds Outputs from a switcher's own
 * output and canvas geometry, and puts the result on the switcher as a still.
 *
 * Changing what this exports changes LivePremier Plus's vendored copy the next
 * time it syncs. Add freely; rename or remove only with that in mind.
 * `engine.test.ts` holds the import graph to the rule above.
 */

export type {
  Output,
  Region,
  Rect,
  PatternKind,
  PatternSettings,
  LevelRange,
  BrokenFault,
  DinosaurId,
  RenderMode,
} from './types'

export { DEFAULT_SETTINGS } from './state/defaults'

export {
  PATTERN_LABELS,
  MAX_SIDE_PX,
  MAX_AREA_PX,
  canvasLimitProblem,
  paintPattern,
  renderOutputTo,
  renderCompositionTo,
  overlayLines,
  stillTime,
  setPatternImage,
} from './patterns/render'

export { isAnimated, isScaleAware } from './patterns/env'
export { FAULT_LABELS, ALL_FAULTS } from './patterns/broken'
export { LINEUP_ORDER, SPECIES } from './patterns/art/dinosaurs'
