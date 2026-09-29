#!/usr/bin/env python3
"""LUMENFALL asset pipeline.

Turns the reference sheets in assets/ into gameplay sprite atlases.

Stage 1 rebuilt this. The previous version was wrong in three ways that all
showed up on screen:

  * statue.jpeg was keyed with a global colour distance plus a luminance gate.
    Its figures sit only ~50 luminance units above the board, so the gate ate
    the interior and the sprite came out as white outlines. It is now keyed with
    a flood fill from the border of each crop box, which cannot leak inward.
  * the magenta sheets kept a pink fringe. Now keyed by chroma distance, then
    eroded 1px and stripped of any surviving magenta-hue pixel.
  * frames were downscaled with BOX and then graded. BOX blends, which smears
    pixel art, and the grade is why Kael's teal cloak rendered brown. Now a
    single NEAREST scale per character and no grade at all.

Frames are baseline-locked into a shared cell. Per-frame tight crops sit at
slightly different heights and the animation wobbles; the baseline is what makes
it read as one character.

Usage:
    python3 tools/build-atlas.py            # build atlases + contact sheet
    python3 tools/build-atlas.py --probe    # contact sheet only
"""

import colorsys
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
PROBE_DIR = os.path.join(ROOT, ".scratch", "stage1")

MAGENTA = np.array([255.0, 0.0, 255.0])

# The board colour sampled from statue.jpeg's own background.
STATUE_BG_TOL = 28


# --------------------------------------------------------------------- keying
def key_magenta(rgb, chroma_tol=70):
    """#FF00FF -> alpha, by chroma distance, then de-fringe.

    Two extra steps, both needed to get a clean edge out of a JPEG:
      * erode one pixel of alpha, which eats the half-transparent halo the
        encoder leaves around the silhouette
      * strip any pixel still within 25 degrees of magenta hue at saturation
        above 0.5, which is the fringe that survives erosion
    """
    d = np.sqrt(((rgb - MAGENTA) ** 2).sum(axis=2))
    alpha = (d > chroma_tol).astype(np.float32)

    alpha = ndimage.binary_erosion(alpha > 0.5, structure=np.ones((3, 3)))
    alpha = alpha.astype(np.float32)

    # Hue-based de-fringe. Motion smears and sword trails are left alone: they
    # are part of the frame, and they are not magenta.
    hsv = np.array([colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)
                    for r, g, b in rgb.reshape(-1, 3)], dtype=np.float32)
    hsv = hsv.reshape(rgb.shape)
    hue = hsv[..., 0] * 360.0
    sat = hsv[..., 1]
    # Magenta sits at 300 deg. Test a 25-degree window around it, wrapping.
    delta = np.abs(hue - 300.0)
    delta = np.minimum(delta, 360.0 - delta)
    alpha[(delta < 25.0) & (sat > 0.5)] = 0.0
    return np.dstack([rgb, alpha * 255.0]).astype(np.uint8)


def flood_key(rgb, box, tol=STATUE_BG_TOL):
    """Key statue.jpeg by flooding the board colour in from a crop box's border.

    The board background is near-uniform but the figures are only slightly
    lighter than it, so a global distance threshold either keeps the background
    or eats the sprite. Flood filling from the border cannot leak inward past the
    silhouette, so it is the only approach that holds both the grey stone and the
    dark red roots.
    """
    x0, y0, x1, y1 = box
    sub = rgb[y0:y1, x0:x1].astype(np.float32)
    # Reference colour = median of the border ring, not the single top-left
    # corner. A corner can land on a section divider or the edge of a figure --
    # the 'dead' crop's corner is (6,4,7), near black -- and keying against that
    # makes the whole crop read as one solid silhouette.
    ring = np.concatenate([
        sub[0, :], sub[-1, :], sub[:, 0], sub[:, -1]], axis=0)
    ref = np.median(ring, axis=0)
    d = np.sqrt(((sub - ref) ** 2).sum(axis=2))
    near = d <= tol
    lab, n = ndimage.label(near)
    if n == 0:
        return np.dstack([sub, np.full(sub.shape[:2], 255.0, np.float32)])
    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)
    bg = np.isin(lab, list(border))
    alpha = (~bg).astype(np.float32)
    return np.dstack([sub, alpha * 255.0]).astype(np.uint8)


