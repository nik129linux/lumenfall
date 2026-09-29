#!/usr/bin/env python3
"""LUMENFALL asset pipeline.

Turns the reference sheets in assets/ into gameplay sprite atlases.

The character refs are reference *sheets*, not atlases: four of the five sit on
#FF00FF (74-80% coverage) and statue.jpeg is a labeled Spanish concept board.

Pipeline per character:
  1. chroma-key the background to alpha
  2. find frames (connected components, or hardcoded crops for statue)
  3. normalise to a shared cell, feet-baseline aligned
  4. pack into one atlas + emit a frame manifest

Step 3 is not optional. Every frame gets a tight crop, and tight crops animate
with a visible wobble because each figure sits at a slightly different height.
Snapping every figure to a common baseline is what makes the animation read as
one character instead of a pile of separate drawings.

Usage:
    python3 tools/build-atlas.py            # build all
    python3 tools/build-atlas.py --probe    # dump contact sheets for review
"""

import json
import os
import sys
from collections import OrderedDict

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
OUT = os.path.join(ASSETS, "atlases")

# #FF00FF, with tolerance for jpeg ringing around the silhouette edge.
KEY_RGB = np.array([255.0, 0.0, 255.0])
KEY_TOL = 118.0

# ---------------------------------------------------------------- per-character
# cell     = atlas cell size in pixels (== low-res buffer pixels, 1:1)
# figure   = height the figure is scaled to inside the cell
# baseline = y inside the cell that the figure's feet rest on
# frames   = which detected components map to which animation clip, in order

# Row bands are given explicitly rather than inferred. The sheets put their
# rows close enough together (sometimes under 90px apart) that any centre-based
# bucketing drifts and mis-orders the clips, and a mis-ordered animation is
# worse than a missing one. Each band is (y0, y1, count) and the N largest
# components in it are taken, left to right -- which is also what drops the
# non-body frames, like the green projectile sitting among the sorcerer's poses.

CHARACTERS = OrderedDict()

CHARACTERS["kael"] = {
    "src": "kael.jpeg",
    "cell": (48, 48),
    "figure": 40,
    "baseline": 44,
    "bands": [
        (80, 135, 6),      # idle x2, run x4
        (375, 425, 2),     # jump
        (460, 500, 2),     # dash
        (670, 790, 4),     # attack x3, hurt
        (850, 900, 1),     # down
    ],
    "clips": OrderedDict([
        ("idle", 2),
        ("run", 4),
        ("jump", 2),
        ("dash", 2),
        ("attack", 3),
        ("hurt", 1),
        ("dead", 1),
    ]),
}

CHARACTERS["goodwitch"] = {
    "src": "goodwitch.jpeg",
    "cell": (48, 56),
    "figure": 46,
    "baseline": 52,
    "bands": [
        (40, 75, 2),       # idle
        (330, 365, 4),     # walk
        (635, 665, 2),     # talk
        (910, 945, 4),     # offer -- the last one is the green-eyed reveal
    ],
    "clips": OrderedDict([
        ("idle", 2),
        ("walk", 4),
        ("talk", 2),
        ("offer", 4),
    ]),
}

CHARACTERS["badwitch"] = {
    "src": "badwitch.jpeg",
    "cell": (48, 56),
    "figure": 46,
    "baseline": 52,
    "min_w": 110,
    "bands": [
        (20, 65, 3),
        (300, 330, 2),
        (550, 600, 3),     # the 4th candidate here is the projectile, not a body
        (795, 855, 3),
        (1045, 1080, 1),
    ],
    "clips": OrderedDict([
        ("idle", 3),
        ("cast", 2),
        ("sway", 3),
        ("attack", 3),
        ("kneel", 1),
    ]),
}

CHARACTERS["demon"] = {
    "src": "demon.jpeg",
    "cell": (84, 84),
    "figure": 76,
    "baseline": 78,
    "bands": [
        (25, 60, 4),       # idle
        (340, 380, 4),     # walk x2, lantern raised x2
        (655, 700, 3),     # the swirl frames
        (975, 995, 1),     # vanish
    ],
    "clips": OrderedDict([
        ("idle", 4),
        ("walk", 2),
        ("raise", 2),
        ("teleport", 3),
        ("vanish", 1),
    ]),
}

