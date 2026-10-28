# LUMENFALL — decisions log

Decisions made while building, and why. The design itself is in
`2026-09-28-lumenfall-design.md`; this file records the things that turned out
to be different from the plan, plus the judgement calls that were mine to make.

---

## Approved before the build

These came out of the design review and are not re-litigated here.

| # | Decision |
|---|---|
| 1 | `goodwitch.jpeg` and `badwitch.jpeg` are the **same character** — the kind elder and Ul Burjo. The elder's final idle frame has glowing green eyes as a planted tell. |
| 2 | `statue.jpeg` is cropped by hardcoded coordinates, not connected components — the Spanish captions and section rules are foreground to CC. |
| 3 | Frames are **baseline-locked into shared cells**, not per-frame tight crops. |
| 4 | Marble Mummy is 1 phase; Ul Burjo is 2 (phase 2 rotates the arena); The Patient One is 2 and gets most of the AI budget. |
| 5 | Adaptive AI is **capped at the chosen difficulty ceiling** and keeps every fairness cap. |
| 6 | 480×270 low-res buffer, exposed as a single constant (`LOW_RES_W` / `LOW_RES_H` in `js/core/config.js`). |

---

## Deviations from the original plan

### The character refs are reference sheets, not atlases

The plan assumed sprite sheets. They are painted concept sheets — four on
`#FF00FF` (74–80% coverage) and `statue.jpeg` on a dark labelled board. So
`tools/build-atlas.py` exists at all: it chroma-keys, slices, normalises and
packs them into `assets/atlases/`. The output is committed; the tool is a
one-shot.

Two things it had to get right, both of which look right only after you look
at a contact sheet:

- **Row bands are declared, not inferred.** The sheets put rows close enough
  together (sometimes under 90px apart) that any centre-based bucketing drifts
  and mis-orders the clips. A mis-ordered animation is worse than a missing one,
  so each character's rows are explicit `(y0, y1, count)` bands and the N
  largest components per band are taken left to right. Taking the largest is
  also what drops the non-body frames — there is a green projectile sitting among
  the sorcerer's poses, and a "larger than this" rule discards it for free.
- **Figures are anchored by their feet.** Every frame is scaled into a shared
  cell and pasted with its feet on a common baseline. Without this, each frame's
  tight crop sits at a slightly different height and the animation wobbles.

`statue.jpeg` needed a different path again: Section 1 is one wide row of 12
evenly laid out poses, and neighbouring poses touch and merge into single
blobs. The band divides its x range into 12 equal columns instead of detecting
components. The dark key also needed care — the statue's median tone is 82
against a 27 background, so a luminance gate at 54 erased the body and left
only the rim light. The gate is at 33, which still rejects JPEG chroma ringing
(that moves in colour but not in luminance, and it was leaving red speckle on
every sprite).

### The orchestrator lives in `main.js`

The plan had `js/game/state.js` own the state machine and `main.js` be a thin
shell. In practice the interesting transitions are the ones that must **not**
happen — you cannot jump from `menu` straight into `boss`, and a death during a
rotation has to unwind cleanly — and splitting those across two files that have
to stay in sync made them harder to reason about, not easier. `state.js` keeps
the machine and its transition table; the loop and the per-state updates live
together in `main.js`.

### Enemies reuse the cast

There are no enemy sprites. Three enemy types (wisp, crawler, spitter) are
assembled from the existing character atlases — the demon for wisps, the statue
for crawlers, the sorcerer for spitters. This keeps the whole game on one art
pipeline instead of shipping placeholder art, and it is stated plainly in
`_bodySprite` so it reads as a deliberate choice rather than an oversight.

### `assets/bg/` is opt-in through a manifest

The plan said the loader should fall back to procedural art if the files are
missing. Probing for files that do not exist logs a 404 in the console on every
single load, which reads as a broken game. `assets/bg/manifest.json` is committed
and empty; the loader reads it and goes procedural. Drop files in and list them
and they are used, with no code change and no console noise.

---

## Judgement calls

### Coordinate convention: +y is up

The physics originally treated `+y` as down (`vy` grew with gravity) while the
ortho camera treated it as up. The level rendered upside down and the player
stood on the ceiling. Now `+y` is up everywhere, and `config.js` states the
consequence explicitly:

> apex is `JUMP_VEL² / 2*GRAVITY` ≈ 43px ≈ 5.4 tiles, and a full jump covers
> ~9 tiles horizontally. No platform may sit more than ~5 tiles above whatever it
> is jumped from.

The level geometry is built inside that budget rather than by eye, which is the
only reason a 190-tile level is actually traversable.

### Palette quantisation became colour-depth posterisation

The plan's "quantise to a per-level palette" was implemented literally — snap
every sprite to one of eight per-level colours — and it made the hero disappear.
Kael is brown and blue; the L1 palette is eight shades of emerald. The quantised
hero was the same value as the shrine behind him.

