# Stage 2e — Real minion sprites

Nico made sheets for the three common enemies. They replace the procedural silhouettes
from stage 1. Same rules: `assets/` read-only (the three sheets are committed in
`4705414`), only what is written here. Commit and stop.

## Sources

| enemy | file | size | background |
|---|---|---|---|
| wisp | `assets/wisp.jpeg` | 1264x842 | magenta #FF00FF |
| crawler | `assets/crawler.png` | 1536x1024 | **dark, NOT magenta**: near-black with a soft brown vignette |
| spitter | `assets/spitter.jpeg` | 2528x1684 | magenta #FF00FF |

All face RIGHT natively (`nativeFacing: 1`).

## Frames (left→right, top→bottom)

- **wisp** (3 rows: 4, 3, 4): `float` = row 1 frames 1-4; `dash` = row 2 frames 1-3
  (keep the smoke trail and the green spark, they are part of the frame);
  `hurt` = row 3 frame 1; `dead` = row 3 frames 2-4.
- **crawler** (3 rows: 4, 3, 4): `walk` = row 1 frames 1-4; `lunge` = row 2 frames 1-3;
  `hurt` = row 3 frame 1; `dead` = row 3 frames 2-4.
- **spitter** (3 rows: 6, 4 + a loose fireball, 4): `idle` = row 1 frames 1-2;
  `walk` = row 1 frames 3-6; `cast` = row 2 frames 1-3; `hurt` = row 2 frame 4 (the
  recoiling one on the right); `dead` = row 3 frames 1-4.
  **The green fireball floating between row 2 frames 3 and 4 is NOT part of a frame**:
  cut it out separately as the spitter's projectile sprite (`spitterShot`) and use it for
  the existing spitter projectile, with a 2-frame flicker (scale 1.0 / 0.9).

## Cutting

- Magenta sheets: same pipeline as stage 1 (chroma key, 1 px alpha erosion, kill pink
  fringe).
- **crawler**: do NOT use a colour-distance key against a single colour. Build the mask
  per frame box: flood-fill from the box border with a tolerance on luminance
  (background luma < ~28 and low saturation), then keep the largest connected component
  plus anything touching it. The creature is dark brown with green eyes, so check the
  contact sheet carefully: the legs and back spikes must survive, the vignette must not.
  Drop the soft green glow around the mouth in `lunge` if it keys as a halo.
- Group frames by rows using horizontal gaps; frames within a row by vertical gaps.
- Contact sheet on mid-grey to `.scratch/stage2e/minions.png`; look at it before
  continuing.

## Size in game (480x270 buffer)

wisp 22 px tall, crawler 20 px tall (≈36 px long), spitter 40 px tall. Hitboxes follow the
new sizes; do not change HP, speed, damage or AI.

## Wiring

- `js/main.js`: minions use these atlases; delete the procedural silhouette drawing
  (`js/render/minions.js` or equivalent) only if nothing else uses it.
- Animation mapping: wisp `float` while patrolling, `dash` when it charges; crawler `walk`
  while moving, `lunge` on attack; spitter `idle`/`walk`, `cast` when shooting (spawn the
  projectile on cast frame 3). All: `hurt` 0.15 s on hit, `dead` once then remove.
- Facing rule from stage 1 applies (face movement direction, face player when attacking,
  max one flip per 0.15 s).
- Keep the per-level accent glow on the eyes if it exists; do not tint the sprites.

## Acceptance

`.scratch/stage2e/`: `minions.png` (contact sheet), `l1-wisp.png`, `l1-crawler.png`,
`l2-spitter-cast.png` (projectile visible), `death.png` (a minion mid-death animation).
Read them yourself: no magenta fringe, no dark rectangle around the crawler, all three
face the right way. `tools/reach.mjs` still passes, zero console errors.
Commit `Stage 2e: minion sprites from Nico's sheets`.
