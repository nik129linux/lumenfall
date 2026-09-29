# Stage 1 — decisions

Scope was `docs/stage1.md` only. Cutscenes, level layouts, AI, boss behaviour,
the L2 rotation and L3 darkness were left alone.

## Deviation from the brief, and why

**Far-layer brightness.** The brief says darken the level painting to ~55%. At
that value the emerald pool in `1.png` is brighter than the near-black platforms
the brief also asks for, and the backdrop wins — the playfield disappears into
it. Shipped at `0x50` material brightness with desaturation at 0.45, and the sky
gradient darkened hard, because the sky used to *be* the backdrop and is now only
a margin filler. It was still the brightest thing on screen.

Brightness is applied through `MeshBasicMaterial.color`, not baked into the
canvas. The post pass re-encodes linear → sRGB and that lift is not linear, so a
factor applied to canvas pixels comes out roughly squared on screen. Baking it in
made the value impossible to reason about; a material colour is a live tunable.

**Portrait paintings into a landscape view.** `1.png` is 1152×2048 and the view is
480×270. A literal cover-fit scales to the view's width and shows a random
vertical slice — in L1 that landed on a bright emerald pillar filling the middle of
the screen. The painting is instead scaled so its full height covers the view and
tiled across at its natural width, which keeps the whole composition legible. The
tile seams read as tree trunks, which suits the scene.

## Bugs the acceptance checks found

- **`_startBoss` never passed `y`.** The boss body had `y === undefined`, which
  became `NaN` after one physics step, so the Marble Mummy was never drawn. The
  fight ran with a health bar and an invisible opponent. This affected normal
  play, not just the debug entry.
- **Focus before `show()`.** `focus()` on a `display: none` element is a no-op, so
  the menu opened with nothing focused and Enter did nothing. Moved after
  `ui.show('menu')`.
- **`?level=`/`?boss=` needed to route through MENU.** The state machine refuses
  `BOOT → PLAY`, so the debug skip silently left the game on the title screen.
- **Async parallax race.** Loading two levels back to back interleaved their
  `await`s and left six layers instead of three. Added a generation counter.
- **The backdrop painted over the playfield.** Level tiles were opaque materials,
  and Three renders the opaque pass before the transparent one, so the transparent
  parallax drew *on top* of the geometry. Tiles are now `transparent: true` and
  the whole scene uses explicit `renderOrder` instead of relying on z tie-breaks.
- **`solids + plats` is string concatenation.** `[1,2] + [3,4]` is `"1,23,4"`, not
  `[1,2,3,4]`. The platform list was reaching `_buildLips` as the string
  `"0,0,1,1,..."`, so no platform ever got an accent edge. Now `.concat`.
- **Platforms were never in the lip pass.** `_buildLips` was handed `solids` only,
  and platforms are built as `PLATFORM` tiles, so every floating platform rendered
  as a plain black bar.

## Atlas notes

`statue.jpeg` needed three things the other four sheets did not.

- **Flood fill from the crop border, not a colour threshold.** Its figures sit
  only ~50 luminance units above the board, so any global threshold either keeps
  the background or eats the sprite. That is why it used to come out as white
  outlines.
- **The reference colour is the median of the border ring**, not the top-left
  corner. The `dead` crop's corner is `(6,4,7)` — near black, a section divider —
  and keying against it made the whole crop read as one solid silhouette.
- **The section is flooded once and partitioned by nearest label centre.** The
  board draws the poses *overlapping*: Caminar and Correr have robes that run into
  their neighbours, so they merge into one blob and no per-box border can split
  them. Boundaries come from the stone bases at x = 83, 195, 310, 424 | 566, 674,
  787, 897 | 1143, 1263, 1379, 1481. There is a 13th figure at x≈1009 with no
  label; it is not one of the labelled poses and is skipped.

Some walk/run frames still carry a sliver of the neighbouring figure, because the
source robes genuinely overlap. The dominant figure is correct in every frame.

## Verification

`python3 -m http.server 8765` then `node tools/stage1.mjs` — 13 checks, 0 console
errors, screenshots in `.scratch/stage1/`.