Grit comes from cutting colour **depth**, not from throwing hue away. Sprites now
posterise to N levels per channel with a Bayer dither, and level identity comes
from a per-level grade that shifts channels and lifts brightness without erasing
what colour a sprite actually was.

### The post pass owns the sRGB encode

Sprite and canvas textures are tagged sRGB, so the scene pass samples them into
linear. The post pass is a raw `ShaderMaterial` writing straight to the default
framebuffer, and nothing encodes that — the game rendered about a stop and a half
too dark. The render target is now `LinearSRGBColorSpace` and the post shader
ends with a linear→sRGB conversion. The pixel grid is untouched; only the
transfer function is.

### Sprite quads are shifted into 0..1 before scaling

A `PlaneGeometry(1,1)` translated by `baseline / 2` and then scaled to the cell
size lands the figure at `baseline/2 * cellHeight` — roughly 48× its own cell,
off-screen. The geometry is shifted into the 0..1 range *before* the scale, which
puts the feet at the origin in world units. Same change in `Ghost`.

### Camera clamps against the transformed level AABB

After the L2 rotation the group is turned, so the level's local frame no longer
maps to screen axes. The camera transforms the level's four corners and clamps
against their bounds, which is correct at any rotation angle. It also follows the
player in world space throughout, so during the 0.6s turn the room swings around
Kael instead of the camera swinging around the room.

The overhang past the level bounds is **proportional to how much room there is**,
not a fixed fraction of the screen. A level barely taller than the viewport — all
three of these are ~272px against a 270px view — gets almost none, so the camera
cannot show a band of void below the floor.

### The boss triggers on entering the arena, not on proximity

The original check was a two-way distance test against the boss. A player
sprinting at full speed passed clean through the trigger radius and finished the
level without ever meeting him — the playthrough found it, not the smoke suite.
It now fires on crossing a line in front of the boss.

### The player is clamped to the level bounds explicitly

`tileAt()` reports out-of-range columns as SOLID, which stops the body at the
wall most frames — but the resolved position depends on *which* out-of-range
column the body happens to land in, so a fast step (the dash, or a long frame)
left the player standing on phantom solid outside the level, at x=1746 in a
1520-wide level. The body is now clamped horizontally after every integration.
Y is deliberately left free: the gaps in these levels are real pits, and falling
out of one is what fires the death check.

### The Marble Mummy needed a source-level fix, not a shader fix

It rendered as a faint ghost. Two causes: the atlas was keyed and graded too dark
(its `levels` window was `(0.13, 0.82)`, now `(0.10, 0.70)`), and the 1px outline
flooded it — the sprite is low-alpha in places, so a `> 0.6` neighbour threshold
outlined most of the body. Both fixed at the source: brighter atlas, outline
threshold raised to `0.85`, boss lift up to `0.26`.

### Bosses get a brightness lift

They are the largest dark shapes on screen and the source art is painted dark.
Without `setLift(0.26)` they read as holes in the level rather than as
characters. The lift is applied once, in `Boss.setPaletteLevel`.

### L3's darkness has an ambient floor

"Sword halo is the only light" was implemented as a hard falloff to near-black,
which produced a black rectangle with a torch in it. It is now a tight core
(`core²`), a wide soft halo, and a **0.30 ambient floor**. The level is dark and
the light still matters, but the platforms are navigable. The trade-off is
explicit in the shader comment.

### The boot overlay is removed from the DOM

The 400ms fade left the overlay painting its title across the menu for the whole
time it existed in the DOM. It is removed after the fade instead.

### Two smoke checks were order-dependent

The Patient One check left the weighted action roll to chance and could pick
non-attacking actions for 300 ticks; and the ending check assumed the step before
it had left the game in L3. Both now set up their own state. The Patient One
check pins the weights to strike-only, so it tests the prediction rather than the
dice.

### UI is DOM, not in-canvas text

The plan said "all HUD text from a strings table" but not where it renders. DOM
overlays: crisp type at any window size without shipping a bitmap font, and the
letterbox and cutscene panels need to sit above the upscaled buffer anyway.
Every string still comes from `strings.js`; the smoke check asserts there is no
player-facing literal in the UI layer.

### Coordinates of difficulty

Three knobs, all in `config.js`: `LOW_RES_W`/`LOW_RES_H` (chunkiness),
`ROTATE_TIME` (0.6s, per spec), `AI.predictHorizon` (how far The Patient One
leads the lantern path). Difficulty scalar and fairness caps are in
`DIFFICULTY` and `AI` respectively, and the caps are deliberately *not*
reachable from the adaptive weights — attacking is only ever offered through
`_attackAllowed`, so one change constrains every agent in the game.

---

## AI, motion and level polish (MarioZaMu)

The brief was: smarter attacks and movement for every enemy, smoother motion
for every character, and levels that look finished. The rules: no gate may
break, no new dependencies, and the boss attack contract does not change.

