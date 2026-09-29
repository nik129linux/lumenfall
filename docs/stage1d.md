# Stage 1d — Platforms you can actually stand on + background readability

Nico played it: "platforms don't support the player, bg wrong". Measured cause below.
Scope: `js/core/config.js` (jump), `js/game/level.js` (layouts), `js/render/parallax.js`,
camera clamp. Commit and stop. Never delete/move/overwrite files you did not create;
nothing under `assets/` may change.

## 1. Platforms are out of reach (measured)

- Jump apex = JUMP_VEL² / (2·GRAVITY) = 250² / 1440 ≈ 43 px. Released early it is ~26 px.
- Floor top is y=32. `plat(lv, x, ty, w)` puts the top at (ty+1)·8, so ty=8 → 40 px
  above floor, ty=9 → 48, ty=11 → 64, ty=12 → 72. Almost every platform in L1 is higher
  than the apex, so the player jumps, touches nothing, and falls: it reads as "the
  platform doesn't hold me".

Fix:
- `JUMP_VEL` = 305 (apex ≈ 64 px = 8 tiles). Keep GRAVITY 720 and the variable-jump cut.
- Layout rule for ALL levels: every platform top must be at most **48 px (6 tiles)**
  above a surface you can stand on and reach, with a horizontal gap of at most **7 tiles**.
  Relayout L1, L2, L3 to follow it. Keep the L2 holes that are meant to be crossed only
  after rotation (they must be wider than 12 tiles and must be the ONLY exception).
- Floating `block()` solids that do not touch the ground and are not a reachable step:
  remove them or turn them into platforms. The black square hanging mid-air in L1 must go.

## 2. Automated proof (required, not optional)

Write `tools/reach.mjs` (Playwright, port 8765). For each level `?level=N`:
1. **Support test:** for every distinct platform run, teleport the player 20 px above
   its middle with vy=0, wait 1 s, assert `onGround === true` and
   `body.y === platformTop`. Print one line per platform: `L1 plat@x=98 ty=12 OK`.
2. **Reachability test:** BFS over standable surfaces from the spawn, where B is reachable
   from A if B.top - A.top ≤ 48 and the horizontal gap ≤ 7 tiles (and any drop down is
   allowed). Every platform, every shard and the boss arena must be reachable
   (except L2 rotation gaps: mark those explicitly). Print unreachable ones and exit 1.
3. **Real jump test:** from spawn, hold Right and press Jump every 0.5 s for 6 s; log
   the max body.y reached. It must exceed floor + 55.

All three must pass on all 3 levels. Paste the output in your report.

## 3. Background readability

- Remove the green fog / wash that sits over the painting in L1 (the `fog` colour layer
  or additive haze). The painting should be clean and darker than the playfield, not
  washed out.
- Fit the painting to the view HEIGHT (the whole painting visible top to bottom; the
  arch in L1 must not be cut at the top), still 1 texel = 1 buffer pixel after the
  one-time downscale, parallax 0.1 horizontally, no tiling.
- Over the bottom 40% of the painting, draw a vertical gradient to ~85% black, so the
  painted pool, steps and statue bases read as distant background and NOT as ground
  the player could walk on. Our black floor + coloured lip is the only thing that
  should look walkable.
- Camera: clamp so the view never shows past the level's left/right edge (there is a
  void at the start of L1).

## Acceptance

Screenshots to `.scratch/stage1d/`: `l1.png`, `l2.png`, `l3.png` and
`l1-on-platform.png` (Kael standing on an elevated platform after a real jump, not a
teleport). Zero console errors. `tools/reach.mjs` passes on all levels.
Commit `Stage 1d: reachable platforms, reach test, clean backdrop`.
