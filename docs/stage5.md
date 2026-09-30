# Stage 5 — Level 3 boss: The Patient One (final boss)

Same contract as the statue boss in `js/game/boss/statue.js` and Ul Burjo after stage 4
(read them first). Every attack becomes windup -> active -> recover with a marker
(`this.fx.telegraph(x, bottomY, w, h, dur)`).

Done when `node tools/gate5.mjs` prints GATE PASS (it plays `?level=3&boss=1`).

## Files you may edit
`js/game/boss/patientone.js`. In `js/main.js` only a few-line hook if needed.

## The contract the gate reads (names exact)
`this.atk` = null or `{ name, stage: 'windup'|'active'|'recover', t, dur }`;
`this.atkLog` = array, one `{ name, stage, dur, phase }` pushed at the START of every stage.
On `enterPhase` and `onDefeated`: `this.atk = null; this.fx.clearTelegraphs();`.

## Attacks: [windup, active, recover] seconds
He barely moves: the darkness does the work. Phase 1 (names exactly):
- `lantern` [1.00, 0.15, 1.00]: existing `_strikeLight`. At the windup start lock the target x = where the player's LIGHT is (`player.lightX`); marker column there (w 16 h 60). Damage at ACTIVE if the player's body overlaps it.
- `ring`    [0.90, 0.20, 1.00]: existing `_ring`, a shockwave along the ground on both sides of him. Marker: two strips (w 90 h 14) either side of `this.cx`. Jumping over it avoids the hit.
- `cutoff`  [0.80, 0.15, 0.90]: predictive. At the windup start compute `px = player.cx + player.body.vx * 0.6` (where Kael will be); marker there (w 20 h 40). At ACTIVE the boss's hit rect appears at that x (damage if overlapping).
Phase 2 (hp <= 55%, set `phases: 2`): windups x0.8 (except `surge`), plus
- `surge`   [1.00, 0.10, 1.20]: darkness closes in. Marker across the arena floor (w 220 h 6, red). At ACTIVE shrink the player's light radius to 60% for 3 s (use the existing light radius in `js/render/pipeline.js`, restore it afterwards; if there is no clean hook add one method there and say so in your reply).
Between attacks pause 0.35 s. Damage only in ACTIVE.
