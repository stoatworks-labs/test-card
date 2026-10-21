#!/usr/bin/env python3
"""Trace the Stoatworks mark into src/patterns/art/logo.ts.

The mark only exists as a 400 x 310 PNG (stoatworks-backend's about/stoat-mark.png:
a white stoat with a black outline over a bowtie). Blown up to fill the centre of a
4K test card a raster that size goes soft, so it is traced to vector here, once, and
the card draws the paths at whatever size it needs.

Three layers come out, drawn in this order:
  bowtie   the paper outside the stoat that reaches the left or right edge
  fill     everything the outline encloses (the stoat's white)
  outline  the ink

Each is a soft mask at the source size, upsampled 8x, blurred a little to lose the
source raster's wobble, thresholded and traced with potrace. Coordinates are written
y down, in a box 1000 units high.

Needs numpy, Pillow and potrace (brew install potrace).

    python3 scripts/trace-logo.py ~/Projects/infrastructure/stoatworks-backend/about/stoat-mark.png
"""

import re
import subprocess
import sys
import tempfile
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

UP = 8
COLOURS = {'bowtie': '#0e2942', 'fill': '#ffffff', 'outline': '#111111'}
OUT = Path(__file__).resolve().parent.parent / 'src/patterns/art/logo.ts'


def masks(src: Path) -> tuple[dict[str, np.ndarray], int, int]:
    rgba = np.asarray(Image.open(src).convert('RGBA')).astype(np.float32) / 255
    h, w = rgba.shape[:2]
    alpha = rgba[..., 3]
    lum = rgba[..., 0] * 0.299 + rgba[..., 1] * 0.587 + rgba[..., 2] * 0.114
    ink = alpha * np.clip((0.6 - lum) / 0.3, 0, 1)
    paper = alpha * np.clip((lum - 0.45) / 0.3, 0, 1)

    # Outside: reachable from the border without crossing ink.
    outside = np.zeros((h, w), bool)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            queue.append((x, y))
    queue = deque((x, y) for x, y in queue if ink[y, x] < 0.5)
    for x, y in queue:
        outside[y, x] = True
    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not outside[ny, nx] and ink[ny, nx] < 0.5:
                outside[ny, nx] = True
                queue.append((nx, ny))

    # The bowtie: paper outside the stoat, in pieces that reach the left or right edge.
    label = np.full((h, w), -1)
    reach = []
    loose = (paper > 0.5) & outside
    for y in range(h):
        for x in range(w):
            if loose[y, x] and label[y, x] < 0:
                k = len(reach)
                label[y, x] = k
                queue = deque([(x, y)])
                x0 = x1 = x
                while queue:
                    cx, cy = queue.popleft()
                    x0, x1 = min(x0, cx), max(x1, cx)
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if 0 <= nx < w and 0 <= ny < h and loose[ny, nx] and label[ny, nx] < 0:
                            label[ny, nx] = k
                            queue.append((nx, ny))
                reach.append((x0, x1))
    pieces = [k for k, (x0, x1) in enumerate(reach) if x0 < 20 or x1 > w - 20]
    bow = Image.fromarray((np.isin(label, pieces) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    bowtie = np.asarray(bow).astype(np.float32) / 255 * paper * outside

    return {'bowtie': bowtie, 'fill': (~outside) * np.maximum(paper, ink), 'outline': ink}, w, h


def trace(mask: np.ndarray, w: int, h: int, shrink: bool, work: Path) -> str:
    img = Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8)).resize((w * UP, h * UP), Image.BICUBIC)
    img = img.filter(ImageFilter.GaussianBlur(UP * 0.9))
    if shrink:
        # The fill sits under the outline; keep its edge inside the ink.
        img = img.filter(ImageFilter.MinFilter(5))
    pbm = work / 'mask.pbm'
    svg = work / 'mask.svg'
    img.point(lambda v: 0 if v >= 128 else 255).convert('1').save(pbm)
    subprocess.run(
        ['potrace', '-b', 'svg', '-u', '1', '-t', '200', '-O', '1.0', '-a', '1.3', '--flat', '-o', str(svg), str(pbm)],
        check=True,
    )
    return ' '.join(re.findall(r'd="([^"]+)"', svg.read_text()))


def y_down(d: str, height: int) -> str:
    """potrace writes y up under a flipping transform; undo it and scale to 1000 high.

    Every point is placed absolutely, rounded to a tenth, and written as the difference
    from the last ROUNDED point. Rounding each relative step on its own let the error
    add up along an outline, to 1.4 units by the end of the longest.
    """
    k = 1000 / height
    tokens = re.findall(r'[MmLlCcZz]|-?\d+(?:\.\d+)?', d)
    out = []
    cmd = ''
    pen = (0.0, 0.0)        # exact, source units, y up
    start = (0.0, 0.0)
    i = 0

    def tenths(p: tuple) -> tuple:
        return (round(p[0] * k * 10), round((height - p[1]) * k * 10))

    def num(t: int) -> str:
        s = f'{t / 10:.1f}'.rstrip('0').rstrip('.')
        return '0' if s in ('', '-0') else s

    def pairs(n: int) -> list:
        nonlocal i
        got = []
        for _ in range(n):
            got.append((float(tokens[i]), float(tokens[i + 1])))
            i += 2
        return got

    while i < len(tokens):
        t = tokens[i]
        if t.isalpha():
            cmd = t
            i += 1
            if t in 'Zz':
                out.append('z')
                pen = start
            elif t == 'M':
                out.append('M')
            else:
                out.append(t)
            continue
        if cmd == 'M':
            (pen,) = pairs(1)
            start = pen
            x, y = tenths(pen)
            out.append(f'{num(x)} {num(y)}')
            continue
        group = 3 if cmd == 'c' else 1
        rel = pairs(group)
        base = tenths(pen)
        pts = [(pen[0] + dx, pen[1] + dy) for dx, dy in rel]
        for p in pts:
            x, y = tenths(p)
            out.append(f'{num(x - base[0])} {num(y - base[1])}')
        pen = pts[-1]
        if cmd == 'm':
            start = pen
    return re.sub(r' -', '-', ' '.join(out))


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1]).expanduser()
    layers, w, h = masks(src)
    with tempfile.TemporaryDirectory() as tmp:
        paths = {name: y_down(trace(m, w, h, name == 'fill', Path(tmp)), h * UP) for name, m in layers.items()}
    width = round(w * 1000 / h, 1)
    body = ',\n'.join(f"  {{ fill: '{COLOURS[n]}', d: '{paths[n]}' }}" for n in ('bowtie', 'fill', 'outline'))
    OUT.write_text(f"""/**
 * The Stoatworks mark: a stoat over a bowtie. GENERATED by scripts/trace-logo.py from
 * stoatworks-backend's about/stoat-mark.png; do not edit by hand, run the script.
 *
 * SVG path data, y down, in a box {width} wide and 1000 high, drawn in order.
 */

export const LOGO_WIDTH = {width}
export const LOGO_HEIGHT = 1000

export const LOGO_LAYERS: {{ fill: string; d: string }}[] = [
{body},
]
""")
    print(f'wrote {OUT} ({OUT.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
