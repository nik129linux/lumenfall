# Stage 2 — Story: prologue, the elder's deal, real cutscene art

Nico played stage 1d and likes it. What is missing: the elder (goodwitch) never talks to
Kael and stands in the wrong place, and there is no real cinematic (the panels are CSS
colour gradients). This stage builds the whole opening of the story.

Rules for this stage:
- Do ONLY what is written here. Combat, bosses, AI, L2 rotation, L3 darkness: untouched.
- Never delete, move or overwrite files you did not create. `assets/` is read-only.
- All text goes through `js/ui/strings.js`, Spanish AND English. Use the exact lines below.
- When all acceptance checks pass: commit and stop. Do not create `.bunny-done`.

## The story flow (new game → L1)

```
MENU ─► PROLOGUE (cutscene, panels 01-02) ─► L1 play
          │
          └─ Kael walks right ─► reaches the elder ─► THE DEAL
                 (in-game dialogue + panels 03, 04) ─► THE THEFT (panels 05, 06)
                 ─► elder is gone ─► L1 play continues ─► statue boss
```

## 1. Cutscene panels use the real images

Art is in `assets/cutscenes/01.png` … `06.png` (01, 02: 1024x434; 03, 04: 1024x1024;
05: 1024x572; 06: 1024x682). Replace the CSS gradient art in `.panel-art[data-art=...]`
with these images.

- `line.art` becomes an image id: `'01'` … `'06'` → `assets/cutscenes/NN.png`. Preload all
  six when a new game starts so no panel pops in.
- Fit: the panel area is the 16:9 area between the letterbox bars. Draw the image with
  `object-fit: contain`, centred. Behind it, draw the SAME image with `object-fit: cover`,
  `filter: blur(18px) brightness(0.35)`, so square images (03, 04) have no black side bars.
- Motion: each panel slowly zooms from `scale(1.00)` to `scale(1.06)` over the time it is
  on screen (CSS transition, ease-out), alternating the transform-origin left/right per
  panel. Crossfade 400 ms between panels. No pixelation filter on these images.
- Text box sits at the bottom inside the letterbox area, speaker name above the line,
  typewriter as today. Keep the current rule: first press finishes the line, second press
  advances. `Esc` skips the whole cutscene.

## 2. PROLOGUE (plays after "Nueva partida", before L1)

Replace the current `intro` script with `prologue`. Narration only (no speaker name).

| panel | ES | EN |
|---|---|---|
| 01 | En lo profundo del bosque, una aldea guardaba la Brasa. | Deep in the forest, a village kept the Ember. |
| 01 | Su luz no calentaba casas. Mantenía vivo todo el bosque. | Its light did not warm houses. It kept the whole forest alive. |
| 02 | Cada raíz, cada hoja, cada criatura bebía de ella. | Every root, every leaf, every creature drank from it. |
| 02 | Kael, el guardián de la aldea, la vigilaba cada noche. | Kael, the village warden, watched over it every night. |

## 3. The elder's placement

In `js/game/level.js` L1: move the elder to **x = 30 tiles**, standing on the ground
(`FLOOR_Y`). Requirements, check them in code:
- Flat ground for at least 8 tiles on each side, no platform above him lower than 6 tiles.
- No enemy spawn and no patrol range within 20 tiles of him.
- He faces LEFT (toward where Kael comes from). goodwitch's native facing is right, so
  flip him.
- Idle animation plays while waiting; he must not walk.
- Re-run `tools/reach.mjs` after the move; it must still pass.

## 4. THE DEAL (in-game dialogue, triggered by proximity)

Trigger: Kael's centre within 28 px of the elder, only once per run. Replace the current
toast (`main.js` ~line 515) with this sequence:

1. Lock player input. Kael stops (ease vx to 0 over 0.15 s), plays idle, and faces the
   elder. The camera eases (0.5 s) so both characters are centred.
