#!/usr/bin/env python3
"""Stage 2f gate: every non-dissolve minion frame must be ONE clean creature.
Fails on (a) slivers of neighbouring frames (extra connected pieces) and (b) thin vertical
cut lines. Run: python3 tools/gate2f.py   -> prints per-frame problems, GATE PASS/FAIL."""
import json, sys, numpy as np
from PIL import Image
from scipy import ndimage
m = json.load(open('sprites/manifest.json')); bad = []; n = 0
for name, d in m.items():
    if name == 'spitterShot' or 'frames' not in d: continue
    a = np.asarray(Image.open(f'sprites/{name}.png').convert('RGBA'))[:, :, 3] > 40
    cw, ch = d['cell']
    clips = d['frames']; items = clips.items() if isinstance(clips, dict) else clips
    for clip, cells in items:
        if clip.startswith('dead'): continue
        for i, (x, y) in enumerate(cells):
            f = a[y:y+ch, x:x+cw]; n += 1
            if f.sum() == 0: bad.append(f'{name}/{clip}[{i}] empty'); continue
            lab, k = ndimage.label(f, structure=np.ones((3, 3)))
            sizes = ndimage.sum(f, lab, range(1, k + 1))
            main = sizes.max(); extra = f.sum() - main
            if extra / f.sum() > 0.15: bad.append(f'{name}/{clip}[{i}] {extra/f.sum():.0%} of pixels are detached pieces')
            cols = f.sum(axis=0); rows = f.any(axis=1)
            h = rows.sum()
            for c in range(1, cw - 1):
                if h > 12 and cols[c] >= 0.75 * h and cols[c-1] < 0.35 * h and cols[c+1] < 0.35 * h:
                    bad.append(f'{name}/{clip}[{i}] vertical line at x={c}'); break
for b in bad: print('FAIL ', b)
print(f'checked {n} frames')
print('GATE PASS' if not bad else f'GATE FAIL ({len(bad)})'); sys.exit(1 if bad else 0)
