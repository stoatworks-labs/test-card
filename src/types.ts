/**
 * Test Card — core domain types.
 *
 * The unit of work is an **Output**: one physical video output, with a raster
 * size in pixels. Everything else — patterns, exports, filenames — hangs off a
 * list of Outputs. An importer's only job is to turn a file into Outputs.
 *
 * PROVENANCE: every Output records where its raster came from (`rasterSource`).
 * A raster read from an explicit device declaration is trustworthy; one inferred
 * from the bounding box of some slices is a best guess and is badged as such in
 * the UI. Do not collapse the two — being wrong about an output's size produces
 * a pattern that looks plausible and is useless on site.
 */

export type RasterSource =
  /** An OutputDeviceVirtual/Display/Capture carried an explicit width+height. */
  | 'declared'
  /** Derived from the bounding box of the screen's slice OutputRects. */
  | 'slice-bounds'
  /** Computed from a design file's own geometry (Pixel Peeker, Blend Calc). */
  | 'computed'
  /** Typed in by the user. */
  | 'manual'

export type ImportSource =
  | 'resolume'
  | 'pixel-peeker'
  | 'blend-calc'
  | 'manual'

/**
 * A rectangle in pixels. `x`/`y` are the top-left corner. Used for slices,
 * cabinets and tiles alike; all of them are axis-aligned.
 */
export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A region of an output that came from the source file — a Resolume slice, or
 * an LED cabinet. Drawn as an annotation overlay so an operator can see, on the
 * physical wall, which slice or cabinet each block of pixels belongs to.
 */
export type Region = {
  id: string
  /** Short label drawn in the region, e.g. "Slice 3" or "A12". */
  label: string
  /** Longer label for the legend, e.g. "MX40 Pro / Port 7". */
  detail?: string
  /** Where the region sits within THIS output's raster. */
  rect: Rect
  /**
   * Where the region reads from in the composition, when the source knew.
   * Only Resolume slices carry this; it is what the composition-canvas mode
   * uses to place each output's block on the shared canvas.
   */
  input?: Rect
  /** Position in a chain / patch order, 1-based. 0 or undefined = not patched. */
  order?: number
  /** Stable grouping key — a Resolume screen, or an LED processor port. */
  group?: string
}

/** One physical video output. */
export type Output = {
  id: string
  /** Screen/output name as it appeared in the source file. */
  name: string
  widthPx: number
  heightPx: number
  rasterSource: RasterSource
  source: ImportSource
  /** Included in the pattern's burn-in text, e.g. "DeckLink Duo (2)". */
  device?: string
  /**
   * Region of the composition this output shows, when known. Drives the
   * composition-canvas render mode.
   */
  compositionRect?: Rect
  /** Slices / cabinets inside this output. May be empty. */
  regions: Region[]
  /** Anything the importer wants the user to know about this specific output. */
  notes: string[]
  /** Excluded from render/export without being deleted. */
  enabled: boolean
}

