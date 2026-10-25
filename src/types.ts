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
  /**
   * Physical size of one pixel, in millimetres — the LED pixel pitch, or a
   * projected image's width divided by its raster. Only the scale-aware
   * patterns read it. Missing means "not known", and those patterns then fall
   * back to `ScaleOptions.pitchMm` and say on the image that they did.
   */
  pitchMm?: number
  /** Where `pitchMm` came from: a design file, or typed in. */
  pitchSource?: 'imported' | 'manual'
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
  // Scale-aware: drawn at real size from the output's pixel pitch.
  | 'rulers'
  | 'bananas'
  | 'dinosaurs'
  // Novelty, some of them moving.
  | 'hamsters'
  | 'ocean'
  | 'dino-scroll'
  | 'volcano'
  | 'broken-wall'
  | 'image'
  // Halloween, all of them moving.
  | 'pumpkins'
  | 'spooky-forest'
  | 'haunted-house'
  // Classic and technical.
  | 'classic-card'
  | 'levels-check'
  | 'av-sync'
  // Idle: the Windows 95/98 screensavers, from Idler. All of them moving.
  | IdleKind

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

/**
 * Physical scale, shared by every pattern that draws something at real size.
 *
 * `pitchMm` is only the fallback for an output that carries no pitch of its
 * own. A pattern drawn with it stamps "pitch assumed" on the image, because a
 * life-size banana at the wrong pitch is a confidently wrong banana.
 */
export type ScaleOptions = {
  pitchMm: number
  units: 'metric' | 'imperial'
  /** Height of the surface's bottom edge above the floor. Feet stand on the floor. */
  floorMm: number
  /**
   * Treat the outputs as windows onto one surface, placed by their position in
   * the composition, so a scene or a ruler carries on across the join between
   * two processors instead of starting again in each.
   */
  span: boolean
}

/**
 * Moving patterns. Every one of them is periodic in exactly `seconds`, so the
 * exported MP4 loops with no seam: frame N would be frame 0 again.
 */
export type AnimationOptions = {
  seconds: number
  /** Frames per second as a ratio, so 29.97 is exactly 30000/1001. */
  fps: '24' | '25' | '30' | '50' | '60' | '23.976' | '29.97' | '59.94'
  /** Which moment a PNG of a moving pattern shows. */
  stillAtSeconds: number
  /** Megabits per second for the MP4. 0 = pick from the raster. */
  bitrateMbps: number
  /**
   * Endless, for live output: a generative pattern (the idle savers, the hamsters,
   * the moving scenes, the Halloween ones) stops fitting itself to the loop and
   * never repeats. The MP4 is then a slice of the run, from the PNG's moment, and
   * does not loop. See `endlessOn` in patterns/env.ts.
   */
  endless: boolean
}

export type RulerOptions = {
  top: boolean
  left: boolean
  bottom: boolean
  right: boolean
  /** Faint lines across the field at every labelled distance. */
  gridLines: boolean
  /** Measure the vertical rulers up from the floor rather than down from the top. */
  fromFloor: boolean
  background: string
  colour: string
}

export type BananaOptions = {
  /** One bunch in the middle, or one bunch on every LED tile. */
  layout: 'once' | 'per-tile'
  /** State the wall's size in bananas. */
  caption: boolean
  background: string
}

export type DinosaurId =
  | 'compsognathus'
  | 'velociraptor'
  | 'ankylosaurus'
  | 'triceratops'
  | 'stegosaurus'
  | 'tyrannosaurus'
  | 'brachiosaurus'

export type DinosaurOptions = {
  /** In lineup order, left to right. */
  species: DinosaurId[]
  /** Metres of lineup scrolled past the left edge. Negative moves it right. */
  panM: number
  /** Gap between animals, in metres. */
  gapM: number
  human: boolean
  banana: boolean
  labels: boolean
  /** A floor line and a sky, or just the animals on a flat colour. */
  scenery: boolean
  background: string
}

export type HamsterOptions = {
  /** Beats per minute. The sprites change pose on every half beat. */
  bpm: number
}

export type OceanOptions = {
  seed: number
  time: 'day' | 'sunset' | 'night'
  /** 0.5 = calm, 1 = normal, 2 = rough. */
  swell: number
}

export type SceneOptions = {
  seed: number
  /** How many screen widths the nearest ground passes per loop. */
  speed: number
}

