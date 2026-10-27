# LUMENFALL

A 2D action-platformer built in Three.js with plain ES modules. A sorcerer disguised
as a kind elder steals a village's Ember to wake something ancient; Kael, the village
warden, goes and brings it back.

Three levels, three bosses, and enemies that read how you play. Static files only:
no build step, no package install, no network.

---

## Run it

Every source file is an ES module, and browsers refuse to import modules from
`file://` (a security rule, not a quirk of this project). Double-clicking
`index.html` gives a blank page and a console error. So serve it:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static server works (`npx serve .`,
`php -S localhost:8000`, Live Server in VS Code).

Nothing to install, nothing to build. Three.js is vendored in
`js/vendor/three.module.js`, every sound is synthesised at runtime by
`js/core/audio.js`, and the game makes no network request unless you paste a Google
Analytics id into `js/core/config.js`. The browser gates expect port **8765**:
`python3 -m http.server 8765`.

## Controls

The real bindings live in `js/core/input.js`; this table is that map, unchanged.
Gameplay inputs are buffered for 120 ms, so a jump pressed slightly early during a
landing still fires on the first legal frame.

| Action | Keys |
|---|---|
| **Move** | `A` / `D` or `←` / `→` |
| **Jump** | `Space`, `W` or `↑` |
| **Attack** | `J` or `Z` |
| **Dash** | `K`, `X` or `Shift` |
| **Shift** worlds (L2 only) | `E` |
| **Pause** | `Esc` or `P` |
| Switch language | `L` |

Watch a cutscene directly: `index.html?cutscene=prologue|theft|reveal|waking|return`

Menus, cutscenes and story dialogue use `W`/`S` or `↑`/`↓` to move the selection,
`Enter` / `Space` / `J` / `Z` to confirm or advance, and `Esc` to go back or skip a cutscene.

Notes that matter more than they look:

- The dash lasts 0.2 s, gives i-frames, 1 s cooldown; one air dash, refreshed on landing.
- The blade has a short active window; missing is cheap, committing is not.
- `E` does nothing outside the Reliquary. That is the level, not a bug.

## Story

The opening is three beats, in this order:

1. **Prologue** — narration over two stills: a village keeps the Ember, its light does
   not warm houses but keeps the whole forest alive, and Kael watches over it.
2. **The elder's deal** — an old merchant on the slope offers gold and endless wealth
   in exchange for one thing: look the other way tonight. Kael agrees to "...one night."
   It plays in-game over the level, with a camera ease onto the pair, not as a cutscene
   you skip past.
3. **The theft** — that night the elder enters the shrine and the Ember goes out. The forest starts to die, and Kael says it was his fault and that he will bring it back.

The rest is revealed by the fights rather than told. Ul Burjo, the L2 boss, is the elder:
the disguise drops in his second phase, the same figure in different art. The L3 boss
is the Ancient One the Ember was stolen for. Nobody ever learns the name the old man
wore before, and the ending says so — the light came home, and that is the whole of it.

## Levels and bosses

| Level | Name | Mechanic | Boss |
|---|---|---|---|
| 1 | Shrine of Ember (190 tiles) | **A fixed map.** A hand-built platforming route: two bottomless gaps, stepped terraces, a long flat opening so the controls can be learned before the level asks for anything. | The **Marble statue** boss (in-game name: *Marble Mummy*) in `js/game/boss/statue.js`. The tutorial boss: it teaches only that an attack is a thing you can see coming. |
| 2 | Rotting Reliquary (170 tiles) | **The world Shifts.** `E` toggles between two versions of the same map. Nothing moves; tiles appear and disappear and the palette changes. Gaps too wide to jump are pits in world A and bridges in world B, and standing walls exist only in world A. | **Ul Burjo** in `js/game/boss/ulburjo.js`. Phase 1 is a ranged duel; phase 2 Shifts the arena under you — your own tool, aimed at you. |
| 3 | Lantern Wood (180 tiles) | **Near-total darkness.** The sword halo is the only light in the level. Standing still makes you nearly invisible; attacking makes you a moving lamp. | **The Patient One** in `js/game/boss/patientone.js`. It does not track you, it tracks your *light*: it extrapolates the halo's path and drops a column of dark on it. Phase 2 closes the light radius in for 3 s. |

All three bosses have two phases, a phase change at 55 % health, and the same attack contract.
Layouts are in `js/game/level.js`; tuning constants in `js/core/config.js`.

Each tile is shaded by its depth under the surface, and every level is dressed from a
fixed seed: grass and stones in the Shrine, crystals in the Reliquary, roots and
mushrooms in the Wood, plus ambient fireflies, spores or embers (`FX.ambient` in
`js/game/fx.js`). All of it is visual and none of it collides.

## Adaptive AI

Everything lives in `js/game/ai.js`, in three parts.

