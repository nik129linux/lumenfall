# Stage 2c — L2 columns, falling into the void kills, rotation hint

Nico played up to L2 and got stuck. Same rules: only what is written here, `assets/`
read-only, never delete files you did not create. Commit and stop.

## 1. L2 columns are too tall (measured)

`level.js` L2 has solid columns `block(lv, 30, 4, 3, 10)`, `block(lv, 62, 4, 3, 9)`,
`block(lv, 82, 5, 4, 11)`, `block(lv, 122, 4, 3, 10)`, `block(lv, 146, 5, 3, 10)`: 72–88 px
above the floor. The jump apex is 64 px. `reach.mjs` passes only because a chain of
near-perfect jumps over nearby platforms exists; a real player does not find it.

Fix, for ALL three levels:
- New comfort rule: any climb the player MUST make to progress rises at most **40 px**
  (5 tiles) from the surface they stand on. 48 px stays the hard limit for optional
  platforms (shards).
- Every column/wall taller than 40 px must have a step (platform or lower block) right in
  front of it, on the side the player arrives from, that satisfies the 40 px rule.
- Update `tools/reach.mjs`: the required path (spawn → boss arena) must be solvable with
  rises ≤ 40 px; optional surfaces keep ≤ 48 px. Also model walls: a surface is only
  reachable horizontally if no solid tile taller than the jump blocks the straight path
  between them. Print the required path as a list of surfaces.
- L2 rotation holes stay the exception, see §3.

## 2. Falling into the void kills

Today the pits have a solid bottom at y=0 and Kael just stands in them.
- When the player's `body.top` goes below `FLOOR_Y - 8` inside a pit (i.e. fully below
  the floor line), trigger death immediately: short red flash, 0.4 s fall-out fade, then
  the existing death/respawn flow (respawn at the last checkpoint, same penalties as any
  death).
- Make pits bottomless visually: nothing is drawn below the floor line inside a hole
  (black), and the pit's solid bottom is removed from the grid (`tileAt` below row 0
  still returns SOLID for the physics edge, but the player dies before reaching it).
- Enemies that fall in are removed.
- L2 rotation: after the room rotates, "down" changes. Death applies to falling out of the
  level bounds in the current down direction. Test both a normal pit (L1) and one
  post-rotation case in L2.

## 3. Rotation must be discoverable

The L2 holes (wider than 12 tiles) are meant to be crossed by rotating the room. The
player is never told.
- On entering L2, and again the first time the player stands within 6 tiles of a rotation
  hole, show a hint toast for 4 s: ES "Pulsa R para girar el mundo" / EN "Press R to turn
  the world" (use the real key binding from `input.js`; if it is not R, use the real one,
  and show it in the controls screen too).
- A small glowing rune on the ground 3 tiles before each rotation hole, in the L2 accent
  colour, pulsing.

## Acceptance

- `tools/reach.mjs` passes with the new rules on all 3 levels; paste the printed
  required paths.
- `.scratch/stage2c/`: `l2-column.png` (Kael on the step in front of the first column),
  `pit-death.png` (the flash/fade frame after falling into an L1 pit), `l2-hint.png`
  (hint toast + rune visible).
- A Playwright check that drops Kael into an L1 pit and asserts the death/respawn fires
  within 1.5 s.
- Zero console errors. Commit `Stage 2c: climbable L2, pit death, rotation hint`.
