#!/usr/bin/env python3
"""Cut Nico's minion sheets into atlases + a manifest.

    python3 tools/cut_minions.py

Sources are read-only, in assets/. Output goes to sprites/ at the repo root,
because assets/ is read-only and the derived atlases do not belong beside the
sources anyway.

Three different background treatments, because the sheets are not alike:

  wisp, spitter   chroma key against magenta, then 1px alpha erosion, then the
                  partial pixels are unmatted so no pink fringe survives
  crawler         no colour distance at all: the background is near-black with a
                  soft brown vignette, and the creature is dark brown with green
                  eyes, so any single-colour key eats the creature. The mask is
                  flood-filled from each frame box's border instead and the
                  largest connected component is kept.
  spitter shot    the loose green fireball between row 2 frames 3 and 4 is not
                  part of a frame; it is cut out separately as spitterShot.

Frames are grouped into rows by horizontal gaps and split within a row by
vertical gaps, as the brief describes.
"""

import colorsys
import json
import os
from collections import deque

from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'sprites')
SCRATCH = os.path.join(ROOT, '.scratch', 'stage2e')
MAGENTA = (255, 0, 255)

# Clip layout per the brief. Values are frame indices within the enemy's sheet.
CLIPS = {
    'wisp': {'float': [0, 1, 2, 3], 'dash': [4, 5, 6], 'hurt': [7], 'dead': [8, 9, 10]},
    'crawler': {'walk': [0, 1, 2, 3], 'lunge': [4, 5, 6], 'hurt': [7], 'dead': [8, 9, 10]},
    'spitter': {'idle': [0, 1], 'walk': [2, 3, 4, 5], 'cast': [6, 7, 8], 'hurt': [9],
                'dead': [10, 11, 12, 13]},
}
SOURCES = {
    'wisp': 'assets/wisp.jpeg',
    'crawler': 'assets/crawler.png',
    'spitter': 'assets/spitter.jpeg',
}
# Display height in buffer pixels, from the brief. Width follows the cell aspect.
DISPLAY_H = {'wisp': 22, 'crawler': 20, 'spitter': 40}
# Atlases are kept at twice the drawn size so the NEAREST downscale in game
# has something to sample and the result is not aliased.
SS = 2


# ---------------------------------------------------------------- backgrounds

def magenta_alpha(px):
    """Alpha from distance to magenta, with partial coverage unmatted."""
    out = []
    for r, g, b in px:
        d = ((r - 255) ** 2 + g ** 2 + (b - 255) ** 2) ** 0.5
        if d <= 95:
            out.append((0.0, (r, g, b)))
        elif d >= 190:
            out.append((1.0, (r, g, b)))
        else:
            # Linear coverage, then unmix the magenta back out so the edge keeps
            # the creature's colour instead of a pink halo.
            a = (d - 95) / 95.0
            fg = []
            for c, m in zip((r, g, b), MAGENTA):
                v = (c - (1 - a) * m) / a
                fg.append(max(0, min(255, int(round(v)))))
            out.append((a, tuple(fg)))
    return out


def local_contrast_alpha(im, W, H, radius=10, thresh=9.0):
    """Crawler mask from local contrast, shaped like magenta_alpha.

    The crawler is a dark creature standing on a dark radial vignette, so both
    of the usual tricks fail: a brightness threshold keys the body away along
    with the background, and a flood fill from the frame box border leaks
    straight into the creature because its legs run off the edge of the box.

    The background is smooth, though, so it cancels out against a large box
    blur. Measured on this sheet that leaves ~1 unit of difference across the
    background and 20+ on the creature, with an empty valley in between -- so a
    single threshold separates them without touching the vignette's gradient.
    """
    import numpy as np
    bg = np.asarray(im.filter(ImageFilter.BoxBlur(radius)), dtype=np.float64)
    px = im.load()
    out = []
    for y in range(H):
        for x in range(W):
            c = px[x, y]
            d = max(abs(c[i] - bg[y, x, i]) for i in range(3))
            out.append((1.0 if d > thresh else 0.0, c))
    return out


def dilate(m, w, h, n=1):
    out = [row[:] for row in m]
    for _ in range(n):
        prev = [row[:] for row in out]
        for y in range(h):
            for x in range(w):
                if not prev[y][x]:
                    hit = (x > 0 and prev[y][x - 1]) or (x < w - 1 and prev[y][x + 1]) \
                        or (y > 0 and prev[y - 1][x]) or (y < h - 1 and prev[y + 1][x])
                    out[y][x] = bool(hit)
    return out