/** What an importer returns. */
export type ImportResult = {
  source: ImportSource
  /** Name of the design/composition, used for the ZIP filename. */
  projectName: string
  outputs: Output[]
  /** Composition size, when the file declared one. */
  composition?: { widthPx: number; heightPx: number }
  /** Import-level warnings — shown once, above the output list. */
  warnings: string[]
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

export type PatternKind =
  | 'smpte-rp219'
  | 'ebu-bars'
  | 'grid'
  | 'alignment'
  | 'led-tiles'
  | 'solid'
  | 'greyscale'
  | 'pixel-check'

/**
 * Output level range.
 *
 * `full`  — 0..255. What you want when the PNG goes to a media server output,
 *           a projector fed from a GPU, or an LED processor over HDMI/DP set to
 *           full range. This is the default because that is the common case.
 * `legal` — 16..235. Matches a broadcast/SDI chain. Choose this when the PNG is
 *           going down an SDI path that expects studio swing, or the "white"
 *           patch will clip and you will not see the top of the ramp.
 */
export type LevelRange = 'full' | 'legal'

export type GridOptions = {
  /** How the grid is specified. */
  mode: 'spacing' | 'divisions'
  /** Cell size in pixels, when mode = 'spacing'. */
  spacingPx: number
  /** Number of cells across/down, when mode = 'divisions'. */
  divisionsX: number
  divisionsY: number
  lineWidthPx: number
  /** Every Nth line is drawn heavier. 0 = off. */
  majorEvery: number
  majorLineWidthPx: number
  colour: string
  majorColour: string
  background: string
  /** Draw the cell coordinate in each cell. */
  labelCells: boolean
  /** Draw a diagonal cross corner-to-corner. */
  diagonals: boolean
  /** Draw a centre crosshair and centre circle. */
  centreMarks: boolean
  /** Anchor the grid at the centre of the raster rather than the top-left. */
  originCentre: boolean
}

export type AlignmentOptions = {
  /** 1px border hard against the raster edge — proves nothing is cropped. */
  edgeBorder: boolean
  /** Corner L-brackets with pixel counts. */
  cornerMarkers: boolean
  cornerSizePx: number
  /** Centre cross + concentric circles (circles prove the aspect is right). */
  centreTarget: boolean
  /** Nested safe-area rectangles, as a percentage inset. */
  safeAreas: number[]
  /** Fine 1px checkerboard patches — reveals any scaling in the chain. */
  pixelPatches: boolean
  /** Corner-to-corner diagonals. */
  diagonals: boolean
  background: string
  colour: string
}

/**
 * LED tile grid.
 *
 * Two sources of truth, and they behave differently:
 *  - `uniform`  the user states a tile pixel size, and the raster is tiled from
 *               an origin. Right for a plain rectangular wall.
 *  - `cabinets` the actual cabinet rectangles imported from Pixel Peeker, which
 *               may be irregular, may not tile the raster, and carry chain order
 *               and port labels. Always better when available.
 */
export type LedTileOptions = {
  source: 'uniform' | 'cabinets'
  tileWidthPx: number
  tileHeightPx: number
  /** Offset of the first tile's top-left corner within the raster. */
  originXPx: number
  originYPx: number
  /** Alternate the tile fill like a chessboard. */
  checker: boolean
  checkerColourA: string
  checkerColourB: string
  borderColour: string
  borderWidthPx: number
  /** Draw row/column references (A1, B2 …) in each tile. */
  labelTiles: boolean
  /** Draw the chain order number, when cabinets carry one. */
  labelOrder: boolean
  /** Give each port/group its own hue, so a mis-patched port is obvious. */
  colourByGroup: boolean
}

export type SolidOptions = {
  /** Named field, or a custom CSS colour. */
  field:
    | 'white'
    | 'black'
    | 'red'
    | 'green'
    | 'blue'
    | 'cyan'
    | 'magenta'
    | 'yellow'
    | 'grey50'
    | 'grey18'
    | 'custom'
  custom: string
  /** Percentage of full scale for the named fields. 100 = full. */
  levelPct: number
}

export type GreyscaleOptions = {
  /** 0 = a continuous ramp; otherwise that many discrete steps. */
  steps: number
  vertical: boolean
  /** Split the field into an R, G, B and neutral strip. */
  perChannel: boolean
}

export type PixelCheckOptions = {
  /** Checker cell size. 1 = single-pixel checkerboard. */
  cellPx: number
  /** Add 1px horizontal and vertical line bursts, for LED scan artefacts. */
  lineBursts: boolean
}

/** Text burned into the corner of every pattern. */
export type OverlayOptions = {
  enabled: boolean
  /** Output name. */
  showName: boolean
  /** "1920 x 1080". */
  showResolution: boolean
  /** Pattern name and level range. */
  showPattern: boolean
  /** Free text — show name, date, LD's initials. */
  customText: string
  /** Approximate cap height in pixels; 0 = scale to the raster. */
  fontSizePx: number
  colour: string
  /** Draw a contrasting plate behind the text so it reads on any pattern. */
  plate: boolean
  position: 'top-left' | 'top-centre' | 'centre' | 'bottom-centre' | 'bottom-left'
}

/** Draw imported slice/cabinet outlines on top of whatever pattern is chosen. */
export type RegionOverlayOptions = {
  enabled: boolean
  outlines: boolean
  labels: boolean
  colour: string
  lineWidthPx: number
}

export type PatternSettings = {
  kind: PatternKind
  levels: LevelRange
  grid: GridOptions
  alignment: AlignmentOptions
  led: LedTileOptions
  solid: SolidOptions
  greyscale: GreyscaleOptions
  pixelCheck: PixelCheckOptions
  overlay: OverlayOptions
  regionOverlay: RegionOverlayOptions
}

/**
 * What gets rendered.
 *
 * `per-output`   one PNG per output, at that output's raster size. Send each
 *                file to the output it names.
 * `composition`  a single PNG at composition size, with each output's input
 *                region drawn and labelled. Play this through Resolume and every
 *                output should show its own label — which is the fastest way to
 *                prove the advanced output map is what you think it is.
 */
export type RenderMode = 'per-output' | 'composition'