**The loop: sense → decide → act.** Every agent runs it on a fixed 10 Hz tick.
*Sense* is a cheap grid march between the agent and the player for line of sight, plus
distance, delta and the player's state (ground, air, dash, attack, dead). *Decide*
turns a per-type weight table into a choice, re-weighted by the player model, and rolls
it. *Act* commits for a window and then re-decides. An agent can only pick from its own
table — adaptation re-weights the options, it never invents new ones, so no amount of
reading you can produce an action the design does not have.

**The player model.** `PlayerModel` in `js/game/ai.js` keeps a rolling window of the
**last 20** meaningful player actions (`move`, `idle`, `jump`, `dash`, `attack`, `dead`),
sampled roughly every 90 ms, with the position and velocity of each. Counts are
recency-weighted, and it exposes `dodgeBias`, `aggression`, `predictability`,
`tendency`, `drift()` and `trail()`.

**How the agents counter the three players.** Against a **dodger** (high `dodgeBias`)
the weight on `attack` drops and a `bait` weight appears, so the boss delays instead of
committing into a dash — the harder you try to avoid hits, the longer it waits. Against
a **masher** (`aggression` above 0.5) `approach` and `retreat` both rise: it closes
faster but keeps its spacing, trading rather than swapping blindly. Against a **jump
spammer** (`predictability` above 0.55 with `jump` as the tendency) an `antiAir` weight
is added. A repetitive player gets their dominant tendency answered in general: masher
→ attack up, dodger → bait up, jumper → anti-air.

**The governor.** `Governor` owns the difficulty scalar. You pick **Easy**, **Normal**
or **Hard** on the title screen, and the effective scalar is `base * (1 + adapt)`,
hard-clamped to never exceed `base`. `adapt` drifts toward whatever the player model
implies, once every 60 ticks and by 25 % at a time, inside a band of ±0.10 / ±0.16 /
±0.20 per difficulty. A boss can get sharper at reading you over about six seconds and
can never become harder than the option you selected. Instant adaptation reads as
cheating; slow adaptation reads as learning.

**The fairness caps are separate from, and stricter than, adaptation.** They are hard
rules in `Agent._attackAllowed`, not weights, so one change constrains every agent in
the game: no attack is ever committed while the player is in i-frames, at 0.8 s minimum
between committed attacks (`AI.minAttackGap`), and not at all without line of sight. A
reaction delay, scaled by difficulty and stretched by the player's own dodge bias, is
the floor that makes the boss feel like it is reacting rather than reading mind. Ground
contact damage is rate-limited, so brushing past a boss is survivable.

**The boss attack contract** is the same three stages in all three bosses, defined in
`js/game/boss/base.js` and implemented in each boss file:

- **windup** — planted and still, with a blinking warning marker drawn on the floor in
  the exact patch the hit box will occupy, for exactly as long as the player has to
  move. The marker is the promise, not a decoration.
- **active** — the damage, decided on one frame, 0.10–0.20 s. Movement belongs to this
  window and nowhere else, so a boss can never drift into you during its own tell.
- **recover** — the longest part of every attack, and safe to hit. It is the player's
  window to punish.

A phase change or a death cancels the attack *and* its markers together, so you are
never left reading a tell that does not resolve.

**Bosses choose for the distance.** Every boss only starts an attack that can reach
the player from where they stand (swing 38 px, slam 44 px, volley 64 px, ring 95 px);
otherwise it closes in, blinks or picks one that reaches. No attack is used three times
in a row while another one fits, and a boss that ends up on top of the player after an
attack steps back to its spacing.

**Minions follow the same contract, smaller.** In `js/game/enemy.js` every minion
attack is windup (blinking and crouched), active (the lunge or the shot, the only
damage), recover. A hit during the windup cancels it. Only `AI.maxConcurrentAttackers`
minions can be attacking at once; the rest wait their turn at striking distance. Each
type attacks only from its own range, walkers never step off a ledge, the spitter keeps
its distance, and outside aggro range minions go back to their patch of the level.

**Verification:** `node tools/gateai.mjs` — pure Node, no browser. 16 checks covering
the 20-action window and forgetting, each of the three counters, the governor ceiling
and band over 3000 ticks × 3 difficulties × 4 player types, adaptation in opposite
directions, Easy < Normal < Hard, the four fairness gates, and the light-path
prediction. `tools/gateboss.mjs` is what proves the attack contract for the L2 and L3
bosses.

## Metrics

`js/core/metrics.js` is a flat, append-only log of what the player actually did. Every
event is stored locally first and only then handed to Google Analytics if one is
configured, so the metrics screen works on a machine that has never been online. The
log is the single source of truth; `summary()` is derived from it on every read, so
there is no second copy of the numbers to fall out of sync. A private-mode or corrupt
key starts an empty log instead of taking the game down.

Events: `session_start`, `level_start`, `level_complete`, `player_death`,
`boss_defeated`, `game_complete`. Deaths carry a level, a zone (one per 20 tiles) and a
cause, which is what makes "where do people keep dying" answerable. Storage is
`localStorage`, key `lumenfall.metrics.v1`, capped at 2000 events.