# statue.jpeg is a labeled board, so connected components are useless here: the
# Spanish captions and the section rules are foreground as far as CC is
# concerned. Crops are hardcoded from the board layout instead.
CHARACTERS["statue"] = {
    "src": "statue.jpeg",
    "cell": (72, 80),
    "figure": 72,
    "baseline": 76,
    "levels": (0.10, 0.70),
    "bands": [
        # Section 1 is one wide row of 12 evenly-laid-out poses, so the band
        # subdivides its x range rather than detecting 12 separate components:
        # neighbouring poses touch and merge into single blobs.
        (150, 398, 24, 1516, 12),
        # Section 4 - Acciones y Ataques
        (748, 900, 505, 715, 1),
        (748, 900, 665, 890, 1),
    ],
    "clips": OrderedDict([
        ("idle", 4),
        ("walk", 4),
        ("run", 4),
        ("sweep", 1),
        ("roots", 1),
    ]),
}


# ----------------------------------------------------------------- key + slice
def key_magenta(im):
    """#FF00FF -> alpha. Returns RGBA plus the raw alpha mask."""
    rgb = np.asarray(im.convert("RGB")).astype(np.float64)
    # Distance to the key colour, weighted so the green channel (which carries
    # almost all of the separation) dominates.
    d = np.sqrt(((rgb - KEY_RGB) ** 2 * np.array([1.0, 2.2, 1.0])).sum(axis=2))
    alpha = np.clip((d - KEY_TOL) / 150.0, 0.0, 1.0)
    out = np.dstack([rgb, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), alpha


def key_dark(im):
    """Dark-board key, for statue.jpeg. Returns RGBA plus alpha mask.

    Distance-from-background only. An earlier version also gated on luminance,
    which quietly ate the statue's interior: the figure's median tone is 82
    against a 27 background, so a luminance gate erased most of the body and
    left only the rim light. Brightness is fixed later, in grade().
    """
    rgb = np.asarray(im.convert("RGB")).astype(np.float64)
    bg = np.array([22.0, 32.0, 31.0])
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    d = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    # Distance from the board colour, gated on brightness. The gate is low
    # (33) on purpose: the statue's median tone is 82 against a 27 background,
    # so a high gate erases the body and leaves only the rim light. At 33 it
    # still rejects jpeg chroma ringing, which moves in colour but not in
    # luminance, and that ringing is what leaves red speckle on the sprites.
    alpha = np.clip((d - 12.0) / 40.0, 0.0, 1.0) * np.clip((lum - 33.0) / 14.0, 0.0, 1.0)
    out = np.dstack([rgb, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out, "RGBA"), alpha


def components(alpha, min_w, min_h, min_px):
    """All components above the size floor, as bboxes."""
    solid = alpha > 0.5
    lab, n = ndimage.label(solid)
    if n == 0:
        return []
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    objs = ndimage.find_objects(lab)
    boxes = []
    for i, size in enumerate(sizes):
        if size < min_px:
            continue
        sl = objs[i]
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        if (x1 - x0) < min_w or (y1 - y0) < min_h:
            continue
        boxes.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1,
                      "area": size, "cx": (x0 + x1) / 2})
    return boxes


def frames_from_bands(alpha, bands, min_w, min_h, min_px, width):
    """Resolve bands to frame boxes.

    Two band shapes:
      (y0, y1, count)              -- detect `count` components inside the row
      (y0, y1, x0, x1, count)      -- divide that x range into `count` columns
    """
    allb = components(alpha, min_w, min_h, min_px)
    out = []
    for band in bands:
        if len(band) == 5:
            y0, y1, x0, x1, n = band
            pitch = (x1 - x0) / float(n)
            for i in range(n):
                cx0 = int(round(x0 + i * pitch))
                cx1 = int(round(x0 + (i + 1) * pitch)) if i < n - 1 else x1
                out.append({"x0": cx0, "y0": y0, "x1": cx1, "y1": y1, "area": 1, "cx": (cx0 + cx1) / 2})
            continue
        y0, y1, n = band
        inband = [b for b in allb if y0 <= b["y0"] < y1]
        inband.sort(key=lambda b: -b["area"])
        inband = sorted(inband[:n], key=lambda b: b["x0"])
        if len(inband) < n:
            print("  ! band %d-%d wanted %d, found %d" % (y0, y1, n, len(inband)))
        out.extend(inband)
    return out


# ----------------------------------------------------------------- normalise
def grade(arr, exposure=1.0, levels=None):
    """Levels, then contrast/saturation, then quantise.

    Keeps the painted source readable at 40px without it turning to mud.
    `levels` is a (black, white) pair in 0..1 for art whose tonal range does
    not reach the ends of the range, which is the case for the dim statue board.
    """
    rgb = arr[..., :3].astype(np.float32) / 255.0
    if levels:
        lo, hi = levels
        rgb = np.clip((rgb - lo) / max(1e-4, hi - lo), 0.0, 1.0)
    rgb = np.clip(rgb * exposure, 0.0, 1.0)
    lum = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    rgb = lum[..., None] + (rgb - lum[..., None]) * 0.86
    rgb = np.clip((rgb - 0.5) * 1.16 + 0.5, 0.0, 1.0)
    rgb = np.floor(rgb * 31.0 + 0.5) / 31.0
    return rgb