# --------------------------------------------------------------------- slicing
def components(alpha, min_px=1500):
    solid = alpha > 0.5
    lab, n = ndimage.label(solid)
    sizes = ndimage.sum(solid, lab, range(1, n + 1))
    objs = ndimage.find_objects(lab)
    out = []
    for i, size in enumerate(sizes):
        if size < min_px:
            continue
        sl = objs[i]
        out.append((sl[1].start, sl[0].start, sl[1].stop, sl[0].stop))
    return out


def in_row(box, y0, y1):
    """Component counts as part of a row if its top edge is in the band."""
    return y0 <= box[1] < y1


def slice_rows(keyed, rows, want, min_px=1500):
    """For each (y0, y1, count) band, take `count` components left to right.

    Magenta sheets are used here rather than per-crop flood fill: their figures
    are well separated, so connected components is both simpler and exact.
    """
    arr = np.asarray(keyed)
    alpha = arr[..., 3].astype(np.float32) / 255.0
    boxes = components(alpha, min_px)
    out = []
    for y0, y1, n in rows:
        band = [b for b in boxes if in_row(b, y0, y1)]
        band.sort(key=lambda b: b[0])
        if len(band) < n:
            print(f"    ! band {y0}-{y1} wanted {n}, found {len(band)}")
        out.extend(band[:n])
    return out


def slice_columns(keyed, spans, tol=STATUE_BG_TOL):
    """Even x-division of a section, flood-filled per box.

    statue.jpeg's poses touch, so they merge into one component and cannot be
    separated that way. The board lays them out evenly, so the boxes are derived
    by division -- and each is keyed on its own, per the design.
    """
    out = []
    for y0, y1, x0, x1, n in spans:
        pitch = (x1 - x0) / float(n)
        for i in range(n):
            bx0 = int(round(x0 + i * pitch))
            bx1 = int(round(x0 + (i + 1) * pitch))
            out.append(((bx0, y0, bx1, y1), keyed[y0:y1, bx0:bx1]))
    return out


# ---------------------------------------------------------------- normalising
def to_rgba(arr):
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def scale_all(frames, figure_h):
    """One NEAREST scale for the whole character.

    Scaling each frame to the same height would make the character breathe as it
    animates. A single shared factor keeps the proportions the sheet author drew.
    """
    trimmed = [f.crop(f.getbbox()) for f in frames]
    tallest = max(f.height for f in trimmed)
    scale = figure_h / float(tallest)
    out = []
    for f in trimmed:
        w = max(1, int(round(f.width * scale)))
        h = max(1, int(round(f.height * scale)))
        out.append(f.resize((w, h), Image.NEAREST))
    return out


