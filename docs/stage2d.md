# Stage 2d — Four new panels, less reuse

Nico added `assets/cutscenes/07.png` … `10.png` (07-09: 1024x1024, 10: 2750x1536; they
are JPEG data with a .png name, browsers handle that, do not rename or convert). Same
rules: `assets/` read-only, only what is written here. Commit and stop.

Preload 07-10 with the others. Remap the deal and theft scripts to exactly this
(text unchanged from stage 2; only the `show` column changes):

## THE DEAL

| show | speaker | line (ES key content) |
|---|---|---|
| level (portraits) | ANCIANO | Buenas noches, guardián. ¿Otra noche larga? |
| 03 | KAEL | ¿Quién eres? Nadie pasa por este camino. |
| 07 | ANCIANO | Solo un viejo mercader. Y tú, un muchacho cansado… |
| 08 | ANCIANO | Mira. Oro, joyas... y hay mucho más. Riqueza sin fin. |
| 04 | KAEL | ¿Y qué quieres a cambio? |
| 04 | ANCIANO | Casi nada. Que mires hacia otro lado esta noche… |
| 09 | KAEL | ...Una noche. |

## THE THEFT

| show | speaker | line |
|---|---|---|
| 05 | — | Esa noche, el anciano entró al santuario. |
| 05 | ANCIANO | Gracias, guardián. Con esta luz, el Antiguo despertará. |
| 10 | — | La Brasa se apagó. El bosque empezó a morir. |
| 06 | KAEL | Fue mi culpa. Voy a traerla de vuelta. |

Acceptance: rerun `tools/story.mjs`, screenshots of panels 07, 08, 09, 10 in
`.scratch/stage2d/`, read them yourself, zero console errors.
Commit `Stage 2d: panels 07-10 in the deal and theft`.