def normalise(cell_img, cell, figure_h, baseline, exposure=1.0, levels=None):
    """Scale one figure into a shared cell with its feet on the baseline."""
    cw, ch = cell
    trim = cell_img.crop(cell_img.getbbox())
    if trim.width == 0 or trim.height == 0:
        return Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    scale = figure_h / trim.height
    w = max(1, int(round(trim.width * scale)))
    h = max(1, int(round(trim.height * scale)))
    small = trim.resize((w, h), Image.BOX)
    arr = np.asarray(small).copy()
    arr[..., :3] = (grade(arr, exposure, levels) * 255.0).astype(np.uint8)
    small = Image.fromarray(arr, "RGBA")
    out = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    out.paste(small, ((cw - w) // 2, baseline - h), small)
    return out


# ---------------------------------------------------------------------- build
def build(name, spec, probe=False):
    path = os.path.join(ASSETS, spec["src"])
    im = Image.open(path)

    if name == "statue":
        keyed, alpha = key_dark(im)
    else:
        keyed, alpha = key_magenta(im)
    boxes = frames_from_bands(alpha, spec["bands"], spec.get("min_w", 60),
                              spec.get("min_h", 80), 500, im.width)

    exp = spec.get("exposure", 1.0)
    lev = spec.get("levels")
    cells = []
    for b in boxes:
        cells.append(normalise(keyed.crop((b["x0"], b["y0"], b["x1"], b["y1"])),
                               spec["cell"], spec["figure"], spec["baseline"], exp, lev))

    if probe:
        contact_sheet(cells, spec["cell"], os.path.join(OUT, "_probe_%s.png" % name))
        return {"frames": len(cells)}

    # Clip lengths must line up with what the detector actually found, or the
    # animation silently runs off the end of the atlas.
    if name != "statue":
        want = sum(spec["clips"].values())
        if len(cells) != want:
            print("  ! %s: found %d frames, clips expect %d" % (name, len(cells), want))
            spec = dict(spec)
            spec["clips"] = trim_clips(spec["clips"], len(cells))

    manifest, atlas = pack(cells, spec)
    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, "%s.png" % name))
    return manifest


def trim_clips(clips, available):
    clips = OrderedDict()
    for k, n in clips.items():
        if available <= 0:
            break
        take = min(n, available)
        clips[k] = take
        available -= take
    return clips


def pack(cells, spec):
    cw, ch = spec["cell"]
    frames = {}
    x = y = rowh = 0
    placed = []
    for c in cells:
        if x + cw > 2048:
            x = 0
            y += rowh
            rowh = 0
        placed.append((x, y))
        x += cw
        rowh = max(rowh, ch)
    atlas = Image.new("RGBA", (max(1, x), y + rowh), (0, 0, 0, 0))
    for c, (px, py) in zip(cells, placed):
        atlas.paste(c, (px, py), c)

    i = 0
    for clip, n in spec["clips"].items():
        idx = []
        for _ in range(n):
            if i >= len(placed):
                break
            idx.append(list(placed[i]))
            i += 1
        frames[clip] = idx

    return {
        "cell": [cw, ch],
        "baseline": spec["baseline"],
        "figure": spec["figure"],
        "size": [atlas.width, atlas.height],
        "frames": frames,
    }, atlas


def contact_sheet(cells, cell, path):
    os.makedirs(OUT, exist_ok=True)
    cols = 8
    cw, ch = cell
    rows = (len(cells) + cols - 1) // cols
    pad = 6
    sheet = Image.new("RGBA", (cols * (cw + pad) + pad, rows * (ch + pad) + pad), (40, 40, 46, 255))
    for n, c in enumerate(cells):
        r, col = divmod(n, cols)
        sheet.alpha_composite(c, (pad + col * (cw + pad), pad + r * (ch + pad)))
    sheet.save(path)
    print("  probe %s -> %s (%d frames)" % (os.path.basename(path), path, len(cells)))


def main():
    probe = "--probe" in sys.argv
    manifest = {}
    for name, spec in CHARACTERS.items():
        print("%s:" % name)
        m = build(name, spec, probe)
        if not probe:
            manifest[name] = m
            print("  -> assets/atlases/%s.png  cell=%s  clips=%s"
                  % (name, m["cell"], {k: len(v) for k, v in m["frames"].items()}))
    if not probe:
        with open(os.path.join(OUT, "manifest.json"), "w") as f:
            json.dump(manifest, f, indent=1)
        print("\nwrote assets/atlases/manifest.json")


if __name__ == "__main__":
    main()
