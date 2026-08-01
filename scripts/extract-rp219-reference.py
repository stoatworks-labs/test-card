#!/usr/bin/env python3
"""
Recover the SMPTE RP 219 bar geometry and colours from ffmpeg's `smptehdbars`.

This is the script that produced `test/fixtures/rp219-ffmpeg.json`, which
`src/patterns/rp219.test.ts` asserts the TypeScript implementation against.
Re-run it if you ever want to re-derive the reference from scratch:

    python3 scripts/extract-rp219-reference.py > test/fixtures/rp219-ffmpeg.json

Requires ffmpeg on PATH. Nothing in the app or its tests needs ffmpeg — the
committed JSON is the artefact.

TWO TRAPS, both of which produce plausible-looking wrong numbers:

  1. `-pix_fmt rgb24` converts with the BT.601 matrix, so 75% yellow comes out
     as (189, 202, 7) instead of the correct Rec.709 (191, 191, 0). Read the
     Y'CbCr planes instead and do the matrix yourself.
  2. `smptehdbars` renders to a chroma-subsampled format, so a default
     conversion to yuv444p INTERPOLATES the chroma and smears it across every
     band edge — band boundaries shift by ~3px and edge colours are wrong.
     `-sws_flags neighbor` pins it.
"""

import json
import subprocess
import sys

SIZES = [(1920, 1080), (3840, 2160), (1280, 720), (2048, 1080)]


def render(w: int, h: int) -> bytes:
    return subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-f", "lavfi", "-i", f"smptehdbars=size={w}x{h}",
            "-frames:v", "1",
            "-sws_flags", "neighbor",  # trap 2
            "-pix_fmt", "yuv444p",     # trap 1
            "-f", "rawvideo", "-",
        ],
        check=True,
        capture_output=True,
    ).stdout


def runs(seq):
    """[(value, start, length)] over consecutive equal values."""
    out, start = [], 0
    for i in range(1, len(seq) + 1):
        if i == len(seq) or seq[i] != seq[start]:
            out.append((seq[start], start, i - start))
            start = i
    return out


def extract(w: int, h: int) -> dict:
    buf = render(w, h)
    n = w * h
    planes = (buf[:n], buf[n : 2 * n], buf[2 * n : 3 * n])

    def px(x, y):
        return tuple(p[y * w + x] for p in planes)

    # Row bands, sampled on a stride so this stays fast at 4K.
    stride = max(1, w // 32)
    sig = [tuple(px(x, y) for x in range(0, w, stride)) for y in range(h)]
    bands = runs(sig)
    if len(bands) != 4:
        sys.exit(f"expected 4 row bands at {w}x{h}, got {len(bands)}")

    rows = []
    for key, (_, ystart, ylen) in zip("ABCD", bands):
        cols = runs([px(x, ystart + ylen // 2) for x in range(w)])
        # Row C's middle sixth is a ~255-step luma ramp. Recording every step
        # would be noise; record its extent and range instead.
        if len(cols) > 20:
            head, tail = cols[:2], cols[-1:]
            rstart = head[-1][1] + head[-1][2]
            rend = tail[0][1]
            entries = [
                {"name": None, "x": s, "w": l, "ycbcr": list(v)} for v, s, l in head
            ] + [
                {
                    "name": "ramp",
                    "x": rstart,
                    "w": rend - rstart,
                    "lumaMin": min(c[0][0] for c in cols[2:-1]),
                    "lumaMax": max(c[0][0] for c in cols[2:-1]),
                    "steps": len(cols) - 3,
                }
            ] + [
                {"name": None, "x": s, "w": l, "ycbcr": list(v)} for v, s, l in tail
            ]
        else:
            entries = [
                {"name": None, "x": s, "w": l, "ycbcr": list(v)} for v, s, l in cols
            ]
        rows.append({"row": key, "y": ystart, "h": ylen, "columns": entries})

    return {"width": w, "height": h, "rows": rows}


def main():
    ver = subprocess.run(
        ["ffmpeg", "-version"], check=True, capture_output=True, text=True
    ).stdout.splitlines()[0]
    doc = {
        "_comment": (
            "Measured from ffmpeg's smptehdbars. Geometry and Y'CbCr code values only "
            "- ffmpeg's own RGB conversion uses the wrong matrix for HD and must not "
            "be used. Regenerate with scripts/extract-rp219-reference.py."
        ),
        "generator": ver,
        "sizes": [extract(w, h) for w, h in SIZES],
    }
    json.dump(doc, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
