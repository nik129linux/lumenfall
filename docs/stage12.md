# Stage 12 — Level 2: replace the 90-degree room rotation with a WORLD SHIFT

Nico played it: the rotation is unreadable (the black geometry sweeps over the whole screen,
Kael ends up half off screen clinging to a wall, the painted background stays upright).
Replace it with a world shift: pressing `E` in level 2 toggles between two versions of the SAME map.
Nothing moves or rotates; tiles appear and disappear and the palette changes.

Done when ALL of these print GATE PASS / PASS: `node tools/gate12.mjs`, `node tools/gate4.mjs`, `node tools/reach.mjs`.
Run them, read the FAIL lines, fix, repeat. Do not edit any gate or `tools/reach.mjs`.
The game is served on http://localhost:8765 (no new server). Do not run `git commit`.

## Files you may edit
`js/game/level.js`, `js/game/physics.js`, `js/game/player.js`, `js/main.js`, `js/game/boss/ulburjo.js`, `js/ui/strings.js`, `js/render/*.js` (only for the tint), `README.md`. Nothing else.

## 1. Data model (names exact)
- `levelData.layer` = a `Uint8Array` with the same length as `levelData.grid`. Value 0 = the tile exists in BOTH worlds, 1 = only in world A, 2 = only in world B.
- `level.world` = 0 (world A) or 1 (world B), and `levelData.world` mirrors it (physics reads `levelData`). Level 2 starts in world A. Levels 1 and 3 have `layer` all zeros and never shift.
- `physics.tileAt(levelData, tx, ty)`: after the existing bounds checks, if `grid` is non-zero and `layer` is non-zero and `layer !== levelData.world + 1`, return 0. Every other function that reads the grid for collision (`tilesInRect`, the line-of-sight march in `js/game/ai.js` reads `grid` directly, leave it) must go through `tileAt`.
- `level.shiftCount` (number of shifts so far), `level.shiftCd` (seconds of cooldown left), `level.canShift` (true only for level 2).
- `level.shiftWorld(opts = {})` returns `true` if the world changed, else `false`:
  - normal call (the player pressing E): refuse (false) when `!canShift`, or `shiftCd > 0`, or the player's body would overlap a solid tile of the destination world. On success: `world ^= 1`, `shiftCd = 0.5`, `shiftCount++`.
  - `opts.force === true` (used by the boss): ignore the cooldown, never refuse; if the player's body overlaps solid in the new world, move the player UP, one tile at a time, until it fits (the arena floor is common to both worlds so this always terminates).
  - Remove the old rotation: `beginRotate`, `updateRotation`, `isRotating`, `rot*` fields, `group.rotation.z` animation, the pinned-position code in `main.js`, `rotQ` use in `player.js`/`physics.js` where it only served the rotation. Nothing may call `beginRotate` any more. `level.group.rotation.z` stays 0.
  - `shiftCd` counts down in `level.update(dt)` (or wherever `updateRotation` was ticked).

## 2. Rendering
- World A tiles and world B tiles must look different: layer-1 tiles body `0x1a0f22`, lip `0xa86cf0` (purple); layer-2 tiles body `0x0f2210`, lip `0x9be34a` (toxic green); layer-0 tiles keep the current level colours. Build one instanced mesh per layer group (0, 1, 2) and toggle `.visible` for the two shifting groups when the world changes (do not rebuild geometry).
- When the world changes: the far backdrop colour lerps 0.25 s to a green tint in world B (`0xa8d8a0`-ish brightness multiply) and back to the normal tint in world A; a 0.2 s soft white-green flash (`pipeline.setHurt`-like overlay or a short `cam.shake = 2`); `audio.sfxRotate()` plays.
- Keep the rune on the ground 3 tiles before each big hole; recolour it toxic green and keep its pulse.

## 3. Input and text
- `E` calls `level.shiftWorld()`. If it returns false because it was refused (not for cooldown), `audio.sfxHurt()` low-key buzz and a 1.2 s toast. Reuse the existing keys/strings where they exist.
- Spanish: `Pulsa E para cambiar de mundo`; English: `Press E to shift worlds`. Replace every string that says rotate/turn the world (`rotateWorld`, `rotateHint`, the controls screen line, the boss/cutscene text if any) in BOTH languages. No Spanish string may contain `girar`, no English string `turn the world`/`rotate`. Keep `node tools/gatei18n.mjs` passing.
- README: replace the rotation wording with the world shift (Controls table row, the Levels table row for level 2 and the Ul Burjo description, the `gate4` line in Tests). The README must still contain the word `Shift`.

## 4. Level 2 layout (`js/game/level.js`, the L2 builder)
Keep the existing ground holes (`ground(lv, [[40,14],[68,16],[102,15]])`) and all current platforms, then add layers:
- **Bridges:** for each hole `[hx, hw]`, fill the ground row (`ty = 3`, the top ground row) across `hx .. hx+hw-1` with SOLID tiles in layer 2 only. So: world A = a deadly pit, world B = a bridge you can walk over.
- **Pits stay deadly:** standing on a bridge and shifting back to A drops you into the pit (that is the tension). The shift is refused only when the body would overlap a solid.
- **Columns:** every tall `block(...)` column that is currently a wall becomes layer 1 (exists only in world A). In world B the way is clear; in world A the existing steps in front of them keep it climbable (do not remove the steps).
- Add 4 small platforms in layer 2 only and 4 in layer 1 only near the shards, each reachable by the normal jump rules (rise <= 40 px from a surface, gap <= 7 tiles) in its own world.
- **Boss arena** (the last 40 tiles): the floor row 3 stays layer 0 (common, never a pit). Add at least 3 platforms (8+ PLATFORM tiles) in layer 1 and at least 3 (8+ tiles) in layer 2, spread across the arena, so a forced shift changes the footing without ever killing.
- `tools/reach.mjs` analyses world A: keep the required path solvable with rises <= 40 px; the holes are the documented exception.

## 5. Ul Burjo (`js/game/boss/ulburjo.js`)
- Rename the phase-2 attack `rotate` to `shift` everywhere in the file (`T`, the weights table, `atkLog`, the cooldown field becomes `shiftCooldown`, 6 s). Timing unchanged: `[1.00, 0.10, 1.20]`, windup NOT scaled by the phase-2 factor, marker across the arena floor w 220 h 6, purple `0x9b5cf0`.
- ACTIVE calls `this.level.shiftWorld({ force: true })`. Delete `_requestRotate`, `turning`, `rotateRequested`, the `'rotate'` state, and `this.boss?.onRotationDone?.()` in `main.js`.
- Remove the leftover test hack `window.CFG = {...}` at the bottom of `js/main.js`: it is test scaffolding that must not ship.
