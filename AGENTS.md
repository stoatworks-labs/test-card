# AGENTS.md — Test Card

LLM onboarding. Read this before changing anything. [CLAUDE.md](CLAUDE.md) is the
short command reference.

## What this is

A browser-only React/TS/Vite SPA that turns a show's output map into test
pattern PNGs. No backend. Deployed as a **Cloudflare Worker serving static
assets** — *not* a Pages project (see `wrangler.toml`; the fleet does not use
Pages, and `pages_build_output_dir` fails in a way that reads like a missing
build step).

Sibling projects, both of whose export formats this reads:
`~/Projects/blend-calc` and `~/Projects/pixel-peeker`.

## The shape of it

The unit of work is an **`Output`**: one physical video output with a raster in
pixels. Importers turn a file into `Output[]`; patterns paint into a canvas whose
coordinate space is that raster; exports name and pack the results. Nothing else
is load-bearing.

```
src/types.ts          Output, Region, PatternSettings — read this first
src/lib/colour.ts     Rec.709 Y'CbCr <-> RGB, and the level-range decision
src/lib/zip.ts        hand-rolled store-only ZIP writer
src/lib/export.ts     filenames, manifest, download
src/patterns/rp219.ts SMPTE bar layout + colours (pure, no canvas)
src/patterns/draw.ts  the painters. 1 unit = 1 raster pixel, always
src/patterns/render.ts orchestration, canvas limits, PNG encode, composition mode
src/import/*.ts       one file per source format + detect.ts to sniff
src/state/            zustand store, persisted to localStorage
src/ui/               React
```

## Invariants — do not break these

**1. Geometry is pure; canvases are dumb.**
`rp219Layout()` and `gridLines()` return numbers and are unit tested. The canvas
layer only fills rectangles. Do not move layout maths into a painter — it becomes
untestable the moment it needs a `CanvasRenderingContext2D`.

**2. Bar colours are computed, never tabulated.**
Everything except +I and +Q comes from an R′G′B′ definition through
`rgbToYcbcr`. All fifteen computed values were verified to land exactly on the
measured ffmpeg ones. If you find yourself pasting a Y′CbCr triple, stop — the
only legitimate constants are `plusI` and `plusQ`, which are not colours and
cannot be derived.

**3. `layOut()` accumulates in exact fractions and rounds once.**
This is why bands always tile the raster with no gaps and no overlap, and why the
last boundary is pinned to the total. Rounding each segment independently
reintroduces drift and a visibly narrow final column.

**4. Never invent an output's raster silently.**
Every `Output` carries `rasterSource`. `slice-bounds` means *guessed* and must
stay badged in the UI, warned about on import, and listed in the ZIP manifest. An
output that is the wrong size produces a pattern that looks perfect and is
useless on site.

**5. The preview calls the same painters as the export.**
`Preview.tsx` must go through `renderOutputTo`. An earlier version had its own
copy of the overlay code and the two had already drifted — the export drew a
border round the burn-in plate and the preview did not. A preview that
reimplements the thing it previews is worse than no preview.

**6. Do not vendor the sibling projects' libraries.**
Pixel Peeker's cabinet library and Blend Calc's projector library stay where they
are. Importing a file that needs them is refused (Pixel Peeker project) or asks
the user (Blend Calc raster). A vendored copy drifts and then produces confidently
wrong tile sizes.

## Traps that have already cost time

**ffmpeg's `rgb24` output uses the wrong matrix.** `smptehdbars -pix_fmt rgb24`
converts HD content with BT.601 and renders 75% yellow as (189, 202, 7) instead
of (191, 191, 0). Use the Y′CbCr planes and apply Rec.709 yourself. Full
workings in [docs/rp219.md](docs/rp219.md).

**And its default chroma upsampling smears band edges.** Without
`-sws_flags neighbor`, converting to `yuv444p` interpolates: row boundaries move
by ~3px and edge colours come back close-but-wrong.

**macOS `unzip` is Info-ZIP 6.00 from 2009 and ignores the UTF-8 flag.** It
transliterates non-ASCII names for display and then refuses to extract them at
all with "Illegal byte sequence", regardless of `LC_ALL`. That is the binary, not
the archive. `zip.test.ts` verifies UTF-8 names with Python's `zipfile` and uses
`unzip` only for ASCII round-trips.

**An empty ZIP makes `unzip -t` exit 1.** "zipfile is empty" is a warning about
content, not a structural complaint, so `execFileSync` throws on a perfectly
valid archive.

**Browsers return a blank canvas over the size limit, they do not throw.** An 8K
wall would export a folder of empty PNGs that look fine in a file listing.
`canvasLimitProblem()` checks before drawing and the UI refuses. Do not remove it.

**Blend Calc does not persist its solved overlap.** In `fit-width` the vertical
overlap is computed, displayed as "(solved)", and never written back to the
project — so the value in the JSON is a stale input from some other mode. The
importer flags the affected axis rather than reading it.

**Canvas strokes straddle the path.** A 1px line on an integer coordinate renders
as two grey rows. `crispLine()` offsets by half a pixel for odd widths; this
matters more here than in most drawing code, because the point of an alignment
pattern is that 1px is exactly 1px.

## Testing

`npm test` — 88 tests, all offline. ffmpeg is **not** required: the RP 219
reference is committed as JSON.

The importer suite runs against real files in `test/fixtures/`, none of them
hand-written:

- `resolume-arena-preferences.xml` — Arena 7.27.0's own `AdvancedOutput.xml`
  from this machine (a DeckLink output, so the raster must be inferred)
- `resolume-arena-preset.xml` — a real saved Advanced Output preset
- `blend-calc-export.xml` — `BLEND_CALC_XML_OUT=<dir> npx vitest run resolume`
  in `~/Projects/blend-calc`
- `pixel-peeker-export.xml`, `pixel-peeker-interchange.json` —
  `PP_WRITE_ARTEFACTS=<dir> npx vitest run export` in `~/Projects/pixel-peeker`

If you change an importer, regenerate the fixture from the sibling project rather
than editing the XML by hand.

## Not doing, on purpose

- **No `diag` module.** Static browser page; nowhere for a rotating log to go.
  Same call as blend-calc.
- **No ZIP64.** Capped at 4 GiB and 65535 entries, and `buildZip` throws rather
  than emitting a corrupt archive. Test patterns will not come close.
- **No compression in the ZIP.** PNGs are already DEFLATEd; store-only saves a
  dependency and buys ~0%.
- **No releases or installers.** This repo exists to feed the deployed app, like
  blend-calc and pixel-peeker. Its absence from the fleet's download tooling is
  the design, not a gap.
