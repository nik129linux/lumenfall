#!/usr/bin/env python3
"""Stage 8 gate: panels and backgrounds are light, still pixel-faithful, originals preserved."""
import os, sys, glob, hashlib
import numpy as np
from PIL import Image
res = []
def check(n, ok, d=''): res.append((n, bool(ok), d))
pairs = [(f'assets/cutscenes/{i:02d}.png', f'assets-src/cutscenes/{i:02d}.png') for i in range(1, 20)] + \
        [(f'assets/bg/l{i}.png', f'assets-src/bg/l{i}.png') for i in (1, 2, 3)]
missing_src = [s for _, s in pairs if not os.path.exists(s)]
check('S1 originals are preserved in assets-src/ (22 files)', not missing_src, ', '.join(missing_src[:5]))
panels = [p for p, _ in pairs if 'cutscenes' in p]
big = [f'{os.path.basename(p)}={os.path.getsize(p)//1024}KB' for p in panels if os.path.exists(p) and os.path.getsize(p) > 900 * 1024]
check('S2 every panel <= 900 KB', not big, ', '.join(big))
tot = sum(os.path.getsize(p) for p in panels if os.path.exists(p))
check('S3 panels total <= 9 MB', tot <= 9 * 1024 * 1024, f'{tot/1e6:.1f} MB')
bgs = [p for p, _ in pairs if '/bg/' in p]
bigbg = [f'{os.path.basename(p)}={os.path.getsize(p)//1024}KB' for p in bgs if os.path.exists(p) and os.path.getsize(p) > 1400 * 1024]
check('S4 every background <= 1.4 MB', not bigbg, ', '.join(bigbg))
bad_dim, bad_q, bad_open = [], [], []
for p, s in pairs:
    if not (os.path.exists(p) and os.path.exists(s)): continue
    try:
        a = Image.open(p).convert('RGB'); o = Image.open(s).convert('RGB')
    except Exception as e:
        bad_open.append(f'{p}: {e}'); continue
    w = min(o.width, 1280)
    if abs(a.width - w) > 1 or abs(a.height / a.width - o.height / o.width) > 0.01: bad_dim.append(f'{os.path.basename(p)} {a.size} vs orig {o.size}')
    def th(im): return np.asarray(im.resize((256, round(256 * im.height / im.width)), Image.LANCZOS), dtype=np.float32)
    x, y = th(a), th(o)
    if x.shape != y.shape: bad_dim.append(f'{os.path.basename(p)} thumb shape'); continue
    mae = float(np.abs(x - y).mean())
    if mae > 10: bad_q.append(f'{os.path.basename(p)} mae={mae:.1f}')
check('S5 every file opens as a PNG', not bad_open, '; '.join(bad_open[:3]))
check('S6 width = min(original, 1280) and aspect ratio kept', not bad_dim, '; '.join(bad_dim[:4]))
check('S7 pixel-faithful (mean abs diff <= 10 per channel)', not bad_q, '; '.join(bad_q[:6]))
check('S8 tools/compress-panels.py exists', os.path.exists('tools/compress-panels.py'), '')
same = [p for p, s in pairs if os.path.exists(p) and os.path.exists(s) and hashlib.md5(open(p, 'rb').read()).hexdigest() == hashlib.md5(open(s, 'rb').read()).hexdigest() and os.path.getsize(p) > 300 * 1024]
check('S9 the big images were really re-encoded (not left identical to the originals)', not same, ', '.join(os.path.basename(x) for x in same[:5]))
failed = 0
for n, ok, d in res:
    print(('PASS  ' if ok else 'FAIL  ') + n + (f'  [{d}]' if d else '')); failed += (not ok)
print(f'GATE FAIL ({failed} of {len(res)})' if failed else 'GATE PASS'); sys.exit(1 if failed else 0)