### Minions got the boss contract

Minion attacks used to land on the same AI tick that picked `attack`: a
crawler lunged with no tell at all. They now run a small windup -> active ->
recover (`ATTACK_T` in `js/game/enemy.js`), blink and crouch through the
windup, and can only hurt during `active`. Hitting one during its windup
cancels the attack. One AI decision buys at most one attack (`attackArmed`),
so an `attack` action that outlives a fast attack cannot start a second one
that skipped the fairness gates.

`AI.maxConcurrentAttackers` was defined in `config.js` and never read. It is
now a shared token: only that many minions can be in windup or active at once,
and the rest wait at striking distance instead of crowding in.

Each type only attacks from its own `RANGE`; the spitter keeps a spacing band
and leads its shot by half the player's vertical motion. Walkers check the tile
ahead and below before every step, so they no longer walk into pits (on master
both L1 crawlers fell in within ten seconds of nobody touching them). Out of
aggro range, `approach` and `attack` turn into going home: the table offers
them at any distance, and wisps were crossing half the level to chase.

### `_hold` keys were being rolled as actions

The weight tables carry `<action>_hold` durations next to the weights, and
`Agent.decide()` copied all of them into the roll. A share of every decision,
for every minion and boss, picked an "action" that does nothing. `decide()` now
skips them; `update()` still reads them. Neutral weights are unchanged, so
`gateai` AI5 still holds.

### Bosses pick attacks for the distance

The reach of each attack was measured from its hit box, not guessed: swing 38
px and slam 44 px for the statue, a 64 px volley for Ul Burjo (the bolts only
live for the active window), a 95 px ring for The Patient One. Out of reach
the boss closes in (statue), blinks (Ul Burjo) or uses the cutoff (Patient
One) instead of attacking empty air. Measured over 40 s per boss, master threw
8 of 15 statue attacks out of reach; now none are.

No attack goes three times in a row when another attack fits the distance.
That is a preference and not a lock: the first version made it a lock and Ul
Burjo, far away with two blinks behind him, stopped attacking altogether.
After an attack a boss standing inside the player steps back. None of this
runs after `_begin()`, so windup/active/recover is untouched.

Boss friction was `vx *= 0.86` per frame, which brakes 2.4x harder at 144 Hz
than at 60. `Boss.dampVx()` raises the factor to `dt * 60`: identical at 60
fps, the same at every other rate.

### Motion is visual only

Lean (`setLean`, a rotation about the feet), squash, dust and the run cadence
never touch a body or a hit box. Kael's jump and run constants are untouched,
because `tools/reach.mjs` proves the levels against them. `Sprite.play()` only
applies `speed` when the clip changes, so the run cadence is now set on
`sprite.speed` every frame.

### Level shading is mixed in sRGB

The first pass mixed lip colour into the tile bodies in linear light. The post
pass encodes to sRGB, which lifted a 20 % mix into bright slabs that
outshone Kael, the exact problem the near-black bodies were chosen to avoid.
`mixHex()` blends the hex values instead, so 10 % looks like 10 %. Decoration
and stone grain are one `InstancedMesh` per world, seeded per level.

### The L3 crawler was spawned inside a pit

It sat at tile 104, inside the hole at tiles 98-111, with its patrol
`[100, 114]` over the hole too, so it fell out on its first frame on master as
well. It now stands on the floor just past that hole, at tile 122 with patrol
`[114, 136]`, guarding the landing.

### Found, not fixed

- `tools/smoke.mjs` fails on master at "level 2 cannot rotate": it still tests
  the L2 rotation that the Shift replaced.
- `gate4` fails about one run in eight on master as well: phase 2 sometimes
  does not roll `shift` inside the gate's window.

---

## Verification

`tools/smoke.mjs` drives a headless Chromium through a full run and fails on any
console error. It covers the state machine, movement, jump, dash (i-frames, ghost
trail, cooldown gating a second dash), sword, the adaptive governor staying under
its ceiling, the level bounds clamp, L1→L2→L3, the 0.6s rotation including
local/world drift, the halo-only light, The Patient One's prediction,
counter-dodge biasing the weights, the fairness gates (no attack during i-frames,
no attack inside the 0.8s gap, no attack without line of sight), phase 2 at 55%,
Ul Burjo's disguise drop and paced arena rotation, the ending, and the language
toggle.

```
python3 -m http.server 8765
node tools/smoke.mjs
```

22 checks, 0 console errors. Verified stable across six consecutive runs.

A second, longer scripted playthrough was kept alongside it (hold right, jump,
dash, attack, for thirty seconds of real frames). It is what caught the bounds
escape and the missed boss trigger — both of which the assertion-based suite had
walked straight past, because a check that only drives the player a few steps
never gets fast enough to leave the level. There is a check for the bounds now;
the playthrough lives in `.scratch/` and is not committed.