In game: the **Metrics** button on the title screen opens a panel with starts, completes,
% complete, deaths and average time per level, plus the deadliest zones. `Esc` closes
it. Everything comes from the log, so it is correct on the first read.

Google Analytics: put your own id in `GA_MEASUREMENT_ID` in `js/core/config.js`
(`'G-XXXXXXXXXX'`). It is empty on purpose — with an empty value no script is injected,
no request is made and no global is created, and `node tools/gate7.mjs` asserts exactly
that. Events are then forwarded through `gtag` best-effort, so a stubbed or half-loaded
analytics can never break the frame that emitted the event.

## Project structure

```
index.html            canvas, DOM overlays, one script tag
css/style.css         HUD, menus, cutscene panels, metrics sheet
js/
  main.js             game loop, state machine, flow, wiring
  core/               config (every global tunable), input, audio, rng, metrics
  render/             pipeline (low-res pass + post), sprite, materials, parallax, minions
  game/               level, player, physics, enemy, ai, fx, state
  game/boss/          base (contract), statue, ulburjo, patientone
  ui/                 strings, i18n, hud, cutscene
  vendor/             three.module.js, vendored r170
assets/
  atlases/            generated sprite atlases + frame manifest
  cutscenes/          painted story panels 01-19
  bg/                 per-level parallax layers
sprites/              cut enemy atlases + manifest
tools/                asset pipeline (python) and the gates (node)
docs/                 per-stage specs and DECISIONS.md
```

`js/core/config.js` is the tuning file: resolution, movement constants, per-level
palettes, the difficulty table and the AI fairness caps. `docs/DECISIONS.md` records
what turned out differently from the plan and why.

## Tests

The browser gates drive a real Chromium through Playwright, so serve the game first on port 8765:
`python3 -m http.server 8765`. `gateai` and `gatei18n` are pure Node and need no server.

| Command | What it proves |
|---|---|
| `node tools/gate3a.mjs` | Damage is real and hits have weight: one hit costs 1 hp, hitstop, camera shake, stagger and knockback on enemies, and no console errors. |
| `node tools/gate3b.mjs` | The L1 statue honours the attack contract: stages in order, no damage outside `active`, a marker up during ≥ 90 % of windup frames, and clean teardown on death. |
| `node tools/gate4.mjs` | The same contract for Ul Burjo, plus that his phase-2 `shift` attack really Shifts the world. |
| `node tools/gate5.mjs` | The same contract for The Patient One, plus that phase 2 uses the light surge. |
| `node tools/gate6.mjs` | The reveal, waking and return cutscenes use the painted panels 11-19, that all nine files load, and that they are preloaded. |
| `node tools/gate7.mjs` | Metrics: summary maths, `gtag` forwarding, survival across a reload, the in-game panel, and that nothing is sent to Google while the id is empty. |
| `node tools/gateai.mjs` | The adaptive AI: the 20-action window, the three counters, the governor ceiling, and the four fairness gates. No browser needed. |
| `node tools/gatei18n.mjs` | Spanish and English have the same keys, none empty, nothing long left untranslated, and every key used in the code exists. No browser needed. |
| `node tools/reach.mjs` | Every level is actually playable: support, the required spawn-to-arena path, a real jump apex, and pit death with a working respawn. |

All nine pass. `tools/smoke.mjs` is the older end-to-end pass
(title, cutscene, movement, rotation, both boss phases, ending, language toggle) and
fails on any console error. It currently stops at "level 2 cannot rotate": it still
checks the L2 rotation that the Shift replaced, and fails on master the same way.

## Known limitations

- **The art is AI-generated.** The character sheets in `assets/` were produced with AI
  image tools from the team's own reference sheets, then cut into atlases by
  `tools/build-atlas.py` and `tools/cut_minions.py`. The consistency is the tooling's
  job, not a human artist's, and it shows at the edges.
- **Testing is automated plus short human play.** The nine gates listed above are real
  and the game has been played through by hand, but it has not been play-tested at
  scale. Balance numbers are reasoned, not measured from a population.
- **Google Analytics needs the team's own id.** Until someone fills in
  `GA_MEASUREMENT_ID`, metrics stay local. That is deliberate, not unfinished, but the
  shipped build sends nothing anywhere.
- **The difficulty label is the ceiling, not the floor.** Adaptation only moves inside
  the band; it will not rescue a player who picked Hard.
- **One cutscene is a leftover.** The L2 boss intro still carries lines that predate the
  deal and read oddly next to it. The flow still plays it; it should be rewritten or cut.
- **Spanish is the default language** and the original text. The English pass is checked
  by a key-parity gate, not by a fluent speaker.
- **Audio is fully procedural.** Coherent and free, but synthesised blips, not a sound
  design.

## Credits

- **Three.js r170**, vendored in `js/vendor/three.module.js` — MIT licence.
- **Art** generated with AI image tools from the team's own reference sheets, then cut
  into atlases and panels by the scripts in `tools/`.
- **Code** built with AI coding agents under human direction.

Team: (add names)
