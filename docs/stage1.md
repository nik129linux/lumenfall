# Stage 1 — Clean look, correct sprites, facing flip

Scope is ONLY this file. Do not touch cutscenes, level layouts, AI, bosses' behaviour,
L2 rotation or L3 darkness. Those are later stages. When every acceptance check at the
bottom passes, commit and STOP. Do not create `.bunny-done`.

The character sheets in `assets/*.jpeg` are good art. Everything ugly today comes from
our code degrading them. The goal of this stage: on screen, the sprites must look like
the sheets, at pixel-crisp scale, with no noise on top.

## 1. Remove the post-processing that destroys the art

File `js/render/pipeline.js` and `js/render/materials.js`.

- Film grain: set `grainAmount` to `0` everywhere (line ~120 and the per-level override
  at line ~169). Delete the per-level override.
- Scanlines: `scanline` to `0`.
- Chromatic aberration (if any): remove.
- Vignette: keep, but max `0.35` on L1/L2 and `0.55` on L3.
- `materials.js` posterize + bayer dither (lines ~80-95): **remove from sprite materials
  entirely.** Sprites must render their atlas texels unchanged (no posterize, no dither,
  no saturation trim, no palette snap). This is why Kael renders brown.
- Keep the 480x270 low-res buffer and NEAREST upscale. That alone gives the pixel look.
- Every texture (atlases, backgrounds) must use `NearestFilter` for mag and min,
  `generateMipmaps = false`, and `colorSpace = SRGBColorSpace`.

## 2. Fix the facing flip (confirmed bug)

`js/render/sprite.js`: `setFacing()` negates `mesh.scale.x` (line 63) AND `applyFrame()`
swaps the U coordinates when `facing < 0` (lines 77-78). Two flips cancel, so characters
never turn around. Keep ONE mechanism: delete the U swap in `applyFrame()` (always
`l = u0`, `r = u1`) and keep the scale flip. Make sure nothing else swaps UVs.
Same check for the ghost/afterimage `spawn()` at lines ~129-140: it sets a negative scale
AND swaps UVs. Remove the UV swap there too.

Rules for who faces where:
- Kael faces the direction of the last non-zero horizontal input. Turning must be
  instant (same frame as the input), including mid-air and during run.
- Enemies and bosses face the player when attacking/idle, and their movement
  direction when patrolling. Never flip more than once per 0.15 s (prevents jitter
  when the player stands right on top of them).
- Source sheets: Kael, goodwitch face RIGHT. demon, badwitch, statue: check each sheet
  and store the native facing per character in the atlas manifest
  (`"nativeFacing": 1 | -1`), then flip relative to that. Do not assume.

## 3. Rebuild the atlases correctly

`tools/build-atlas.py`. Current output is broken: `statue` comes out as white outlines
only, and `kael` is too small in-game.

- **statue.jpeg is NOT on magenta.** Its background is a dark green-grey (~`#1a2624`).
  Key it with a flood fill from the border of each hardcoded crop box (tolerance on RGB
  distance from the sampled corner colour ~28), NOT with a global colour distance or
  a luminance gate. Keep all the grey stone and the dark red. The crop boxes must exclude
  the text labels ("Idle 1", "Caminar 1"...) — cut above the label baseline.
  Use only: Idle 1-4, Caminar 1-4, Correr 1-4 (section 1), Ataque Barrido and
  Invocación de Raíces (section 4), and the 3 damage-state figures (bottom right) as a
  `hurt`/`dead` clip. Ignore sections 2 and 3.
- **Magenta sheets** (kael, goodwitch, badwitch, demon): key `#FF00FF` by chroma distance,
  then erode 1px of alpha and remove any remaining pixel whose hue is within 25° of
  magenta with saturation > 0.5 (kills the pink fringe). Motion smears and sword trails
  are part of the frame; keep them.
- Downscale with NEAREST only, one integer-ish factor per character. No bilinear,
  no LANCZOS: that is what smears pixel art.
- In-game height targets at the 480x270 buffer: Kael 44 px tall, elder 46, sorcerer 52,
  statue 70, demon 96. Pick the cell size from these, not the other way round.
- Frame order must match the sheet order (left→right, top→bottom). Kael clips:
  idle = row1 frames 1-2, run = row1 frames 3-6, jump = row2 frame 1, fall = row2 frame 2,
  dash = row2 frames 3-4, attack = row3 frames 1-3, hurt = row3 frame 4, dead = row3 frame 5.
- Write a contact sheet to `.scratch/stage1/atlases.png` on a mid-grey background
  (#808080) so both dark and light pixels are visible, and LOOK at it before continuing.

## 4. Common enemies must not reuse boss sprites

`js/main.js:265` maps `wisp → demon`, `crawler → statue`, `spitter → badwitch`. That puts
the final boss on screen in level 1. Delete that mapping. Until minion art exists, draw
common enemies procedurally:

- `wisp`: a 10-12 px dark core with 2 glowing eye pixels in the level accent colour,
  a soft additive glow sprite behind it, bobbing ±3 px.
- `crawler`: a low 20x10 px black silhouette with 4 leg pixels that alternate, 2 eye
  pixels in the accent colour.
- `spitter`: 14x18 px hooded black silhouette, eyes in accent colour.

They are silhouettes on purpose: they must read against the background, not compete with
the painted characters.

## 5. Backgrounds from the level art

`js/render/parallax.js`. Replace the procedural tree-sticks.

- Far layer = the level image, cover-fit to the view, parallax factor 0.1:
  L1 `1.png`, L2 `2.jpg`, L3 `3.jpg`. Darken it to ~55% brightness and slightly
  desaturate (it is a backdrop; the playfield must stay readable).
  `1.png` is 5 MB: at load, downscale it once to 960 px wide in a canvas and use that.
- Mid layer (factor 0.4): black tree-trunk silhouettes, procedural, 30% opacity.
- Near/foreground layer (factor 1.2, in front of the player): sparse black grass and
  branch silhouettes at the bottom edge only, max 15% of screen height.
- Platforms and ground: solid near-black (#0b0f0e on L1, tuned per level) with a 1-2 px
  top edge in the level accent colour (L1 emerald #4fd18b, L2 toxic green #9be34a with
  purple #7a3fa0 body tint, L3 ember #e0772e). No grey rectangles anywhere.

## 6. Menu keyboard

`js/ui/hud.js` / menu: on open, focus "Nueva partida". Up/Down (and W/S) move focus,
Enter/Space activates. Currently Enter does nothing.

## Acceptance (all must pass, then commit and stop)

Use `tools/smoke.mjs` (Playwright, served on port 8765) and save screenshots to
`.scratch/stage1/`:

1. `menu.png` — Enter starts the game without clicking.
2. `l1-right.png` — Kael standing, facing right.
3. `l1-left.png` — after holding Left 0.5 s: Kael visibly facing LEFT. Compare the two
   images and state in your report which way the face/sword points in each.
4. `l1-enemies.png` — a wisp or crawler on screen: it is a silhouette, not a boss sprite.
5. `l1-boss.png`, `l2-start.png`, `l3-start.png` (use whatever debug level skip exists,
   or add `?level=N` and `?boss=1` URL params for this).
6. Zero console errors.
7. **Read each screenshot yourself** and confirm: no grain/noise, Kael's cloak is teal
   and armour silver (not brown), statue is grey stone (not white outlines), the level
   painting is visible behind the playfield.

Report: the list of files changed, the 7 checks with pass/fail, and anything you could
not do. Commit with message `Stage 1: clean render, fixed atlases, facing flip`.
