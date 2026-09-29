# Stage 1c — Real backgrounds + 3 leftovers

Scope: `js/render/parallax.js`, the level config, `assets/bg/manifest.json`, and the glow
FX in `js/game/fx.js`. Commit and stop. Do not create `.bunny-done`.

## 1. Use the new background paintings

Nico added purpose-made 16:9 backgrounds:
`assets/bg/l1.png` (1376x768), `assets/bg/l2.png` (1672x941), `assets/bg/l3.png` (1376x768).
Register them in `assets/bg/manifest.json` so the far layer uses them whole (source
priority 1 from stage 1b). Keep the crops/procedural only as fallback when a file is
missing. Same scaling rules as stage 1b: one high-quality downscale to 600x338 canvas,
1 texel = 1 buffer pixel, no tiling, `ClampToEdgeWrapping`.

The bottom ~35% of each painting is an empty dark ground band. Align it so that the
painting's ground line (l1 ≈ 80% of height, l2 ≈ 68%, l3 ≈ 78%) sits at or slightly
above the level's floor top on screen, so the painted ruins stand on our floor.

## 2. Blocky glow

A large soft glow (green in L1, purple/green in L2, yellow-green in L3) near the right
side renders as big visible squares, like a 16x16 texture upscaled with NearestFilter.
Find it (likely an additive light sprite around the elder / an entity / the level exit).
Generate its texture at least 128x128 with a smooth radial gradient and use
LinearFilter for THIS texture only. If it is the elder's aura, cap its radius at 40 buffer px.

## 3. L2 platform colour

L2 platforms are solid bright purple (#7a3fa0 fill). The fill must be near-black with a
purple tint (`#1a0f22`); keep the toxic-green 1-2 px top edge. Same logic as L1/L3.

## 4. Elder in every level

The elder (goodwitch) appears in the `?level=2` and `?level=3` screenshots. He belongs
only to L1 (and cutscenes). If this is debug-entry fallout, fix the entry; if the level
data places him, remove him from L2/L3.

## Acceptance

Screenshots to `.scratch/stage1c/`: `l1.png`, `l2.png`, `l3.png` via `?level=N`.
1. Each shows the new painting (L1 angel statues + arch, L2 purple cathedral with green
   windows, L3 orange sky + dead trees), crisp, no seams.
2. No visible square blocks anywhere on screen.
3. L2 platforms are near-black with a green top edge.
4. No elder in L2/L3.
5. Zero console errors.
Commit `Stage 1c: painted backgrounds, smooth glow, L2 platforms`.
