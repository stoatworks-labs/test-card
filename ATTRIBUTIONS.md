# Attributions

Test Card is built on other people's work. This file lists what that work is, who did
it, and what it is doing here.

It is generated — the master lists live in the `stoatworks-backend` repo and are
pushed out by `scripts/sync-attributions.py`. Edit it there, not here.

## Third-party code this project uses

Libraries, SDKs and frameworks the project is built on or bundles.

### Tauri

<https://tauri.app>  
Licence: MIT or Apache-2.0  
Copyright: The Tauri Programme within The Commons Conservancy

A Cargo and npm dependency — of the app itself under src-tauri/, or of the desktop launcher under launcher/src-tauri/.

Wraps a web front end in a native desktop app using the platform's own webview rather than a bundled browser, so the binary stays small.

### React

<https://react.dev>  
Licence: MIT  
Copyright: Meta Platforms, Inc. and affiliates

An npm dependency.

The UI layer for the browser tools and the Electron and Tauri front ends.

### The Rust crate ecosystem

<https://crates.io>  
Licence: predominantly MIT or Apache-2.0  
Copyright: the individual crate authors

Cargo dependencies, resolved and pinned in Cargo.lock.

Async runtimes, protocol codecs, serialisation and GUI toolkits. The exact set and versions for any build are in that repo's Cargo.lock, which is the authoritative list.

### The npm ecosystem

<https://www.npmjs.com>  
Licence: predominantly MIT  
Copyright: the individual package authors

npm dependencies, resolved and pinned in the lockfile.

Build tooling, test runners and the libraries the front ends are assembled from. The exact set and versions for any build are in that repo's lockfile, which is the authoritative list.

The full transitive dependency set for any build is pinned in this repo's lockfile,
which is the authoritative list. What is named above is the layers a reader would
want to know about, not every package that has ever been resolved.

## Inspirations

What this set out to be. No code, assets or binaries from any of these were used or examined — the debt is to the idea.

### The Windows 95 and 98 screensavers — Microsoft

The eleven idle patterns are the savers from Idler, the Resolume generator that rebuilt them, ported across — the flat ones that shipped with Windows and the OpenGL ones that arrived with Plus! and became stock in 98. No Microsoft code, assets or binaries were used or examined; every saver is a fresh implementation written to match remembered behaviour. The debt is to the originals and to whoever at Microsoft decided a locked screen should be worth watching.

## Standards and published specifications

What the implementation is measured against.

- **SMPTE RP 219** — Colour bar layout and colours.
- **ITU-R BT.709** — Luma coefficients and the Y'CbCr to RGB conversion the patterns are defined in.

## Getting this wrong

If your work is here and the description is inaccurate, the licence is wrong, or you would rather not be listed — open an issue and it will be fixed.
