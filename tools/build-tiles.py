#!/usr/bin/env python3
"""Generates the level art: tilesheets, background props and the pickup.

    python3 tools/build-tiles.py            # writes assets/tiles, assets/props, assets/pickups
    python3 tools/build-tiles.py --preview  # also writes a 4x contact sheet per level into .scratch/

Same pattern as tools/build-atlas.py: seeded, deterministic, and the output is committed, so the
game needs no build step. Everything is authored 1:1 for the 480x270 buffer (one tile = 8 px,
Kael = 44 px tall) and sampled with NEAREST, never scaled.

Why periodic textures and not a pile of 8x8 tiles. Rock cracks have to run across tile borders; a
set of independent 8x8 variants cuts every crack off at the edge and the level reads as a grid. So
the body textures are 64x64 and tile seamlessly in both directions (Voronoi cells on a torus), and
the game samples them at world coordinates. The rim art (grass lip, hanging fringe, side edges,
platform slabs) are separate strips that are periodic in x.

The shapes follow the reference sheets (cracked rock under hanging grass, floating islands with a
ragged underside, pillars with a capital and a base, arches on winged-gargoyle columns). The
palettes do not: they are the level's own, kept dark so Kael and the pickups stay the brightest
things on screen. Pixels are authored directly in sRGB and the game decodes and re-encodes them
unchanged, so the PNG is what the player sees.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
T = 8            # tile size
P = 64           # period of the periodic textures


def hexc(h):
    return ((h >> 16) & 255, (h >> 8) & 255, h & 255)


# --------------------------------------------------------------------------- palettes
# rock: shade -> light, 4 steps. lip is the bright rim, lipDark the band under it.
PAL = {
    1: dict(  # Shrine of Ember: emerald ruin
        outline=hexc(0x050807), crack=hexc(0x080d0b),
        rock=[hexc(0x131c18), hexc(0x1a2823), hexc(0x233630), hexc(0x30493f)],
        mason=[hexc(0x151f1b), hexc(0x1d2b25), hexc(0x273c34), hexc(0x35503f)],
        mortar=hexc(0x080d0b),
        lipDark=hexc(0x10261d), lip=hexc(0x2f8f5a), lipHi=hexc(0x54f0a8),
        blades=[hexc(0x1f6b45), hexc(0x2f8f5a), hexc(0x54c98a)], tip=hexc(0x9fffc8),
        hang=[hexc(0x10261d), hexc(0x1f6b45)], spark=hexc(0x9fffc8),
    ),
    2: dict(  # Rotting Reliquary: purple masonry, toxic accents
        outline=hexc(0x07040c), crack=hexc(0x0b0612),
        rock=[hexc(0x1a1024), hexc(0x24162f), hexc(0x30203f), hexc(0x42305a)],
        mason=[hexc(0x1d1228), hexc(0x281a35), hexc(0x352442), hexc(0x4a3560)],
        mortar=hexc(0x0b0612),
        lipDark=hexc(0x15200f), lip=hexc(0x5f9a2e), lipHi=hexc(0x9be34a),
        blades=[hexc(0x6a4a9a), hexc(0xa86cf0), hexc(0xc89cff)], tip=hexc(0xe6d0ff),
        hang=[hexc(0x2a1a3a), hexc(0x4a7a2a)], spark=hexc(0x9be34a),
    ),
    3: dict(  # Lantern Wood: burnt earth, ember accents
        outline=hexc(0x060301), crack=hexc(0x0a0502),
        rock=[hexc(0x1d1106), hexc(0x291809), hexc(0x38220d), hexc(0x4d3016)],
        mason=[hexc(0x211308), hexc(0x2e1b0b), hexc(0x40270f), hexc(0x573518)],
        mortar=hexc(0x0a0502),
        lipDark=hexc(0x24130a), lip=hexc(0xa85a22), lipHi=hexc(0xffb060),
        blades=[hexc(0x6b3a14), hexc(0xa85a22), hexc(0xe0772e)], tip=hexc(0xffd89a),
        hang=[hexc(0x24130a), hexc(0x6b3a14)], spark=hexc(0xffb060),
    ),
}


# --------------------------------------------------------------------------- helpers
class Canvas:
    """RGBA pixel buffer with transparent default and clipped drawing."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.a = np.zeros((h, w, 4), dtype=np.uint8)

    def px(self, x, y, c, alpha=255):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.a[y, x] = (c[0], c[1], c[2], alpha)

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.px(xx, yy, c)

    def clear(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.a[y, x] = (0, 0, 0, 0)

    def image(self):
        return Image.fromarray(self.a, 'RGBA')


def per_noise(rng, n=P, octaves=((2, 1.0), (5, 0.6), (11, 0.35))):
    """Smooth noise that wraps at n, in about [-1, 1]. Integer cycle counts keep it periodic."""
    x = np.arange(n)
    out = np.zeros(n)
    for cyc, amp in octaves:
        out += amp * np.sin(2 * np.pi * (cyc * x / n + rng.random()))
    return out / sum(a for _, a in octaves)


def voronoi_torus(rng, n_cells=5, size=P):
    """Cell id, nearest distance and 2nd-nearest distance per pixel, wrapping at `size`."""
    cell = size / n_cells
    seeds = []
    for j in range(n_cells):
        for i in range(n_cells):
            seeds.append(((i + 0.2 + 0.6 * rng.random()) * cell, (j + 0.2 + 0.6 * rng.random()) * cell))
    seeds = np.array(seeds)
    ys, xs = np.mgrid[0:size, 0:size]
    d = []
    for sx, sy in seeds:
        dx = np.abs(xs - sx); dx = np.minimum(dx, size - dx)
        dy = np.abs(ys - sy); dy = np.minimum(dy, size - dy)
        d.append(np.hypot(dx, dy))
    d = np.stack(d, 0)
    order = np.argsort(d, axis=0)
    d1 = np.take_along_axis(d, order[:1], 0)[0]
    d2 = np.take_along_axis(d, order[1:2], 0)[0]
    return order[0], d1, d2, seeds


# --------------------------------------------------------------------------- body textures
def make_rock(pal, rng):
    """Cracked rock plates on a torus: 4 tones, dark cracks, light on the top-left of each plate."""
    cid, d1, d2, seeds = voronoi_torus(rng, 5)
    tone_of = [int(rng.choice([0, 1, 1, 2])) for _ in range(len(seeds))]
    cv = Canvas(P, P)
    for y in range(P):
        for x in range(P):
            i = cid[y, x]
            if d2[y, x] - d1[y, x] < 1.7:
                cv.px(x, y, pal['crack'])
                continue
            sx, sy = seeds[i]
            # signed offset along the light direction, wrapped to the nearest image
            ox = (x - sx + P / 2) % P - P / 2
            oy = (y - sy + P / 2) % P - P / 2
            lit = ox + oy
            t = tone_of[i]
            if lit < -5:
                t += 1
            elif lit > 6:
                t -= 1
            # a one-pixel light rim just inside the crack on the lit side
            if d2[y, x] - d1[y, x] < 3.0 and lit < 0:
                t += 1
            if rng.random() < 0.05:
                t += int(rng.choice([-1, 1]))
            cv.px(x, y, pal['rock'][max(0, min(3, t))])
    return cv


def make_masonry(pal, rng):
    """Running-bond blocks, 16x8, for pillars and walls. Mortar lines, lit top edge, shaded foot."""
    cv = Canvas(P, P)
    tone = {}
    for row in range(P // T):
        off = 8 if row % 2 else 0
        for col in range(P // 16):
            tone[(row, col)] = int(rng.choice([0, 1, 1, 2]))
        for yy in range(T):
            y = row * T + yy
            for x in range(P):
                xs = (x + off) % P
                col = xs // 16
                lx = xs % 16
                t = tone[(row, col)]
                if yy == 0 or lx == 0:
                    cv.px(x, y, pal['mortar'])
                    continue
                if yy == 1:
                    t += 1                      # lit top edge of the block
                elif yy == T - 1:
                    t -= 1                      # shaded foot
                if lx == 1:
                    t += 1
                if rng.random() < 0.07:
                    t += int(rng.choice([-1, 1]))
                cv.px(x, y, pal['mason'][max(0, min(3, t))])
    return cv


# --------------------------------------------------------------------------- rim strips
def make_lip_top(pal, rng):
    """64x8, drawn over the top row of a surface tile: bright rim, dark band, ragged lower edge."""
    cv = Canvas(P, T)
    n = per_noise(rng)
    for x in range(P):
        depth = int(round(4 + 2.2 * n[x] + rng.random() * 1.6))     # 3..7
        depth = max(3, min(7, depth))
        for y in range(depth):
            if y == 0:
                c = pal['lipHi'] if rng.random() < 0.35 else pal['lip']
            elif y == 1:
                c = pal['lip']
            elif y == 2 and rng.random() < 0.5:
                c = pal['lip']
            else:
                c = pal['lipDark']
            cv.px(x, y, c)
        # a thin strand that hangs further than the band
        if rng.random() < 0.12:
            for y in range(depth, min(T, depth + int(rng.integers(1, 3)))):
                cv.px(x, y, pal['lipDark'])
    return cv


def make_lip_over(pal, rng, level):
    """64x8, drawn in the open cell ABOVE a surface: blades, crystals or roots, bottom-aligned."""
    cv = Canvas(P, T)
    x = 0
    while x < P:
        x += int(rng.integers(2, 6 if level != 2 else 9))
        if x >= P:
            break
        if level == 1:      # grass
            h = int(rng.integers(2, 6))
            lean = int(rng.choice([-1, 0, 0, 1]))
            for k in range(h):
                c = pal['blades'][min(2, k * 3 // h)]
                cv.px((x + (lean if k > h // 2 else 0)) % P, T - 1 - k, c)
            cv.px((x + lean) % P, T - h, pal['tip'] if rng.random() < 0.25 else pal['blades'][2])
        elif level == 2:    # crystal shards and a bone-pale chip
            h = int(rng.integers(3, 8))
            w = int(rng.choice([1, 1, 2]))
            for k in range(h):
                for xx in range(w):
                    cv.px((x + xx) % P, T - 1 - k, pal['blades'][1] if xx == 0 else pal['blades'][0])
            cv.px(x % P, T - h, pal['tip'])
            if rng.random() < 0.25:
                cv.px((x + 3) % P, T - 1, hexc(0x8a8070))
        else:               # dry roots, low and crooked
            h = int(rng.integers(1, 4))
            for k in range(h):
                cv.px((x + (k % 2)) % P, T - 1 - k, pal['blades'][k % 2])
            if rng.random() < 0.2:
                cv.px(x % P, T - h - 1, pal['spark'])
    return cv


def make_fringe_bottom(pal, rng, level):
    """64x8, drawn in the open cell BELOW an overhang: hanging moss, drips or roots."""
    cv = Canvas(P, T)
    n = per_noise(rng)
    for x in range(P):
        if rng.random() < 0.33 + 0.1 * n[x]:
            length = int(rng.integers(2, 8))
            for k in range(length):
                taper = k / max(1, length - 1)
                c = pal['hang'][0] if taper < 0.55 else pal['hang'][1]
                if k == length - 1 and level == 2 and rng.random() < 0.5:
                    c = pal['spark']
                cv.px(x, k, c)
        elif rng.random() < 0.25:
            cv.px(x, 0, pal['hang'][0])
    return cv


def make_edges(pal, rng):
    """4x64 vertical strips for open left/right sides: outline, then light (left) or shade (right)."""
    left, right = Canvas(4, P), Canvas(4, P)
    n = per_noise(rng)
    for y in range(P):
        inset = 1 if n[y] > 0.45 else 0           # an occasional chip
        left.px(inset, y, pal['crack'])
        left.px(inset + 1, y, pal['rock'][3] if rng.random() < 0.7 else pal['rock'][2])
        right.px(3 - inset, y, pal['crack'])
        right.px(2 - inset, y, pal['rock'][0])
    return left, right


# --------------------------------------------------------------------------- platform slabs
def make_platform(pal, rng, level):
    """64x8 slab: rim, stone body with joint ticks, dark underside. Ends are separate 8x8 tiles."""
    cv = Canvas(P, T)
    for x in range(P):
        cv.px(x, 0, pal['lipHi'] if rng.random() < 0.25 else pal['lip'])
        cv.px(x, 1, pal['lip'])
        cv.px(x, 2, pal['lipDark'])
        for y in range(3, T - 1):
            t = 1 + (1 if y == 3 else 0) + (1 if rng.random() < 0.12 else 0) - (1 if rng.random() < 0.1 else 0)
            cv.px(x, y, pal['rock'][max(0, min(3, t))])
        cv.px(x, T - 1, pal['crack'])
    # joint ticks, so a long slab reads as laid stones
    for jx in range(5, P, 13):
        for y in range(3, T - 1):
            cv.px(jx, y, pal['crack'])
    return cv


def make_platform_cap(pal, rng, side):
    """8x8 end cap, rounded, outlined. side = -1 left end, +1 right end."""
    cv = make_platform(pal, rng, 0)
    cap = Canvas(T, T)
    cap.a[:, :, :] = cv.a[:, :T, :]
    xs = range(T)
    for x in xs:
        edge = x if side < 0 else T - 1 - x
        if edge == 0:
            for y in range(T):
                cap.px(x, y, pal['crack'])
            cap.clear(x, 0)
            cap.clear(x, T - 1)
        elif edge == 1:
            cap.px(x, 1, pal['lip'])
            cap.px(x, 2, pal['lipDark'])
            cap.px(x, T - 2, pal['crack'])
    return cap


def make_plank(pal, rng):
    """64x8 bridge plank for the shift bridges: glowing rim, boards with dark gaps, bolts."""
    cv = Canvas(P, T)
    for x in range(P):
        cv.px(x, 0, pal['lipHi'])
        cv.px(x, 1, pal['lip'])
        for y in range(2, T):
            t = 1 + (1 if y == 2 else 0) - (1 if y == T - 1 else 0)
            cv.px(x, y, pal['rock'][max(0, min(3, t))])
        cv.px(x, T - 1, pal['crack'])
    for gx in range(0, P, 16):
        for y in range(1, T):
            cv.px(gx, y, pal['crack'])
        cv.px((gx + 2) % P, 3, pal['lipHi'])
        cv.px((gx + 13) % P, 3, pal['lipHi'])
    return cv


# --------------------------------------------------------------------------- pillar pieces
def make_capital(pal, rng, kind):
    """8x8 pieces of a pillar's capital (top row). kind: 'L', 'M', 'R'."""
    cv = Canvas(T, T)
    for y in range(T):
        for x in range(T):
            t = 2
            if y == 0:
                c = pal['lipHi'] if kind != 'M' or x % 3 == 0 else pal['lip']
            elif y == 1:
                c = pal['lip']
            elif y == 2:
                c = pal['crack']                      # the shadow line under the slab
            elif y == T - 1:
                c = pal['crack']
            else:
                c = pal['mason'][2 if y < 5 else 1]
            cv.px(x, y, c)
    # chamfered outer corner and a lit left face
    if kind == 'L':
        cv.clear(0, 0)
        for y in range(1, T):
            cv.px(0, y, pal['crack'])
    if kind == 'R':
        cv.clear(T - 1, 0)
        for y in range(1, T):
            cv.px(T - 1, y, pal['crack'])
    # a small carved boss on the middle tile, echoing the scroll on the reference capital
    if kind == 'M':
        cv.rect(3, 4, 2, 2, pal['mason'][3])
    return cv


def make_base(pal, rng, kind):
    """8x8 pieces of a pillar's plinth (bottom row)."""
    cv = Canvas(T, T)
    for y in range(T):
        for x in range(T):
            if y == 0:
                c = pal['mason'][3]
            elif y >= T - 1:
                c = pal['crack']
            elif y < 3:
                c = pal['mason'][2]
            else:
                c = pal['mason'][1]
            cv.px(x, y, c)
    if kind == 'L':
        for y in range(T):
            cv.px(0, y, pal['crack'])
    if kind == 'R':
        for y in range(T):
            cv.px(T - 1, y, pal['crack'])
    return cv



# --------------------------------------------------------------------------- props
# Background colonnades: a row of columns carrying round arches under a masonry beam, like the
# reference sheets. They are drawn behind the level and never collide. L1 gets plain mossy
# columns, L2 the winged-gargoyle columns, L3 charred columns with roots creeping down them.
from PIL import ImageDraw


def draw_cylinder(cv, x0, x1, y0, y1, pal):
    """A shaded shaft, light on the left, with the outline on both sides."""
    w = x1 - x0 + 1
    for x in range(x0, x1 + 1):
        t = (x - x0) / max(1, w - 1)
        if x == x0 or x == x1:
            c = pal['crack']
        elif t < 0.3:
            c = pal['mason'][3]
        elif t < 0.6:
            c = pal['mason'][2]
        elif t < 0.85:
            c = pal['mason'][1]
        else:
            c = pal['mason'][0]
        for y in range(y0, y1 + 1):
            cv.px(x, y, c)


def draw_slab(cv, cx, y0, h, w_top, w_bot, pal, lit=True):
    """A stepped slab (capital or plinth): wider at one end, outlined, lit on top."""
    for k in range(h):
        w = w_top + (w_bot - w_top) * k // max(1, h - 1)
        for x in range(cx - w // 2, cx - w // 2 + w):
            edge = x == cx - w // 2 or x == cx - w // 2 + w - 1
            if k == 0 and lit:
                c = pal['mason'][3]
            elif k == h - 1:
                c = pal['crack']
            elif edge:
                c = pal['crack']
            else:
                c = pal['mason'][2 if k < h // 2 else 1]
            cv.px(x, y0 + k, c)


def draw_gargoyle(cv, cx, y0, pal, eye):
    """A crouching winged gargoyle, front view, wings spread. ~32 wide, 22 tall."""
    img = Image.new('RGBA', (cv.w, cv.h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    O, M0, M1, M2, M3 = pal['crack'], pal['mason'][0], pal['mason'][1], pal['mason'][2], pal['mason'][3]
    for side in (-1, 1):
        sx = lambda dx: cx + side * dx
        # membrane, then the finger bones over it
        wing = [(sx(3), y0 + 11), (sx(8), y0 + 4), (sx(15), y0 + 1), (sx(16), y0 + 8), (sx(13), y0 + 13),
                (sx(14), y0 + 17), (sx(8), y0 + 15), (sx(3), y0 + 17)]
        d.polygon(wing, fill=M1, outline=O)
        d.line([(sx(4), y0 + 11), (sx(15), y0 + 2)], fill=M3)
        d.line([(sx(4), y0 + 12), (sx(15), y0 + 8)], fill=M3)
        d.line([(sx(4), y0 + 13), (sx(13), y0 + 15)], fill=M3)
        d.line([(sx(3), y0 + 17), (sx(14), y0 + 17)], fill=O)
    # body
    d.rectangle([cx - 4, y0 + 9, cx + 3, y0 + 20], fill=M2, outline=O)
    d.rectangle([cx - 3, y0 + 10, cx - 2, y0 + 19], fill=M3)
    d.rectangle([cx + 2, y0 + 10, cx + 2, y0 + 19], fill=M1)
    # crossed arms / claws on the pedestal edge
    d.rectangle([cx - 4, y0 + 17, cx + 3, y0 + 18], fill=M1, outline=O)
    # head
    d.rectangle([cx - 4, y0 + 1, cx + 3, y0 + 8], fill=M2, outline=O)
    d.rectangle([cx - 3, y0 + 2, cx - 2, y0 + 7], fill=M3)
    d.point([(cx - 5, y0 - 1), (cx - 5, y0), (cx + 4, y0 - 1), (cx + 4, y0)], fill=O)   # horns
    d.point([(cx - 4, y0), (cx + 3, y0)], fill=M3)
    d.rectangle([cx - 2, y0 + 6, cx + 1, y0 + 7], fill=M0)                                # snout
    d.point([(cx - 2, y0 + 4), (cx + 1, y0 + 4)], fill=eye)                              # glowing eyes
    arr = np.array(img)
    mask = arr[:, :, 3] > 0
    cv.a[mask] = arr[mask]


def draw_colonnade(level, kind, spacing=56, n_cols=3, floor_pad=1):
    """Columns + round arches under a beam. kind: 'ruin' | 'gargoyle' | 'burnt'."""
    pal = PAL[level]
    rng = np.random.default_rng(5000 + level)
    col_h = {'ruin': 52, 'gargoyle': 58, 'burnt': 54}[kind]
    r = spacing // 2 - 6                         # arch radius
    pad = 20
    W = pad * 2 + spacing * (n_cols - 1)
    spring_from_floor = col_h
    beam_h = 6
    H = col_h + r + beam_h + 8
    cv = Canvas(W, H)
    floor_y = H - 1 - floor_pad
    y_spring = floor_y - col_h + 1

    # --- the wall: a beam and the spandrels, as masonry, with the arch openings cut out
    mason = make_masonry(pal, rng)
    for y in range(0, y_spring):
        for x in range(W):
            cv.a[y, x] = mason.a[y % P, x % P]
    centers = [pad + spacing * i + spacing // 2 for i in range(n_cols - 1)]
    for acx in centers:
        for y in range(y_spring - r - 1, y_spring + 1):
            for x in range(acx - r - 1, acx + r + 2):
                dist = ((x - acx) ** 2 + (y - y_spring) ** 2) ** 0.5
                if dist <= r + 0.5 and y <= y_spring:
                    cv.clear(x, y)
    # voussoirs: a ring of lit and dark blocks hugging each opening
    for acx in centers:
        for y in range(y_spring - r - 8, y_spring + 1):
            for x in range(acx - r - 8, acx + r + 9):
                dist = ((x - acx) ** 2 + (y - y_spring) ** 2) ** 0.5
                if r + 0.5 < dist <= r + 6:
                    ang = np.degrees(np.arctan2(y_spring - y, x - acx))
                    seg = int(ang // 14)
                    t = 3 if (seg % 2 == 0) else 2
                    if abs(ang % 14) < 1.1:
                        cv.px(x, y, pal['mortar'])
                    elif dist < r + 1.6:
                        cv.px(x, y, pal['mason'][3])      # lit inner lip
                    else:
                        cv.px(x, y, pal['mason'][t - 1])
                elif r - 0.8 < dist <= r + 0.5 and y <= y_spring:
                    cv.px(x, y, pal['crack'])              # outline of the opening
    # beam: a lit top edge and a shadow line under it
    for x in range(W):
        cv.px(x, 0, pal['mason'][3])
        cv.px(x, beam_h, pal['crack'])
    # trim the outer ends of the wall
    for y in range(0, y_spring):
        cv.px(0, y, pal['crack']); cv.px(W - 1, y, pal['crack'])
    for x in range(W):
        cv.px(x, y_spring - 1, cv.a[y_spring - 1, x][:3] if cv.a[y_spring - 1, x][3] else pal['crack']) if False else None

    # --- the columns, in front of the wall
    col_cx = [pad + spacing * i for i in range(n_cols)]
    for cx in col_cx:
        if kind == 'gargoyle':
            draw_slab(cv, cx, floor_y - 6, 7, 20, 22, pal, lit=True)                 # plinth
            cv.rect(cx - 6, floor_y - 18, 13, 12, pal['mason'][1])                   # pedestal block
            cv.rect(cx - 6, floor_y - 18, 1, 12, pal['crack']); cv.rect(cx + 6, floor_y - 18, 1, 12, pal['crack'])
            cv.rect(cx - 5, floor_y - 18, 2, 12, pal['mason'][2])
            cv.rect(cx - 6, floor_y - 12, 13, 1, pal['crack'])
            draw_gargoyle(cv, cx, floor_y - 40, pal, pal['spark'])
            draw_cylinder(cv, cx - 4, cx + 3, y_spring + 6, floor_y - 41, pal)       # upper shaft
            cv.rect(cx - 5, y_spring + 11, 10, 1, pal['crack'])                      # ring
            draw_slab(cv, cx, y_spring, 6, 18, 14, pal, lit=True)                    # capital
        else:
            draw_slab(cv, cx, floor_y - 6, 7, 16, 20, pal, lit=True)
            draw_cylinder(cv, cx - 5, cx + 4, y_spring + 6, floor_y - 7, pal)
            for ry in range(y_spring + 16, floor_y - 8, 10):
                cv.rect(cx - 5, ry, 10, 1, pal['crack'])                             # drum joints
            draw_slab(cv, cx, y_spring, 6, 20, 14, pal, lit=True)

    # --- weathering, per level
    if kind == 'ruin':
        # moss on every upward-facing edge and a few vines down the wall, and one chipped corner
        for x in range(W):
            for y in range(1, H - 1):
                if cv.a[y, x][3] and not cv.a[y - 1, x][3] and rng.random() < 0.7:
                    cv.px(x, y - 1, pal['lip']); cv.px(x, y, pal['lipDark'])
        for _ in range(7):
            vx = int(rng.integers(2, W - 2)); vy = int(rng.integers(2, 8))
            for k in range(int(rng.integers(5, 16))):
                if cv.a[vy + k, vx][3]:
                    cv.px(vx, vy + k, pal['hang'][k % 2])
        for y in range(0, 9):                       # the beam's right end has crumbled
            for x in range(W - 1 - (9 - y) // 2 - 3, W):
                cv.clear(x, y)
    elif kind == 'burnt':
        # soot on the beam, roots creeping down from it
        for x in range(W):
            if rng.random() < 0.18:
                for k in range(int(rng.integers(3, 12))):
                    if k + 1 < H and cv.a[k + 1, x][3]:
                        cv.px(x, k + 1, pal['hang'][k % 2])
        for _ in range(60):
            sx, sy = int(rng.integers(1, W - 1)), int(rng.integers(0, y_spring))
            if cv.a[sy, sx][3]:                      # only on stone, never in the openings
                cv.px(sx, sy, pal['crack'])
    else:
        # toxic drip from the beam
        for x in range(W):
            if rng.random() < 0.10:
                for k in range(int(rng.integers(2, 7))):
                    if cv.a[k + 1, x][3]:
                        cv.px(x, k + 1, pal['hang'][k % 2])
    return cv


# --------------------------------------------------------------------------- the pickup
# Each level's pickup is the hue that contrasts with its backdrop, not its accent: an orange ember
# on L3's orange sky vanished, and mint on L1's green forest did the same.
SHARD_PAL = {
    1: dict(o=hexc(0x4a2a08), d=hexc(0xc27a14), m=hexc(0xffc23c), l=hexc(0xfff0b0)),   # amber on green
    2: dict(o=hexc(0x063a3a), d=hexc(0x1fa8a0), m=hexc(0x5af0e0), l=hexc(0xd8fff8)),   # turquoise on purple
    3: dict(o=hexc(0x053a2a), d=hexc(0x1f9d68), m=hexc(0x54f0a8), l=hexc(0xcfffe6)),   # mint on orange
}
SHARD_FRAMES = 6
SHARD_SIZE = 10


def make_shard_row(level):
    """6 frames of a faceted crystal turning about its vertical axis, SHARD_SIZE px square each."""
    c = SHARD_PAL[level]
    S = SHARD_SIZE
    prof = [1, 2, 3, 4, 4, 4, 4, 3, 2, 1]           # half-width of a front view, per row
    scales = [1.0, 0.8, 0.5, 0.2, 0.5, 0.8]         # how wide each frame is
    row = Canvas(S * SHARD_FRAMES, S)
    for k, sc in enumerate(scales):
        ox = S * k
        back = k >= 3                               # past the edge-on frame the lit face is on the right
        for y in range(S):
            n = max(1, int(round(prof[y] * sc)))
            for dx in range(-n, n):
                x = S // 2 + dx
                edge = dx == -n or dx == n - 1
                lit = (dx >= 0) if back else (dx < 0)
                if edge:
                    col = c['o']
                elif y <= 1:
                    col = c['l'] if lit else c['m']          # the table: bright
                elif y >= S - 3:
                    col = c['d']                              # the point: shadow
                else:
                    col = c['l'] if (lit and y < 5) else (c['m'] if lit else c['d'])
                row.px(ox + x, y, col)
        if k == 0:
            row.px(ox + 3, 3, (255, 255, 255)); row.px(ox + 3, 4, c['l'])      # a glint on the front face
        if k == 1:
            row.px(ox + 7, 1, (255, 255, 255)); row.px(ox + 6, 2, c['l'])
        if k == 4:
            row.px(ox + 2, 1, (255, 255, 255)); row.px(ox + 3, 2, c['l'])
    return row


def build_props_and_pickup(preview):
    props_dir = os.path.join(ROOT, 'assets', 'props')
    pick_dir = os.path.join(ROOT, 'assets', 'pickups')
    os.makedirs(props_dir, exist_ok=True)
    os.makedirs(pick_dir, exist_ok=True)
    kinds = {1: 'ruin', 2: 'gargoyle', 3: 'burnt'}
    props = {}
    for level, kind in kinds.items():
        cv = draw_colonnade(level, kind)
        cv.image().save(os.path.join(props_dir, f'colonnade_l{level}.png'), optimize=True)
        props[f'colonnade_l{level}'] = [cv.w, cv.h]
    shard = Canvas(SHARD_SIZE * SHARD_FRAMES, SHARD_SIZE * 3)
    for level in (1, 2, 3):
        row = make_shard_row(level)
        shard.a[(level - 1) * SHARD_SIZE:level * SHARD_SIZE, :] = row.a
    shard.image().save(os.path.join(pick_dir, 'shard.png'), optimize=True)
    if preview:
        os.makedirs(os.path.join(ROOT, '.scratch'), exist_ok=True)
        for level in (1, 2, 3):
            img = Image.open(os.path.join(props_dir, f'colonnade_l{level}.png'))
            bg = Image.new('RGBA', img.size, (24, 28, 36, 255)); bg.alpha_composite(img)
            bg.resize((img.width * 4, img.height * 4), Image.NEAREST).save(
                os.path.join(ROOT, '.scratch', f'prop-l{level}-preview.png'))
        img = Image.open(os.path.join(pick_dir, 'shard.png'))
        bg = Image.new('RGBA', img.size, (24, 28, 36, 255)); bg.alpha_composite(img)
        bg.resize((img.width * 10, img.height * 10), Image.NEAREST).save(
            os.path.join(ROOT, '.scratch', 'shard-preview.png'))
    return props

# --------------------------------------------------------------------------- the sheet
# Where each piece lives in the PNG. The game reads this from manifest.json, so moving a piece here
# needs no change in JS.
def build_sheet(level):
    pal = PAL[level]
    rng = np.random.default_rng(1000 + level)
    rock = make_rock(pal, rng)
    mason = make_masonry(pal, rng)
    lip = make_lip_top(pal, rng)
    over = make_lip_over(pal, rng, level)
    fringe = make_fringe_bottom(pal, rng, level)
    el, er = make_edges(pal, rng)
    plat = make_platform(pal, rng, level)
    platL = make_platform_cap(pal, rng, -1)
    platR = make_platform_cap(pal, rng, +1)
    plank = make_plank(pal, rng)
    caps = [make_capital(pal, rng, k) for k in 'LMR']
    bases = [make_base(pal, rng, k) for k in 'LMR']

    W = 2 * P
    # Strips stack down the left, small pieces sit to their right, and the two 64-tall side-edge
    # strips go underneath everything.
    sheet_h = P + 5 * T + P
    sheet = Canvas(W, sheet_h)
    manifest = {}

    def put(name, cv, x, y):
        sheet.a[y:y + cv.h, x:x + cv.w] = cv.a
        manifest[name] = [x, y, cv.w, cv.h]

    put('rock', rock, 0, 0)
    put('masonry', mason, P, 0)
    y = P
    for name, cv in (('lipTop', lip), ('lipOver', over), ('fringe', fringe), ('platform', plat), ('plank', plank)):
        put(name, cv, 0, y)
        y += T
    # small pieces, right of the strips
    x = P
    for name, cv in (('platL', platL), ('platR', platR), ('capL', caps[0]), ('capM', caps[1]),
                     ('capR', caps[2]), ('baseL', bases[0]), ('baseM', bases[1]), ('baseR', bases[2])):
        put(name, cv, x, P)
        x += T
        if x + T > W:
            x = P
    put('edgeL', el, 0, P + 5 * T)
    put('edgeR', er, 8, P + 5 * T)
    return sheet, manifest


def main():
    preview = '--preview' in sys.argv
    out = os.path.join(ROOT, 'assets', 'tiles')
    os.makedirs(out, exist_ok=True)
    manifest = {'tile': T, 'period': P, 'levels': {}}
    for level in (1, 2, 3):
        sheet, m = build_sheet(level)
        sheet.image().save(os.path.join(out, f'l{level}.png'), optimize=True)
        manifest['levels'][str(level)] = m
        if preview:
            os.makedirs(os.path.join(ROOT, '.scratch'), exist_ok=True)
            img = sheet.image()
            bg = Image.new('RGBA', img.size, (70, 78, 90, 255))
            bg.alpha_composite(img)
            bg.resize((img.width * 4, img.height * 4), Image.NEAREST).save(
                os.path.join(ROOT, '.scratch', f'tiles-l{level}-preview.png'))
    manifest['props'] = build_props_and_pickup(preview)
    manifest['shard'] = {'frame': SHARD_SIZE, 'frames': SHARD_FRAMES, 'rows': 3}
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print('wrote', out)


if __name__ == '__main__':
    main()
