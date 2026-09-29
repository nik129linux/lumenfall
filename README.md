# LUMENFALL

A 2D action-platformer in Three.js. A sorcerer disguised as a kind elder steals
a village's Ember to wake something ancient; Kael goes and brings it back.

Three levels, three bosses, a rotating-room mechanic, and enemies that learn how
you play. Static files only — no build step, no package install, no network.

---

## Run it

The game uses ES modules, so it needs to be served over HTTP. Opening
`index.html` from the filesystem will not work (`file://` blocks module imports).

Any static server will do:

```bash
# Python (already installed)
python3 -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000>.

There is nothing to install and nothing to build. Three.js is vendored into
`js/vendor/`, so it works offline.

---

## Controls

| | |
|---|---|
| **Move** | `A` / `D` or `←` / `→` |
| **Jump** | `Space` or `W` |
| **Attack** | `J` or `Z` |
| **Dash** | `K`, `X` or `Shift` |
| **Rotate the level** | `E` — *Reliquary only (L2)* |
| **Pause** | `Esc` or `P` |
| **Language** | `L` (also in the menu) |

`Esc` pauses from anywhere in-game, and the pause menu returns you to the title.

### How the character plays

- **Dash** lasts 0.2s, grants i-frames, and leaves a ghost trail. You get **one
  air dash**, refreshed on landing, and a **1s cooldown** after any dash.
- **Attacks** have a short active window. Missing is cheap; committing is not.
- **L2 rotates the room 90°** over 0.6s while you stay put. Walls become floors,
  floors become walls, and gaps too wide to jump become ledges you can walk.
- **In L3 the sword halo is your only light.** You are much easier to see while
  attacking than while standing still — that is a real trade-off, not decoration.

---

## Difficulty

Pick Easy / Normal / Hard on the title screen. The bosses read how you play —
dodging, aggression, how repetitive you are — and shift their timing to suit.

They adapt **only within the band of the difficulty you chose**, and never
exceed it. There is a hard floor on reaction time, they will not swing into your
i-frames, and they will not commit more than once every 0.8s. They get sharper at
reading you; they do not get cheaper.

---

## Language

Spanish by default, English one keypress away (`L`). The choice is remembered.
Every piece of text in the game — HUD, menus, cutscenes, the ending — comes from
one strings table, so there is no mixed-language UI.

---

## Layout

```
index.html
css/style.css
js/
  main.js            game loop, state machine, per-state updates
  core/              config (every global tunable), input, audio, rng, assets
  render/            pipeline, parallax, materials, sprite
  game/              level, player, physics, enemy, ai, fx, state
  game/boss/         statue, ulburjo, patientone
  ui/                strings, i18n, hud, cutscene
  vendor/            three.js r170
assets/
  atlases/           generated sprite atlases + frame manifest
  bg/                optional parallax layers (empty; procedural fallback)
tools/
  build-atlas.py     one-shot: reference sheets -> atlases
  smoke.mjs          headless end-to-end check
docs/
```

**`js/core/config.js` is the tuning file.** Screen resolution, movement
constants, per-level palettes, the difficulty table, the AI fairness caps and the
predictive horizon all live there.

---

## Regenerating the art

The character files in `assets/` are reference sheets, not sprite atlases, so
`tools/build-atlas.py` turns them into game-ready atlases. It runs once and its
output is committed:

```bash
python3 tools/build-atlas.py            # build
python3 tools/build-atlas.py --probe    # contact sheets, for checking the slicing
```

Needs `pillow`, `numpy` and `scipy`.

### Adding your own parallax art

`assets/bg/` is intentionally empty — the game draws its own gradient and
silhouettes. To use your own layers, drop the files in and list them in
`assets/bg/manifest.json`, near-to-far:

```json
{ "levels": { "1": ["far.png", "mid.png", "near.png"] } }
```

Anything not listed is generated. Layers you do not provide keep their
procedural equivalent, so a partial set is fine.

---

## Verifying it works

```bash
python3 -m http.server 8765
node tools/smoke.mjs
```

Drives a headless browser through a full run — title, cutscene, movement, dash
and its cooldown, the rotation, the adaptive AI's ceiling, the fairness gates,
both boss phases, the ending, the language toggle — and fails on any console
error. Needs `playwright` available to Node; the game itself needs nothing.

---

## Design notes

`docs/` holds the design spec and a decisions log recording what turned out
differently from the plan and why — the coordinate convention, the palette
problem, the sRGB encode, and the camera clamp that the rotation mechanic
forced.