2. Letterbox bars slide in (same bars as cutscenes), the level keeps rendering behind.
3. Dialogue boxes at the bottom with a **portrait** on the speaker's side: Kael's portrait
   on the left, the elder's on the right. Portraits are the head-and-shoulders crop of
   the idle frame from each atlas (`kael`, `goodwitch`), scaled x3 with NEAREST, inside a
   1 px frame in the level accent colour. Speaker name above the text.
4. At the marked lines, the full-screen panel (section 1 style) fades in over the level
   and the dialogue continues on top of it; at the next unmarked line it fades back to
   the level.

| show | speaker | ES | EN |
|---|---|---|---|
| panel 03 | ANCIANO / ELDER | Buenas noches, guardián. ¿Otra noche larga? | Good evening, warden. Another long night? |
| panel 03 | KAEL | ¿Quién eres? Nadie pasa por este camino. | Who are you? No one walks this path. |
| level | ANCIANO / ELDER | Solo un viejo mercader. Y tú, un muchacho cansado de cuidar una luz que no es suya. | Just an old merchant. And you, a boy tired of guarding a light that isn't his. |
| level | ANCIANO / ELDER | Mira. Oro, joyas... y hay mucho más. Riqueza sin fin. | Look. Gold, jewels... and there is so much more. Endless wealth. |
| panel 04 | KAEL | ¿Y qué quieres a cambio? | And what do you want in return? |
| panel 04 | ANCIANO / ELDER | Casi nada. Que mires hacia otro lado esta noche. Solo una noche. | Almost nothing. Look the other way tonight. Just one night. |
| panel 04 | KAEL | ...Una noche. | ...One night. |

## 5. THE THEFT (cutscene right after the deal)

Plays as a normal cutscene (section 1), then returns to L1.

| panel | speaker | ES | EN |
|---|---|---|---|
| 05 | — | Esa noche, el anciano entró al santuario. | That night, the old man entered the shrine. |
| 05 | ANCIANO / ELDER | Gracias, guardián. Con esta luz, el Antiguo despertará. | Thank you, warden. With this light, the Ancient One will wake. |
| 06 | — | La Brasa se apagó. El bosque empezó a morir. | The Ember went out. The forest began to die. |
| 06 | KAEL | Fue mi culpa. Voy a traerla de vuelta. | This was my fault. I will bring it back. |

After it ends:
- The elder is removed from the level (he is gone with the Ember). Spawn a small puff of
  toxic-green particles where he stood, visible when control returns.
- Player input unlocks, letterbox bars slide out, camera eases back to normal follow.
- Remove the old `intro` and `theft` scripts and their strings if nothing else uses them.
  Leave `reveal`, `waking`, `return` untouched (later stages), but if any of their lines
  contradict this story (e.g. the theft happening elsewhere), list them in your report
  instead of changing them.

## Acceptance

Add `tools/story.mjs` (Playwright, port 8765) that plays: menu → Nueva partida → prologue
→ walk right to the elder → dialogue → theft → control back. Save screenshots to
`.scratch/stage2/`:

1. `prologue-01.png` — panel 01 image visible with its text, letterbox bars.
2. `elder-waiting.png` — L1 before the trigger: elder on the ground at x≈30 tiles,
   facing left toward Kael, no enemy near.
3. `deal-portraits.png` — in-game dialogue with both portraits and a speaker name.
4. `deal-panel-04.png` — panel 04 over the level with a Kael line.
5. `theft-06.png` — panel 06 with Kael's line.
6. `after.png` — control back, elder gone, green puff visible.
7. Same run with `?lang=en` (or the EN toggle): `deal-portraits-en.png` shows English.
8. `Esc` during the prologue skips straight to L1 play (log it).
9. Zero console errors. `tools/reach.mjs` still passes.

Read every screenshot yourself before reporting. Report the 9 checks pass/fail.
Commit `Stage 2: prologue, elder deal, theft cutscene with real art`.
