# Stage 1b — Fix the far backdrop

Stage 1 passed for sprites, flip, minions, menu. It FAILED on backgrounds: in the
screenshots the far layer is huge blurry blocks, tiled with seams, and L3 renders dark
BLUE when `3.jpg` is burnt orange (mean hue 21°). Scope is ONLY `js/render/parallax.js`
(+ the level config it reads). Commit and stop when the checks pass. Do not create
`.bunny-done`.

## Root cause to fix

The level paintings are portrait (1.png 1152x2048, 2.jpg 736x1308, 3.jpg 794x993) and
they contain characters and text. They are NOT to be shown whole or tiled.

## New rule for the far layer

1. **Source priority:** if `assets/bg/l{N}.png` exists, use it whole (it will be a
   16:9 landscape painting made for this). Otherwise use the crop below. Load both
   paths through the existing manifest so a missing file is not a 404.
2. **Fallback crops** (fractions of source height, full width, then centre-cropped to
   16:9):
   - L1 `1.png`: y from 0.28 to 0.60 (the arch, statues and steps; no pool).
   - L2 `2.jpg`: y from 0.00 to 0.32 (the gothic arch and windows; NOT the goblin face).
   - L3: do not use `3.jpg` (it has the demon and the words "PATIENT IS THE NIGHT").
     Procedural instead: vertical gradient `#c0601f` (top) → `#5a2a10` (middle) →
     `#120806` (bottom), plus 6-10 black bare-tree silhouettes with thin crooked
     branches, drawn once to a canvas.
3. **Scaling:** draw the crop ONCE into a canvas of exactly 600x338 with
   `imageSmoothingEnabled = true` and `imageSmoothingQuality = 'high'` (this is a
   DOWNscale; smoothing off is what produced the noise). Use that canvas as the texture
   with NearestFilter. The quad must map 1 texel = 1 buffer pixel. No `RepeatWrapping`,
   no `repeat.x`, no tiling of any kind, `ClampToEdgeWrapping`.
4. **Parallax:** the 600 px image scrolls across the whole level width:
   `offset = cameraProgress * (600 - 480)`, where `cameraProgress` is 0 at level start
   and 1 at level end. Vertically fixed.
5. **Colour:** only a brightness multiply (material colour ~0x70 for L1/L2, 0x90 for the
   L3 procedural). No hue tint, no desaturation above 0.2, no sky gradient drawn on top
   of the painting. The sky gradient only fills what the painting does not cover (should
   be nothing).
6. **Mid layer:** trunks must be pure black at 30-40% opacity. Right now they render as
   grey/blue columns: fix the colour, not the opacity.

## Acceptance

Screenshots to `.scratch/stage1b/`: `l1.png`, `l2.png`, `l3.png` via `?level=N`.

1. The backdrop is recognisable at a glance: L1 shows the stone arch and statues,
   L2 the gothic arch, L3 orange sky with black trees.
2. No visible tile seam, no block bigger than 1 buffer pixel (2x2 screen px at 960).
3. Mean hue of the top 60% of each screenshot (compute it with PIL): L1 between 80° and
   160°, L2 between 240° and 300°, L3 between 10° and 40°. Print the three numbers.
4. Kael and the platforms are still clearly readable over it.
5. Zero console errors.

Report the 5 checks with pass/fail and the three hue numbers. Commit
`Stage 1b: far backdrop crops, no tiling`.
