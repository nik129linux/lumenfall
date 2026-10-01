#!/usr/bin/env python3
"""Stage 8 asset pipeline: shrink the cutscene panels and level backdrops.

The 19 panels plus 3 backgrounds were ~45 MB of RGB PNG, which a static host or a
teammate on a slow connection cannot swallow. They are pixel-art stills, so the
savings come from three cheap, order-safe steps per image:

  1. LANCZOS downscale so the width is at most 1280 px. Never upscales, and the
     height follows the original aspect ratio.
  2. Palette reduction with FASTOCTREE (octree quantisation handles the many flat
     colour regions in pixel art far better than median cut) and Floyd-Steinberg
     dithering, which keeps gradients in skies and glows from banding.
  3. PNG written with optimize=True, so Pillow picks the smallest of the
     available filter strategies.

The palette size N is chosen per image: start at 192 and only step it DOWN while
the image is still over its size budget and the pixel-faithfulness check still
passes. N is stepped UP if 192 is not faithful enough for a particular painting.
Faithfulness is measured the way the stage 8 gate measures it: both the original
and the result are reduced to 256 px wide and the mean absolute per-channel
difference must stay well under the gate's limit of 10/255.

The pristine originals live in assets-src/ and are only ever read here. Re-running
this script is idempotent: it always starts from assets-src/, never from the
already-compressed assets/, so shrinking the same input twice gives the same
output.

Usage:
    python3 tools/compress-panels.py           # compress panels + backgrounds
    python3 tools/compress-panels.py --report  # sizes/quality only, writes nothing
"""

import io
import os
import sys

import numpy as np
from PIL import Image

SRC_ROOT = 'assets-src'
OUT_ROOT = 'assets'

PANEL_BUDGET = 900 * 1024
BG_BUDGET = 1400 * 1024
PANEL_TOTAL_BUDGET = 9 * 1024 * 1024

MAX_WIDTH = 1280
START_COLORS = 192
THUMB_WIDTH = 256
# The gate fails above 10/255. Stop stepping down well before that so ordinary
# re-runs and small encoder differences cannot push a panel over the line.
MAX_MAE = 8.0

LADDER = (192, 160, 128, 112, 96, 80, 64, 48, 32, 24, 16)
RISING = (224, 256)


def thumb(im):
    """256 px wide LANCZOS reduction, as float32 — the gate's comparison image."""
    return np.asarray(
        im.resize((THUMB_WIDTH, round(THUMB_WIDTH * im.height / im.width)), Image.LANCZOS),
        dtype=np.float32,
    )


def target_size(original):
    """Width capped at MAX_WIDTH (never upscaled), aspect ratio preserved."""
    w = min(original.width, MAX_WIDTH)
    h = round(original.height * w / original.width)
    return w, h


def encode(resized, colors):
    """Palette-reduce and return (P-mode image, encoded PNG bytes)."""
    q = resized.quantize(colors=colors, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    buf = io.BytesIO()
    q.save(buf, 'PNG', optimize=True)
    return q, buf.getvalue()


def mae_of(quantized, ref):
    return float(np.abs(thumb(quantized.convert('RGB')) - ref).mean())


def pick_colors(resized, ref, budget):
    """Start at 192 colours, then move N only as far as the image demands.

    Up first, but only if 192 is not faithful enough for this particular painting;
    down only while the file is still over budget and the comparison still passes.
    """
    best = encode(resized, START_COLORS)
    colors = START_COLORS
    if mae_of(best[0], ref) > MAX_MAE:
        for n in RISING:
            best = encode(resized, n)
            colors = n
            if mae_of(best[0], ref) <= MAX_MAE:
                break
    q, data = best
    mae = mae_of(q, ref)

    if len(data) <= budget:
        return colors, q, data, mae

    for n in LADDER:
        if n >= colors:
            continue
        q2, data2 = encode(resized, n)
        mae2 = mae_of(q2, ref)
        if mae2 > MAX_MAE:
            break
        colors, q, data, mae = n, q2, data2, mae2
        if len(data) <= budget:
            break
    return colors, q, data, mae


def process(rel_src, rel_out, budget, report_only=False):
    original = Image.open(os.path.join(SRC_ROOT, rel_src)).convert('RGB')
    ref = thumb(original)
    resized = original.resize(target_size(original), Image.LANCZOS)
    colors, quantized, data, mae = pick_colors(resized, ref, budget)

    over = '  OVER' if len(data) > budget else ''
    print(f'{os.path.basename(rel_out):>9}  {original.width}x{original.height} -> {resized.width}x{resized.height}'
          f'  N={colors:<3} mae={mae:4.1f}  {len(data) / 1024:7.0f} KB{over}')

    if not report_only:
        dst = os.path.join(OUT_ROOT, rel_out)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, 'wb') as fh:
            fh.write(data)
        with Image.open(dst) as check:
            check.verify()
    return len(data)


def main():
    report_only = '--report' in sys.argv
    panel_src = [f'cutscenes/{i:02d}.png' for i in range(1, 20)]
    bg_src = [f'bg/l{i}.png' for i in (1, 2, 3)]

    missing = [p for p in panel_src + bg_src if not os.path.exists(os.path.join(SRC_ROOT, p))]
    if missing:
        print(f'ERROR missing originals in {SRC_ROOT}/: {", ".join(missing)}')
        return 1

    print('cutscene panels (budget 900 KB each)')
    total = 0
    for rel in panel_src:
        total += process(rel, rel, PANEL_BUDGET, report_only)
    print(f'panels total {total / 1e6:.1f} MB (budget {PANEL_TOTAL_BUDGET / 1e6:.1f} MB)')

    print('level backgrounds (budget 1.4 MB each)')
    for rel in bg_src:
        process(rel, rel, BG_BUDGET, report_only)

    if not report_only and total > PANEL_TOTAL_BUDGET:
        print(f'WARN panels total {total / 1e6:.1f} MB exceeds {PANEL_TOTAL_BUDGET / 1e6:.1f} MB;'
              ' re-run with a tighter budget to tighten further')
    return 0


if __name__ == '__main__':
    sys.exit(main())