def close_mask(m, w, h, n=1):
    """Seal speckles: grow, then shrink back to the original outline."""
    return erode(dilate(m, w, h, n), w, h, n)


def fill_holes(m, w, h):
    """Fill background pockets that are fully enclosed by the mask.

    Anything the flood fill from the border cannot reach is interior, so this
    is exact rather than heuristic -- it closes the pinholes JPEG leaves in the
    crawler's dark body without touching the outline.
    """
    outside = [[False] * w for _ in range(h)]
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if not m[y][x] and not outside[y][x]:
                outside[y][x] = True
                stack.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not m[y][x] and not outside[y][x]:
                outside[y][x] = True
                stack.append((y, x))
    while stack:
        y, x = stack.pop()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not m[ny][nx] and not outside[ny][nx]:
                outside[ny][nx] = True
                stack.append((ny, nx))
    return [[m[y][x] or not outside[y][x] for x in range(w)] for y in range(h)]


def erode(mask, w, h, px=1):
    """Knock px transparent ring off the outside, to kill the key's fringe."""
    m = [row[:] for row in mask]
    for _ in range(px):
        nxt = [row[:] for row in m]
        for y in range(h):
            for x in range(w):
                if not m[y][x]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if nx < 0 or ny < 0 or nx >= w or ny >= h or not m[ny][nx]:
                        nxt[y][x] = 0
                        break
        m = nxt
    return m


# ------------------------------------------------------------------- detection

def bands(flags, w, h, frac=0.86):
    """Index ranges where `flags` is False, split wherever it is mostly True."""
    out, start = [], None
    for y in range(h):
        if flags[y]:
            if start is None:
                start = y
        elif start is not None:
            out.append((start, y - 1))
            start = None
    if start is not None:
        out.append((start, h - 1))
    return out


def split_row(colflags):
    """Column ranges where colflags[x] is False, split by the True gaps between."""
    out, start = [], None
    for x, empty in enumerate(colflags):
        if not empty:
            if start is None:
                start = x
        elif start is not None:
            out.append((start, x - 1))
            start = None
    if start is not None:
        out.append((start, len(colflags) - 1))
    return out


def merge_fragments(boxes, max_gap=20):
    """Join column runs separated by a hair.

    The dead frames are sparse bursts: one frame's particles are separated by
    fully transparent columns, so a plain gap split tears a single frame into a
    dozen boxes. Real frames are tens of pixels apart, so a small absolute gap
    merges the fragments without touching the frame boundaries -- which matters
    because the spitter's loose fireball has to survive as its own box.
    """
    if not boxes:
        return boxes
    out = [list(boxes[0])]
    for x0, x1 in boxes[1:]:
        if x0 - out[-1][1] - 1 <= max_gap:
            out[-1][1] = x1
        else:
            out.append([x0, x1])
    return [tuple(b) for b in out]