def pack(frames, baseline_pad=3):
    """Shared cell, feet on a common baseline."""
    cell_w = max(f.width for f in frames) + 2
    cell_h = max(f.height for f in frames) + baseline_pad
    baseline = cell_h - baseline_pad
    cells = []
    for f in frames:
        cell = Image.new("RGBA", (cell_w, cell_h), (0, 0, 0, 0))
        cell.paste(f, ((cell_w - f.width) // 2, baseline - f.height), f)
        cells.append(cell)
    return cells, (cell_w, cell_h), baseline


def pack_atlas(cells, cell):
    cw, ch = cell
    per_row = max(1, 2048 // cw)
    placed, x, y, rowh = [], 0, 0, 0
    for c in cells:
        if x + cw > per_row * cw:
            x = 0
            y += rowh
            rowh = 0
        placed.append((x, y))
        x += cw
        rowh = max(rowh, ch)
    atlas = Image.new("RGBA", (per_row * cw, y + rowh), (0, 0, 0, 0))
    for c, (px, py) in zip(cells, placed):
        atlas.paste(c, (px, py), c)
    return atlas, placed


# ------------------------------------------------------------------ characters
CHARACTERS = OrderedDict()

CHARACTERS["kael"] = {
    "src": "kael.jpeg",
    "figure": 44,
    "nativeFacing": 1,          # the sheet faces right
    "key": "magenta",
    # Row bands, then clips cut across them. Order is the sheet's own:
    # left to right, top to bottom.
    "rows": [(80, 340, 6), (375, 650, 4), (675, 970, 5)],
    # Sheet order is row1 1-6, row2 1-4, row3 1-5, numbered from zero.
    "clips": OrderedDict([
        ("idle",   [0, 1]),
        ("run",    [2, 3, 4, 5]),
        ("jump",   [6]),
        ("fall",   [7]),
        ("dash",   [8, 9]),
        ("attack", [10, 11, 12]),
        ("hurt",   [13]),
        ("dead",   [14]),
    ]),
}

CHARACTERS["goodwitch"] = {
    "src": "goodwitch.jpeg",
    "figure": 46,
    "nativeFacing": 1,          # the elder faces right
    "key": "magenta",
    "rows": [(40, 315, 2), (330, 610, 4), (635, 895, 2), (910, 1200, 4)],
    "clips": OrderedDict([
        ("idle",  [0, 1]),
        ("walk",  [2, 3, 4, 5]),
        ("talk",  [6, 7]),
        ("offer", [8, 9, 10, 11]),   # last frame is the green-eyed reveal
    ]),
}

CHARACTERS["badwitch"] = {
    "src": "badwitch.jpeg",
    "figure": 52,
    "nativeFacing": -1,         # staff is held out to the left: faces left
    "key": "magenta",
    # 19 components, but 6 of them are effects or dithered dissolve frames
    # rather than bodies. Listed explicitly by component index so the wrong
    # frames cannot drift in when a threshold changes.
    "rows": [(20, 290, 3), (300, 560, 1), (550, 765, 4),
             (795, 1040, 5), (1050, 1225, 2)],
    # 15 components survive keying, but not all are bodies: index 6 is the green
    # projectile and 11 is a loose magic fragment. Two frames also arrive split
    # (a lantern detached from its figure), which is why 8/9 and 10/11 are
    # adjacent pairs -- both halves are kept so the figure reassembles.
    # 15 components survive keying. 6, 8, 9 and 11 are not whole figures: 6 is
    # the green projectile, 8 is a lantern detached from its owner, 9 is the
    # body half of that pair, and 11 is a narrow spell shard. The rest are
    # complete bodies and are the only ones usable as sprites.
    "pick": [0, 1, 2, 3, 4, 5, 7, 10, 12, 13, 14],
    "clips": OrderedDict([
        ("idle",   [0, 1, 2]),
        ("cast",   [3, 4]),
        ("sway",   [5, 6]),
        ("attack", [7, 8]),
        ("kneel",  [9]),
        ("dead",   [10]),
    ]),
}

CHARACTERS["demon"] = {
    "src": "demon.jpeg",
    "figure": 96,
    "nativeFacing": -1,         # lantern hangs in its left hand: faces left
    "key": "magenta",
    "rows": [(25, 310, 4), (340, 620, 4), (655, 945, 3), (975, 1235, 1)],
    "clips": OrderedDict([
        ("idle",     [0, 1, 2, 3]),
        ("walk",     [4, 5]),
        ("raise",    [6, 7]),
        ("teleport", [8, 9, 10]),
        ("vanish",   [11]),
    ]),
}

# statue.jpeg is a labelled design board, so its poses are addressed by box.
# Section 1 is one wide row of 12 evenly laid out poses; neighbouring poses touch
# and merge, so the boxes are derived by division rather than by detection.
# Section 4 supplies the two attacks. The three damage-state figures at bottom
# right become hurt/dead. Sections 2 and 3 (detail studies, a tree) are ignored.
CHARACTERS["statue"] = {
    "src": "statue.jpeg",
    "figure": 70,
    "nativeFacing": -1,         # faces right on the sheet -> store as drawn
    "key": "flood",
    # (y0, y1, x0, x1, count, flood_whole_section[, explicit_x_boundaries])
    "spans": [
        # Section 1's 12 poses. Boundaries read off the board: Idle 1 stands
        # alone, then Idle 2-4 are evenly packed, then a gap, then Caminar 1-4
        # and Correr 1-4 in a run of eight.
        # Boundaries are midpoints between the stone bases at x = 83, 195, 310,
        # 424 | 566, 674, 787, 897 | 1143, 1263, 1379, 1481 -- the 12 poses the
        # board labels. (There is a 13th figure at x~1009 with no label; it is
        # not one of the labelled poses and is skipped.)
        (136, 394, 0, 1536, 12, True, [0, 139, 252, 367, 495, 620, 730, 842,
                                       1020, 1203, 1321, 1430, 1536]),
        (752, 950, 630, 830, 1, False),    # Ataque Barrido
        (752, 950, 838, 1010, 1, False),   # Invocacion de Raices
    ],
    "boxes": [
        (1236, 748, 1320, 950),     # damage figure 1
        (1324, 748, 1408, 950),     # damage figure 2
        (1404, 800, 1512, 990),     # collapsed
    ],
    "clips": OrderedDict([
        ("idle",  [0, 1, 2, 3]),
        ("walk",  [4, 5, 6, 7]),
        ("run",   [8, 9, 10, 11]),
        ("sweep", [12]),
        ("roots", [13]),
        ("hurt",  [14, 15]),
        ("dead",  [16]),
    ]),
}


# ---------------------------------------------------------------------- build
def build(name, spec):
    """Slice, key, scale and pack one character. Returns (manifest, atlas)."""
    im = Image.open(os.path.join(ASSETS, spec["src"]))
    rgb = np.asarray(im.convert("RGB")).astype(np.float32)

    if spec["key"] == "magenta":
        keyed = to_rgba(key_magenta(rgb))
        boxes = slice_rows(keyed, spec["rows"], sum(r[2] for r in spec["rows"]))
        if "pick" in spec:
            boxes = [boxes[i] for i in spec["pick"] if i < len(boxes)]
        frames = [keyed.crop(b) for b in boxes]
    else:
        frames = []
        for span in spec["spans"]:
            y0, y1, x0, x1, n, whole = span[:6]
            cols = span[6] if len(span) > 6 else None
            if whole:
                # Section 1's poses are drawn OVERLAPPING -- Caminar and Correr
                # have robes that run into their neighbours, so the figures merge
                # into a single blob and no per-box border can separate them.
                # Flood the section once, then partition the resulting mask by
                # nearest label centre. Keying is still a flood fill from the
                # border, which is the part that preserves the grey stone; only
                # the split is done by position.
                sub = rgb[y0:y1, x0:x1]
                m = flood_key(sub, (0, 0, x1 - x0, y1 - y0))[..., 3] > 127
                # Boundaries are explicit, not even. The board groups the poses
                # (Idle x4, then a gap, then Caminar x4, Correr x4) so an even
                # division lands mid-figure and every walk frame comes out as two
                # half figures.
                edges = cols or [x0 + (x1 - x0) * i / float(n) for i in range(n + 1)]
                for i in range(n):
                    lo = max(0, int(round(edges[i] - x0)))
                    hi = min(m.shape[1], int(round(edges[i + 1] - x0)))
                    keep = np.zeros_like(m)
                    keep[:, lo:hi] = m[:, lo:hi]
                    rgba = np.dstack([sub, (keep * 255.0)]).astype(np.uint8)
                    frames.append(to_rgba(rgba))
            else:
                rgba = flood_key(rgb, (x0, y0, x1, y1))
                frames.append(to_rgba(rgba))
        for box in spec["boxes"]:
            frames.append(to_rgba(flood_key(rgb, box)))

    if len(frames) != max(max(i) for i in spec["clips"].values()) + 1:
        print("    ! %d frames extracted but clips index up to %d"
              % (len(frames), max(max(i) for i in spec["clips"].values())))

    scaled = scale_all(frames, spec["figure"])
    cells, cell, baseline = pack(scaled)
    atlas, placed = pack_atlas(cells, cell)

    out = OrderedDict()
    for clip, idx in spec["clips"].items():
        out[clip] = [list(placed[i]) for i in idx if i < len(placed)]

    return {
        "cell": list(cell),
        "baseline": baseline,
        "figure": spec["figure"],
        "nativeFacing": spec["nativeFacing"],
        "size": [atlas.width, atlas.height],
        "frames": out,
    }, atlas


def contact_sheet(atlases, path):
    """Mid-grey so both dark and light pixels are visible."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pad = 8
    ims = [a for _, a in atlases]
    W = sum(i.width for i in ims) + pad * (len(ims) + 1)
    H = max(i.height for i in ims) + pad * 2
    sheet = Image.new("RGBA", (W, H), (128, 128, 128, 255))
    x = pad
    for i in ims:
        sheet.alpha_composite(i, (x, pad))
        x += i.width + pad
    sheet.save(path)
    print("  contact sheet ->", path)


def main():
    probe = "--probe" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    manifest = OrderedDict()
    built = []
    for name, spec in CHARACTERS.items():
        print(name + ":")
        m, atlas = build(name, spec)
        manifest[name] = m
        built.append((name, atlas))
        if not probe:
            atlas.save(os.path.join(OUT, name + ".png"))
        clips = {c: len(f) for c, f in m["frames"].items()}
        print("  cell=%s figure=%d nativeFacing=%+d clips=%s"
              % (m["cell"], m["figure"], m["nativeFacing"], clips))

    contact_sheet(built, os.path.join(PROBE_DIR, "atlases.png"))

    if not probe:
        with open(os.path.join(OUT, "manifest.json"), "w") as f:
            json.dump(manifest, f, indent=1)
        print("\nwrote assets/atlases/manifest.json")


if __name__ == "__main__":
    main()