/** What goes in the middle of the classic card (and the AV sync pattern). */
export type CentreOptions = {
  content: 'logo' | 'image' | 'text'
  /** One line per line, when the content is text. */
  text: string
  /** Behind the logo, the image or the text. */
  background: string
  /** The text's colour. */
  colour: string
}

export type ClassicCardOptions = {
  /** Colour bar amplitude: 75% bars, or 100%. */
  barsPct: 75 | 100
  /** Name the output and its raster in the box at the foot of the circle. */
  ident: boolean
}

export type AvSyncOptions = {
  /** Seconds between sync frames: one flash and one beep each. */
  everySeconds: number
  /** The beep's pitch. */
  toneHz: number
}

export type LevelsCheckOptions = {
  /** Write what each result means on the card itself. */
  notes: boolean
}

/** The eleven idle patterns, in Idler's own order: the ones that shipped with Windows, then the OpenGL ones. */
export type IdleKind =
  | 'mystify'
  | 'beziers'
  | 'curves'
  | 'flying-windows'
  | 'starfield'
  | 'marquee'
  | 'maze'
  | 'pipes'
  | 'flying-objects'
  | 'flowerbox'
  | 'text-3d'

/**
 * How one idle pattern looks: Idler's own controls, held as Idler holds them —
 * 0..1, converted by the same curves — so its presets copy across as they are.
 * The seven scene controls mean something different to each saver; the panel
 * names them per saver.
 */
export type IdleLook = {
  density: number
  complexity: number
  size: number
  length: number
  lineWidth: number
  variation: number
  shading: 'flat' | 'lit' | 'wireframe'
  /** 0.5 = as fast as Idler runs it; 0 stops it. */
  speed: number
  fov: number
  camDistance: number
  /** 0.5 = level. */
  camTilt: number
  fog: number
  colourMode: 'classic' | 'tint' | 'spread' | 'cycle'
  colour: string
  hueSpread: number
  /** 0.5 = no cycling. */
  hueCycle: number
  background: string
}

export type IdleOptions = {
  seed: number
  /** What Scrolling Marquee and 3D Text spell out. */
  text: string
  /** Each pattern keeps its own, so switching between them does not drag one's sliders onto another. */
  looks: Record<IdleKind, IdleLook>
}

export type PumpkinFace = 'classic' | 'fierce' | 'happy' | 'surprised' | 'sly' | 'goofy'

export type PumpkinOptions = {
  /** Which face goes on which tile. */
  seed: number
  /** The faces to carve. None at all gives plain, uncarved pumpkins. */
  faces: PumpkinFace[]
  /** Candles that flicker, rather than burn steady. */
  flicker: boolean
  /** Blinks, winks and chattering teeth, each pumpkin in its own time. */
  expressions: boolean
}

export type BrokenFault =
  | 'dead-tile'
  | 'dead-module'
  | 'calibration'
  | 'batch'
  | 'missing-channel'
  | 'colour-order'
  | 'scan-lines'
  | 'dead-pixels'
  | 'swapped'
  | 'offset'
  | 'upside-down'
  | 'seams'
  | 'frozen'
  | 'flicker'
  | 'noise'

export type BrokenWallOptions = {
  /** The pattern the faults are applied to. */
  base: Exclude<PatternKind, 'broken-wall'>
  seed: number
  /** Percentage of tiles that get something wrong with them. */
  faultyPct: number
  faults: BrokenFault[]
  /** Modules per cabinet, across and down. Dead modules and scan faults use them. */
  modulesX: number
  modulesY: number
  /** Write what is wrong on each faulty tile. Good for training, bad for a client demo. */
  labels: boolean
}

export type ImageFit = 'contain' | 'cover' | 'stretch' | 'native' | 'tile'

export type ImageOptions = {
  fit: ImageFit
  /** Where the image sits when it does not fill the raster, or which part survives a crop. */
  anchorX: 'left' | 'centre' | 'right'
  anchorY: 'top' | 'centre' | 'bottom'
  background: string
  smoothing: boolean
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
  scale: ScaleOptions
  animation: AnimationOptions
  rulers: RulerOptions
  bananas: BananaOptions
  dinosaurs: DinosaurOptions
  hamsters: HamsterOptions
  pumpkins: PumpkinOptions
  centre: CentreOptions
  classic: ClassicCardOptions
  levelsCheck: LevelsCheckOptions
  avSync: AvSyncOptions
  ocean: OceanOptions
  scene: SceneOptions
  broken: BrokenWallOptions
  image: ImageOptions
  idle: IdleOptions
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
