# Stage 3b — The statue boss warns before every attack

Today the Marble Mummy (`js/game/boss/statue.js`) damages the player in the SAME frame
it decides to attack: no warning, no recovery. Make every attack a 3-stage sequence
the player can read and dodge:

```
windup (boss planted, blinking red marker on the ground)  ->  active (damage, one check)  ->  recover (boss stands still, safe to hit)
```

You are done when `node tools/gate3b.mjs` prints `GATE PASS`. Run it yourself, read the
FAIL lines, fix, repeat. Do NOT edit the gate. The game is already served on
http://localhost:8765 : do not start another server. Do not run `git commit`.

## Files you may edit (nothing else)
- `js/game/fx.js`  (add the telegraph marker)
- `js/game/boss/statue.js`  (the attack state machine)
- `js/main.js`  (ONE line: call `this.fx.clearTelegraphs()` at the start of `_loadLevel`)

## 1. fx.js: `telegraph`

Add to class `FX`: `this.telegraphs = [];` in the constructor, and these methods.
`x` is the CENTRE of the marker, `y` its BOTTOM edge, in level pixels.

```js
telegraph(x, y, w, h, dur, color = 0xff3b3b) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
  mesh.scale.set(w, h, 1);
  mesh.position.set(x, y + h / 2, 0);
  mesh.renderOrder = 5;
  this.group.add(mesh);
  const t = { mesh, life: dur, age: 0 };
  this.telegraphs.push(t);
  return t;
}

clearTelegraphs() {
  for (const t of this.telegraphs) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose(); }
  this.telegraphs = [];
}
```
In the existing `update(dt)` add at the top (before the particle loop):
```js
for (const t of this.telegraphs) {
  t.age += dt; t.life -= dt;
  t.mesh.visible = Math.floor(t.age / 0.07) % 2 === 0;   // blink
}
this.telegraphs = this.telegraphs.filter((t) => {
  if (t.life > 0) return true;
  this.group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose();
  return false;
});
```

## 2. statue.js: the attack state machine

Constants (seconds):
```js
const T = { swing: [0.65, 0.14, 0.80], slam: [0.85, 0.14, 1.00], roots: [0.90, 0.20, 0.90] }; // [windup, active, recover]
const P2_WINDUP = 0.8;      // phase 2 multiplies every windup by this
const AFTER_ATTACK = 0.35;  // pause after recover before the next decision
const ROOTS_COOLDOWN = 4.0;
```
Constructor: change `phases: 1` to `phases: 2` (phase 2 starts at 55% hp, the base class already does this). Add fields
`this.atk = null; this.atkLog = []; this.pause = 0; this.rootsCd = 2;`

`this.atk` is `null` or `{ name, stage, t, dur, tx }` where `name` is `'swing'|'slam'|'roots'`,
`stage` is `'windup'|'active'|'recover'`, `t` seconds elapsed in the stage, `dur` the stage length, `tx` the player's x when the windup began.
`this.atkLog` gets one entry `{ name, stage, dur, phase }` pushed at the START of every stage (`phase` = `this.phase`). The gate reads both fields: keep the names exactly.

Replace the body of `update` after `const action = this.think(...)`:
```js
const dx = player.cx - this.cx;
if (!this.atk || this.atk.stage === 'windup') this.facing = dx >= 0 ? 1 : -1;
this.pause = Math.max(0, this.pause - dt);
this.rootsCd = Math.max(0, this.rootsCd - dt);

if (this.state === 'phase') this.body.vx = 0;
else if (this.atk) this._runAttack(dt, player);
else if (this.pause <= 0) this._decide(action, player, dx);
else this.body.vx *= 0.8;
```
`_decide(action, player, dx)`:
- if `this.phase >= 2 && this.rootsCd <= 0 && Math.abs(dx) > 50` -> `this._begin('roots', player)`
- else if `action === 'swing' || action === 'slam'` -> `this._begin(action, player)`
- else if `action === 'chase'` -> `this.body.vx = Math.sign(dx) * (26 + this.phase * 4)`
- else `this.body.vx *= 0.9`

`_begin(name, player)`: set `this.atk = { name, stage: 'windup', t: 0, dur: T[name][0] * (this.phase >= 2 ? P2_WINDUP : 1), tx: player.cx }`, `this.body.vx = 0`, push the log entry, then place the markers (all use `this.body.bottom` as y and `this.atk.dur` as duration):
- swing: one marker, centre `this.cx + this.facing * 28`, w 30, h 8
- slam: one marker, centre `this.cx`, w 80, h 14
- roots: three markers, centres `tx - 14`, `tx`, `tx + 14`, each w 12, h 40

`_runAttack(dt, player)`: `a.t += dt; this.body.vx = 0;` (swing may lunge: while active `this.body.vx = this.facing * 60`). When `a.t >= a.dur`:
- windup -> `stage = 'active'`, `t = 0`, `dur = T[name][1]`, push log entry, call `this._strike(a, player)` ONCE (damage is decided here, not every frame)
- active -> `stage = 'recover'`, `t = 0`, `dur = T[name][2]`, push log entry
- recover -> `this.atk = null; this.pause = AFTER_ATTACK; if (name === 'roots') this.rootsCd = ROOTS_COOLDOWN;`

`_strike(a, player)`: build the hit rectangles and hurt the player if `!player.dead && !player.isInvulnerable` and the player's body overlaps one of them (overlap test = the same one `_swing` uses today):
- swing: `this.hurtRect()`; keep the existing slash effect
- slam: `{ left: cx-40, right: cx+40, bottom: body.bottom, top: body.bottom+14 }`; keep the burst/dust effect
- roots: for each `x` of `[a.tx-14, a.tx, a.tx+14]` -> `{ left: x-6, right: x+6, bottom: body.bottom, top: body.bottom+40 }`; play `this.fx.burst` at each x
Delete the old `_swing`, `_slam` and `_act`.

Cleanup (both must clear the marker and the attack): override `enterPhase(n)` (call `super.enterPhase(n)` first) and `onDefeated()` (call `super.onDefeated()` first) with `this.atk = null; this.fx.clearTelegraphs();`.

Animation in `_animate`: while `this.atk` in windup play `'sweep'` at `speed: 3`; in active `speed: 12`; in recover `'idle'`; when `state === 'phase'` keep the existing `'roots'` clip.

## What the gate measures (so you can predict it)
- at least 3 complete attacks logged in phase 1, stages always in the order windup, active, recover
- every windup lasts at least 0.5 s (phase 1)
- the player never loses health during a windup or recover unless touching the boss body
- a telegraph marker exists during (almost) every windup frame
- in phase 2 a `roots` attack appears with phase 2 and a windup of at least 0.7 s
- after the boss dies `atk === null` and `fx.telegraphs.length === 0`
- no console errors
