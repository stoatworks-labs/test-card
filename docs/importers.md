# What each import gives you

Test Card reads three kinds of file. They are not equivalent — each one knows a
different amount about the outputs, and the app is explicit about which parts it
had to infer.

| File | From | Outputs are | Raster comes from | Regions |
|------|------|-------------|-------------------|---------|
| `AdvancedOutput.xml` / Advanced Output preset | Resolume Arena | one per `<Screen>` | the output device, or inferred from slice bounds | slices |
| `…-interchange.json` | Pixel Peeker → Export → JSON | one per processor | computed from what it drives | ports **and** every cabinet |
| `.blendcalc.json` | Blend Calc → Export design JSON | one per projector | **you** — it is not in the file | overlap bands |

Both Blend Calc and Pixel Peeker also export Resolume advanced output XML, and
**that is usually the better file to bring here** — it is fully resolved and
needs nothing from you.

## Resolume advanced output

Handles both roots: `<ScreenSetup>` (a drop-in `AdvancedOutput.xml`) and
`<XmlState>` (a preset saved from the Advanced Output window). The schema was
reverse-engineered from real Arena 7.27.0 files, the same work that backs the
exporters in `blend-calc` and `pixel-peeker`.

Reading is deliberately more forgiving than writing: unknown elements are
ignored, so a file from a newer Arena — or one carrying warps and soft-edge
settings this app knows nothing about — still yields the output list. Any layer
element with an `<OutputRect>` counts as a slice, so PolySlices and future layer
types are picked up without naming them.

### How the raster is decided, and when to distrust it

1. **Declared.** An `<OutputDeviceVirtual>` carries explicit `width`/`height`.
   Trustworthy.
2. **Inferred from slice bounds.** Everything else. A real display or a capture
   card is recorded with a `deviceId` and an `idHash` tied to the machine
   Resolume was running on, and **no dimensions at all** — so the only evidence
   is where the slices sit.

Case 2 is right whenever the slices reach the edges of the raster, and **too
small** when they do not: a 1920x1080 output showing one 1280x720 slice in the
middle is indistinguishable, from the file alone, from a 1280x720 output. These
outputs are badged `inferred` in the list, carry a per-output note, raise an
import warning, and are listed again at the bottom of the ZIP manifest. Correct
them by hand before trusting the patterns.

Rotated or corner-pinned slices are reduced to their bounding box, and the
import warns how many. The pattern is still correct; the region outline just
will not follow the warp.

## Pixel Peeker

**Use `Export → JSON`, not `Save project`.** The two files are easy to confuse
and only one is usable:

- `*.pixelpeeker.json` — the project. Stores cabinets as a `specId` plus a
  millimetre position. Turning that into pixels needs the cabinet spec (pitch and
  pixel count), which lives in Pixel Peeker's own library and is not in the file.
  Importing it would mean vendoring a copy of that library here, which would then
  drift out of step with the real one and quietly produce wrong tile sizes.
  A near-correct LED map is worse on site than no map, so this is **refused**,
  with a message naming the export that works.
- `*-interchange.json` — the pixel map after Pixel Peeker has resolved all of
  that. Every cabinet as a pixel rect, grouped by processor and port, with chain
  order. Needs no library.

One output per **processor**, matching Pixel Peeker's own Resolume export: a
processor is fed by one physical video output, so it is the natural unit. The
raster is the bounding box of everything that processor drives.

This is the only import that carries individual cabinets, which is what lets the
**LED tiles** pattern draw the real map — irregular walls, gaps, chain order and
per-port colouring — instead of an assumed uniform grid.

## Blend Calc

The design JSON is missing two things, and the app asks for both rather than
guessing.

### 1. The projector raster

The file stores `projectorId`, a reference into Blend Calc's projector library,
which lives in that app's `localStorage`. The native resolution is genuinely
absent and cannot be inferred — a 1920x1200 array and a 3840x2400 array with the
same overlap produce identical JSON.

### 2. The solved overlap

`array.hOverlap` and `array.vOverlap` are the operator's **inputs**, not the
result. In `fit-width` mode Blend Calc *solves* the vertical overlap so the array
covers the screen height exactly, shows it as "Vertical blend (solved)", and
**never writes it back to the project**. So `vOverlap` in the file is whatever
was last typed under some other fit mode. `fit-height` has the mirror problem.

Reading it blindly gives a plausible, wrong canvas. So:

- **`manual` mode** — both stored overlaps are trustworthy and are used as-is.
- **a fit mode** — the solved axis is flagged in the import dialog and in the
  warnings. Read the solved figure off Blend Calc's own screen and type it in,
  or bring its Resolume XML export instead and skip all of this.

### The layout

Tiles sit on an integer pixel pitch of `native × (1 − overlap)`, and the canvas
is sized from the last tile's right/bottom edge rather than a separate rounding
of the total — so tiles and canvas can never disagree by a pixel. That is the
same rule Blend Calc's own exporter uses, and it is the whole of the geometry
needed: none of the optical solver (throw, lenses, curvature, luminance) affects
the pixel layout.

Each projector gets its **overlap bands** as regions, which on a blend rig is the
most useful thing to see on the pattern — it is where the geometry has to agree
between neighbours.

A cylindrical screen raises a warning: the pixel layout is unaffected by the
curve, but the patterns are flat images, so a grid is correct on the raster and
curved on the screen.

## Adding outputs by hand

No file needed. Name, resolution (with presets for the usual rasters), and a
count if you want several at once. This is also the fallback when an inferred
raster is wrong — edit it in the output list and the source flips to `manual`.