def largest_component(mask, w, h, seed_extra=()):
    """Keep the largest connected blob of True, plus anything touching it."""
    seen = [[False] * w for _ in range(h)]
    best, best_n = None, 0
    for y0 in range(h):
        for x0 in range(w):
            if not mask[y0][x0] or seen[y0][x0]:
                continue
            q, comp = deque([(x0, y0)]), []
            seen[y0][x0] = True
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and mask[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            if len(comp) > best_n:
                best_n, best = len(comp), comp
    keep = [[False] * w for _ in range(h)]
    for x, y in best:
        keep[y][x] = True
    # Anything touching the main blob belongs to the creature too: legs, back
    # spikes and the mouth glow can sit a pixel away.
    changed = True
    while changed:
        changed = False
        for y in range(h):
            for x in range(w):
                if not mask[y][x] or keep[y][x]:
                    continue
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and keep[ny][nx]:
                        keep[y][x] = True
                        changed = True
                        break
    return keep


# ------------------------------------------------------------------- per sheet

def cut(name):
    src = os.path.join(ROOT, SOURCES[name])
    im = Image.open(src).convert('RGB')
    W, H = im.size
    px = im.load()

    flat = [px[x, y] for y in range(H) for x in range(W)]
    alpha = (magenta_alpha(flat) if name != 'crawler'
             else local_contrast_alpha(im, W, H))
    solid = [[alpha[y * W + x][0] > 0.5 for x in range(W)] for y in range(H)]

    if name != 'crawler':
        solid = erode(solid, W, H, 1)

    # Rows: a row band is a run of rows that is not entirely background.
    # rowflags[y] is True for a separator (an almost empty row); bands() wants
    # True for "part of the band", so it is inverted here.
    sep = [sum(1 for x in range(W) if solid[y][x]) < W * 0.02 for y in range(H)]
    rows = bands([not f for f in sep], W, H)
    rows = [r for r in rows if r[1] - r[0] > H * 0.05]
    # JPEG noise in the magenta keys as a few stray solid pixels and shows up as
    # a thin band. A real row carries a large share of the sheet's content, so
    # anything far below the largest band is noise.
    weight = lambda r: sum(1 for y in range(r[0], r[1] + 1) for x in range(W) if solid[y][x])
    if rows:
        top = max(weight(r) for r in rows)
        rows = [r for r in rows if weight(r) > top * 0.15]
    expected_rows = 3
    if len(rows) != expected_rows:
        raise SystemExit(f'{name}: expected {expected_rows} rows, found {len(rows)} {rows}')

    boxes = []          # (x0, y0, x1, y1) per frame, in reading order
    for (y0, y1) in rows:
        colflags = [all(not solid[y][x] for y in range(y0, y1 + 1)) for x in range(W)]
        boxes_row = merge_fragments(split_row(colflags))
        for (x0, x1) in boxes_row:
            if (x1 - x0) > W * 0.01 and (y1 - y0) > H * 0.05:
                boxes.append((x0, y0, x1, y1))

    shot_box = None
    if name == 'spitter':
        # Row 2 is: 3 cast frames, the loose fireball, then the recoiling frame.
        row2 = [b for b in boxes if rows[1][0] <= b[1] <= rows[1][1]]
        if len(row2) == 5:
            # Judge by solid pixels, not box area: the fireball's box is wide and
            # as tall as the row (it is centred in the band) but almost all of it
            # is transparent magenta, so its area is not much smaller than a
            # frame's while its content is an order of magnitude lighter.
            counts = [sum(1 for y in range(b[1], b[3] + 1)
                          for x in range(b[0], b[2] + 1) if solid[y][x]) for b in row2]
            med = sorted(counts)[len(counts) // 2]
            small = [i for i, c in enumerate(counts) if c < med * 0.4]
            if len(small) == 1:
                i = small[0]
                shot_box = boxes.remove(row2[i]) or row2[i]
                print(f'  spitter: cut the loose fireball out as spitterShot {shot_box}'
                      f' ({counts[i]} solid px vs {med} median)')
        row2 = [b for b in boxes if rows[1][0] <= b[1] <= rows[1][1]]
        if len(row2) != 4:
            raise SystemExit(f'spitter row 2: expected 4 frames after the fireball, got {len(row2)}')

    expect = max(v[-1] for v in CLIPS[name].values()) + 1
    if len(boxes) != expect:
        raise SystemExit(f'{name}: expected {expect} frames, found {len(boxes)}')

    # Crawler: keep only the largest connected blob in each frame box. The
    # contrast mask is clean enough on its own, but JPEG ringing around the
    # legs leaves stray specks, and a sprite must not drag debris along.
    frames = []
    for (x0, y0, x1, y1) in boxes:
        bw, bh = x1 - x0 + 1, y1 - y0 + 1
        if name == 'crawler':
            local = [[solid[y][x] for x in range(x0, x1 + 1)] for y in range(y0, y1 + 1)]
            local = fill_holes(local, bw, bh)
            local = close_mask(local, bw, bh, 1)
            keep = largest_component(local, bw, bh)
            keep = fill_holes(keep, bw, bh)
            a = [[(1.0 if keep[y][x] else 0.0) for x in range(bw)] for y in range(bh)]
        else:
            a = [[alpha[y * W + x][0] for x in range(x0, x1 + 1)] for y in range(y0, y1 + 1)]
        frames.append((x0, y0, a))

    if name == 'crawler':
        # One pixel of erosion on the final mask too: the vignette is soft and
        # the threshold leaves a faint halo.
        for i, (_, _, a) in enumerate(frames):
            m = erode([[v > 0.5 for v in row] for row in a], len(a[0]), len(a), 1)
            frames[i] = (frames[i][0], frames[i][1],
                         [[1.0 if m[y][x] else 0.0 for x in range(len(m[0]))] for y in range(len(m))])

    return im, W, H, frames, shot_box


def shrink(img, target_h):
    """Alpha-safe area-average downscale to `target_h` tall (see pack())."""
    import numpy as np
    k = img.height / target_h
    tw = max(1, round(img.width / k))
    import numpy as np
    arr = np.asarray(img, dtype=np.float64) / 255.0
    arr[..., :3] *= arr[..., 3:4]
    plane = lambda v: Image.fromarray(v.astype(np.float32), 'F').resize(
        (tw, target_h), Image.BOX)
    r, g, b, a = (plane(arr[..., i]) for i in range(4))
    aa = np.asarray(a, dtype=np.float64)
    rgbv = np.stack([np.asarray(c, dtype=np.float64) for c in (r, g, b)], -1)
    rgbv = np.where(aa[..., None] > 1e-6, rgbv / np.maximum(aa[..., None], 1e-6), 0.0)
    out = np.concatenate([np.clip(rgbv, 0, 1), aa[..., None]], -1)
    return Image.fromarray(np.round(out * 255).astype(np.uint8), 'RGBA')


def contact_sheet(manifest, sheets, zoom=3, pad=6, label_h=11):
    """Every cut frame on mid-grey at `zoom`x, grouped by clip.

    Mid-grey matters: a magenta or dark fringe that hides against the sheet's
    own background shows up immediately against neutral grey, and the zoom is
    what makes a 22px-tall silhouette inspectable at all.
    """
    from PIL import ImageDraw
    grey = (128, 128, 128, 255)
    rows = []
    for name in ('wisp', 'crawler', 'spitter', 'spitterShot'):
        m = manifest[name]
        cw, ch = m['cell']
        src = sheets[name]
        row_w = sum((len(v) * cw + pad) for _, v in m['frames']) + pad
        rows.append((name, Image.new('RGBA', (row_w * zoom, (ch + label_h) * zoom), grey), row_w, ch))

    sheet_w = max(r[2] for r in rows) * zoom + pad
    total_h = sum((r[3] + label_h) * zoom + pad for r in rows) + pad
    out = Image.new('RGBA', (sheet_w, total_h), grey)
    d = ImageDraw.Draw(out)

    y = pad
    for name, _, row_w, ch in rows:
        m = manifest[name]
        cw, _h = m['cell']
        src = sheets[name]
        block_h = (ch + label_h) * zoom
        d.text((pad, y), name, fill=(255, 255, 255, 255))
        x = pad
        for clip, rects in m['frames']:
            for (fx, _fy) in rects:
                cell = src.crop((fx, 0, fx + cw, ch))
                cell = cell.resize((cw * zoom, ch * zoom), Image.NEAREST)
                out.paste(cell, (x, y + label_h * zoom), cell)
                d.text((x + 2, y + label_h * zoom - 10), f'{clip}{fx // cw}',
                       fill=(255, 255, 255, 255))
                x += cw * zoom + pad
            x += pad
        y += block_h + pad
    return out


def pack(name, frames, display_h):
    """One uniform cell for the whole enemy, frames aligned to the shared box so
    the motion inside a row survives.

    The sheets are 1300-2500px wide but a minion is 20-40px tall in game, so
    every frame is reduced to twice its drawn height. Two details matter here:

    - The resize is done on premultiplied alpha. A straight RGBA resize blends
      towards transparent black and puts a dark halo around every silhouette,
      which on a 2px-tall sprite edge is very visible.
    - The reduction is huge (~18x) and happens inside a small alpha mask, so
      PIL's BOX filter (proper area averaging) is the right kernel. LANCZOS
      samples too little support per output pixel and aliases badly.
    """
    import numpy as np

    xs = [f[0] for f in frames]
    ys = [f[1] for f in frames]
    rights = [f[0] + len(f[2][0]) for f in frames]
    bots = [f[1] + len(f[2]) for f in frames]
    cx0, cy0 = min(xs), min(ys)
    cw, ch = max(rights) - cx0, max(bots) - cy0

    th = display_h * SS
    k = ch / th                      # area-average down to the target height
    tw = max(1, round(cw / k))
    sheet = Image.new('RGBA', (tw * len(frames), th), (0, 0, 0, 0))

    for i, (fx, fy, a, rgb) in enumerate(frames):
        fh, fw = len(a), len(a[0])
        arr = np.zeros((fh, fw, 4), dtype=np.float64)
        for y in range(fh):
            for x in range(fw):
                # 0..1 throughout, matching alpha: the clip before handing the
                # tile to uint8 assumes every channel shares this range.
                arr[y, x, :3] = [c / 255.0 for c in rgb[y][x]]
                arr[y, x, 3] = a[y][x]
        arr[..., :3] *= arr[..., 3:4]                 # premultiply

        # Resize in float ('F' planes). A uint8 round-trip here would quantise
        # the premultiplied colour to 0/1 across a soft edge, and dividing that
        # back out by alpha afterwards multiplies the error into saturated
        # white halos around every silhouette.
        plane = lambda v: Image.fromarray(v.astype(np.float32), 'F').resize(
            (tw, th), Image.BOX)
        r, g, b, a = (plane(arr[..., i]) for i in range(4))
        aa = np.asarray(a, dtype=np.float64)
        rgbv = np.stack([np.asarray(c, dtype=np.float64) for c in (r, g, b)], -1)
        rgbv = np.where(aa[..., None] > 1e-6, rgbv / np.maximum(aa[..., None], 1e-6), 0.0)
        tile = np.concatenate([np.clip(rgbv, 0, 1), aa[..., None]], -1)
        sheet.paste(Image.fromarray(np.round(tile * 255).astype(np.uint8), 'RGBA'),
                    (i * tw + round((fx - cx0) / k), round((fy - cy0) / k)))
    return sheet, tw, th


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SCRATCH, exist_ok=True)
    manifest = {}

    for name in ('wisp', 'crawler', 'spitter'):
        print(f'{name}:')
        im, W, H, frames, shot_box = cut(name)
        # colour lookup per frame, kept beside the mask
        px = im.load()
        rich = []
        for (fx, fy, a) in frames:
            fh, fw = len(a), len(a[0])
            rich.append((fx, fy, a, [[px[fx + x, fy + y] for x in range(fw)] for y in range(fh)]))

        sheet, cw, ch = pack(name, rich, DISPLAY_H[name])
        sheet.save(os.path.join(OUT, f'{name}.png'))
        disp_w = round(DISPLAY_H[name] * cw / ch)
        # Same shape as assets/atlases/manifest.json: a list of
        # [clipName, [[x, y], ...]] with absolute atlas coords, so the renderer
        # can treat a minion exactly like a painted character.
        manifest[name] = {
            'cell': [cw, ch],
            'size': [sheet.width, sheet.height],
            'nativeFacing': 1,
            # Drawn size. `cell` is twice this; sampling at cell and drawing at
            # display is what keeps the NEAREST downscale from eating the art.
            'display': [disp_w, DISPLAY_H[name]],
            'baseline': ch,
            'figure': DISPLAY_H[name],
            'frames': [[clip, [[i * cw, 0] for i in idxs]]
                       for clip, idxs in CLIPS[name].items()],
        }
        print(f'  sheet {sheet.size[0]}x{sheet.size[1]} cell {cw}x{ch} '
              f'display {disp_w}x{DISPLAY_H[name]}  frames {sum(len(v) for v in CLIPS[name].values())}')

        if name == 'spitter' and shot_box:
            x0, y0, x1, y1 = shot_box
            # The ranges already start at the box origin, so index px directly.
            a = [[magenta_alpha([px[x, y]])[0][0] for x in range(x0, x1 + 1)]
                 for y in range(y0, y1 + 1)]
            m = erode([[v > 0.5 for v in row] for row in a], len(a[0]), len(a), 1)
            shot = Image.new('RGBA', (len(a[0]), len(a)), (0, 0, 0, 0))
            sp = shot.load()
            for y in range(len(a)):
                for x in range(len(a[0])):
                    if m[y][x]:
                        sp[x, y] = (*px[x0 + x, y0 + y], 255)
            bbox = shot.getchannel('A').getbbox()
            if bbox:
                shot = shot.crop(bbox)
            shot = shrink(shot, 8 * SS)
            shot.save(os.path.join(OUT, 'spitterShot.png'))
            sw, sh = shot.size
            manifest['spitterShot'] = {
                'cell': [sw, sh], 'size': [sw, sh], 'nativeFacing': 1,
                'display': [round(8 * sw / sh), 8],
                'baseline': sh, 'figure': 8,
                'frames': [['shot', [[0, 0]]]],
            }
            print(f'  spitterShot {shot.size[0]}x{shot.size[1]}')

    sheets = {n: Image.open(os.path.join(OUT, f'{n}.png')) for n in manifest}
    path = os.path.join(SCRATCH, 'minions.png')
    contact_sheet(manifest, sheets).save(path)
    print(f'contact sheet {path}')

    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
    print(f'\nwrote {OUT}/manifest.json')


if __name__ == '__main__':
    main()
