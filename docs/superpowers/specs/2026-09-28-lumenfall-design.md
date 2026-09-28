# LUMENFALL — Design Spec

Date: 2026-09-28
Status: approved

## What it is

A 2D action-platformer in Three.js. Orthographic camera, low-res render buffer
upscaled with grain and vignette, "Tenebris Somnia" gritty pixel look. Static
files only — `index.html` + `js/` + `css/`, no build step, runs offline.

## Story

A sorcerer disguised as a kind elder offers a village infinite wealth. He steals
the village Ember and uses it to wake an ancient demon. Kael goes after the Ember
and brings it back. The ending pays off the L1 emerald palette: colour bleeds
back into the world as Kael returns the light.

The kind elder and the sorcerer Ul Burjo are **the same character** (approved
decision 1). In L1 the player meets the Elder; his final idle frame has glowing
green eyes, a planted tell. In L2 the disguise breaks and he fights as Ul Burjo.

## Cast

| Role | Ref | Notes |
|---|---|---|
| Kael | `assets/kael.jpeg` | hero, side view, flip for direction |
| Elder / Ul Burjo | `assets/goodwitch.jpeg` / `assets/badwitch.jpeg` | same entity, two guises |
| Marble Mummy | `assets/statue.jpeg` | L1 boss |
| The Patient One | `assets/demon.jpeg` | L3 boss, antlered |

## Levels

| | L1 | L2 | L3 |
|---|---|---|---|
| Name | Shrine of Ember | Rotting Reliquary | Lantern Wood |
| Palette ref | `1.png` emerald | `2.jpg` purple/toxic | `3.jpg` burnt-orange/black |
| Light | ambient | ambient | **sword halo is the only light** |
| Mechanic | — | **rotate the level group 90°** | — |
| Boss | Marble Mummy (1 phase) | Ul Burjo (2 phases) | The Patient One (2 phases) |

## Player — Kael

- Light sword slash.
- Jump.
- Dash: 0.2s duration, grants i-frames, leaves a ghost trail, **1 air dash**,
  **1s cooldown**.
- Sword halo is the only light source in L3.

## The L2 rotate mechanic

Physics runs in the level group's local frame, which is axis-aligned at rest.
On button press:

1. Physics is disabled.
2. The group tweens 90° over **0.6s**, rotating around the player.
3. The player is pinned in world space, so the room visibly swings around them.
4. On completion the player position converts back to the group's new local frame.

Gaps become walls become floors. No rotated-AABB math needed. Ul Burjo's second
phase reuses this as an arena mechanic.

## Enemy AI

Ticks at 10Hz, three stages:

- **sense** — distance, line of sight, player state (attacking / dashing / jumping), threat.
- **decide** — weighted action choice, perturbed by a rolling model of the **last
  20 player actions** (dodge bias, aggression, predictability) and by the
  difficulty scalar.
- **act** — commit to the chosen action over a window.

### The Patient One (L3)

Predicts the path of Kael's lantern-light and strikes where the light will be,
not where the player is. Gets the majority of the AI budget.

### Difficulty and fairness

Easy / Normal / Hard set a scalar. The adaptive model **nudges within the band
for the chosen difficulty and never exceeds that ceiling** (approved decision 2).
It reads the player; it never becomes unfair.

Hard fairness caps, all levels:

- Minimum reaction-time floor.
- Never attack during the player's i-frames.
- At most one committed attack at a time.
- Minimum 0.8s between committed attacks.
- Bounded number of simultaneous attackers.

## Presentation

- Ortho camera locked to a world-units-per-pixel grid.
- Scene renders to a **480×270** render target, exposed as a **single constant**.
- Fullscreen post pass: nearest upscale + film grain + vignette + scanlines +
  palette quantization.
- Parallax: 3 quads per level at z −40 / −20 / −8 with per-layer scroll
  multipliers and depth fog.
- `assets/bg/` is empty, so the procedural gradient + silhouette fallback is the
  real path. File loading is wired in for when layers get dropped in.

## Cutscenes

Fullscreen panels, letterbox bars tweened in, typewriter text, skippable.

## i18n

ES by default, EN toggle. All HUD, menu, and cutscene text comes from a strings
table. No hardcoded strings in gameplay code.

## Asset pipeline

The character refs are reference *sheets*, not atlases. Four of five are on
`#FF00FF` (74–80% coverage); `statue.jpeg` is a labeled Spanish concept board.

`tools/build-atlas.py` runs once and commits its output:

- Chroma-key magenta to alpha (4 sheets).
- `statue.jpeg`: crop by hardcoded section coordinates (approved decision 2) —
  the Spanish labels and section rules poison connected-component analysis. Takes
  the 12 Section-1 poses and the Section-4 actions.
- Connected-component extraction finds frames.
- **Normalize to a shared cell, feet-baseline aligned** (approved decision 3).
  Per-frame tight crops animate with a visible wobble; baseline-locking kills it.
- Emit `assets/atlases/*.png` + a frame manifest consumed by `js/render/sprite.js`.

## Boss depth (approved decision 1)

- Marble Mummy: 1 phase, tutorial boss.
- Ul Burjo: 2 phases; phase 2 uses the 90° rotating arena.
- The Patient One: 2 phases, most of the AI budget, light prediction.

## Layout

```
index.html  css/style.css
js/vendor/three.module.js
js/core/    input assets audio rng
js/render/  pipeline parallax materials sprite
js/game/    state player physics level camera enemy ai combat fx
js/game/boss/  statue ulburjo patientone
js/ui/      strings i18n hud menu cutscene ending
tools/build-atlas.py
assets/atlases/   generated
```
