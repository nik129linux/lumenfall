# Inspiration: hollow-crown

Repo: https://github.com/rehan-remade/hollow-crown (MIT). A local clone is in
`.scratch/hollow-crown/`. Read it for technique, do not copy its art or palette:
it is a bright MapleStory look, ours is dark Tenebris Somnia.

This is reference for LATER stages. Do not apply any of it during stage 1.

## What to take, and in which stage

| Technique | Where in their repo | Our stage |
|---|---|---|
| Hitstop (freeze N frames on hit, 3 small / 8 big) | `prototype/src/engine.js:404-414` | 2 (combat feel) |
| Screen shake with amplitude, decays per frame | `engine.js:405, 561` | 2 |
| Enemy white flash on hit (0.05 s small, 0.1 s big) via a white LUT/silhouette | `engine.js:66, 288, 412` | 2 |
| Hit-reaction wobble (per-row shear on the hit body) | `engine.js:297-299` | 2 |
| Darken the world while effects stay bright during big attacks | README "skill loops" | 2 |
| Boss phases by HP (66% and 33%), each phase faster with new attacks | README "The RPG" | 2 (statue), 4, 5 |
| Telegraphs: blinking ground marker before every boss attack | README "The RPG" | 2, 4, 5 |
| Monster white-silhouette sheet for flash (`mob_<id>_white`) | `pipeline/RPG_ASSETS.md` | 2 |
| One-way platforms (jump up through, Down+Jump to drop) | README "The RPG" | 2 |
| Portrait dialog boxes for NPC talk | README "The RPG" | 3 (elder dialogue) |
| Synthesised WebAudio SFX (no audio files) | `pipeline/rpg-audio.js` | 6 |
| Low native res (320x180) + integer scaling | README table | keep ours at 480x270 |

## Rules

- Every value above is a starting point. Tune by playing, not by matching their numbers.
- Their game draws everything procedurally. Ours uses the painted sheets in `assets/`.
  Only procedural parts (FX, particles, minion silhouettes, UI) may borrow their drawing code.
