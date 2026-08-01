# CLAUDE.md — Test Card

Command reference. For the model, the invariants and the traps, read
[AGENTS.md](AGENTS.md) first.

## Commands

```bash
npm install
npm run dev          # vite dev server
npm test             # vitest — 88 tests, no ffmpeg needed
npm run test:watch
npm run build        # tsc -b && vite build -> dist/
npm run preview      # serve the built dist/ (does NOT apply _headers)
npm run serve:dist   # serve dist/ WITH _headers applied — use this to check the CSP
npm run typecheck    # tsc -b
```

## Deploy

```bash
cf-run npx wrangler deploy
```

Or connect the repo in Cloudflare: build `npm ci && npm run build`, deploy
`npx wrangler deploy`. A static-assets **Worker**, not a Pages project.

## Regenerating the RP 219 reference

Only needed if you want to re-derive it from scratch; the JSON is committed.

```bash
python3 scripts/extract-rp219-reference.py > test/fixtures/rp219-ffmpeg.json
```

## Regenerating the importer fixtures

```bash
BLEND_CALC_XML_OUT=/tmp/bc npx vitest run resolume   # in ~/Projects/blend-calc
PP_WRITE_ARTEFACTS=/tmp/pp npx vitest run export     # in ~/Projects/pixel-peeker
```

Then copy into `test/fixtures/`. Never hand-edit them.

## Ground rules

- 1 canvas unit = 1 raster pixel, everywhere in `src/patterns/`.
- Bar colours are computed from R′G′B′, never tabulated. `plusI`/`plusQ` are the
  only legitimate constants.
- Every `Output` carries `rasterSource`; `slice-bounds` means guessed and must
  stay visible to the user.
- `Preview.tsx` renders through `renderOutputTo` — never its own copy.
- Don't vendor blend-calc's or pixel-peeker's libraries.
