# Stage 4 — Level 2 boss: Ul Burjo, the sorcerer

Same contract as the statue boss in `js/game/boss/statue.js` (read it first: it is the
reference, stage 3b). Every Ul Burjo attack becomes windup -> active -> recover with a
blinking marker (`this.fx.telegraph(x, bottomY, w, h, dur)`, `this.fx.clearTelegraphs()`
already exist in `js/game/fx.js`).

Done when `node tools/gate4.mjs` prints GATE PASS (it plays `?level=2&boss=1`).

## Files you may edit
`js/game/boss/ulburjo.js`. In `js/main.js` only if the boss needs a hook (keep it to a few lines).
Do not change `js/game/boss/statue.js`, `fx.js` or the level layout.

## The contract the gate reads (names exact)
`this.atk` = null or `{ name, stage: 'windup'|'active'|'recover', t, dur }`;
`this.atkLog` = array, one `{ name, stage, dur, phase }` pushed at the START of every stage.
On `enterPhase` and `onDefeated`: `this.atk = null; this.fx.clearTelegraphs();`.

## Attacks: [windup, active, recover] seconds
Phase 1 (names exactly): 
- `volley`  [0.70, 0.15, 0.90]: existing `_volley` fires in the ACTIVE stage. Marker: a strip in front, w 60 h 6.
- `sweep`   [0.60, 0.14, 0.80]: existing `_sweep`, only when the player is within 50 px; damage decided once at the start of active. Marker: front, w 30 h 8.
- `blink`   [0.50, 0.10, 0.70]: teleport. At the windup start pick the destination x = the player's x +/- 60 (opposite to the side the boss is on); marker there (w 20 h 30). At the start of ACTIVE move the boss to that x. Harmless.
Phase 2 (hp <= 55%, the base class does the switch; set `phases: 2`): windups x0.8, plus
- `rotate`  [1.00, 0.10, 1.20]: marker across the arena floor (w 220 h 6, purple 0x9b5cf0). ACTIVE calls the existing `_requestRotate()`. The 1.00 s windup is NOT scaled by 0.8 (it must stay >= 0.9). Use it at most once every 6 s, only in phase 2.
Between attacks pause 0.35 s. Damage only in ACTIVE, never during windup or recover.
Keep the existing disguise drop (`swapTo`) in phase 2.
