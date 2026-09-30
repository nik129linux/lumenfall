# Stage 9 — README for the team and the professor

Rewrite `README.md` so a teammate can run, understand and finish the game, and a professor can
see what was built and why. Write it in English. Read the code before writing each section:
do not invent keys, files or numbers.

Done when `node tools/gate9.mjs` prints GATE PASS. Run it, read the FAIL lines, fix, repeat. Do not edit the gate.
Do not run `git commit`. You may edit only `README.md`.

## Required headings (exact text, in this order)
`# LUMENFALL`, `## Run it`, `## Controls`, `## Story`, `## Levels and bosses`, `## Adaptive AI`, `## Metrics`, `## Project structure`, `## Tests`, `## Known limitations`, `## Credits`

## Content rules
- **Run it**: static files only; `python3 -m http.server 8000` then open `http://localhost:8000`; explain why `file://` does not work (ES modules).
- **Controls**: a table with the REAL bindings from `js/core/input.js`. Include the words Move, Jump, Attack, Dash, Rotate, Pause and the menu keys.
- **Story / Levels**: 3 levels, the three bosses (Marble statue, Ul Burjo, The Patient One), what each level's mechanic is (fixed map, 90 degree world rotation, near-total darkness with only the sword's light), and the opening (prologue, the elder's deal, the theft).
- **Adaptive AI**: explain sense -> decide -> act, the rolling window of the last 20 player actions (`PlayerModel` in `js/game/ai.js`), how agents counter a dodger, a masher and a jump spammer, the difficulty governor (Easy / Normal / Hard) that can never exceed the chosen difficulty, the fairness caps (no attacks during i-frames, minimum gap between attacks, line of sight), and the boss attack contract (windup, active, recover, with a warning marker). Say how it is verified: `node tools/gateai.mjs`.
- **Metrics**: the events (`session_start`, `level_start`, `level_complete`, `player_death`, `boss_defeated`, `game_complete`), where they are stored (`localStorage`, key `lumenfall.metrics.v1`), the in-game Metrics screen, and how to turn on Google Analytics (set `GA_MEASUREMENT_ID` in `js/core/config.js`; it is empty on purpose).
- **Project structure**: a short tree of `js/`, `assets/`, `tools/`, `docs/` with one line per folder. Every path you write in backticks must exist.
- **Tests**: the commands `node tools/gate3a.mjs`, `gate3b`, `gate4`, `gate5`, `gate6`, `gate7`, `gateai`, `gatei18n`, `node tools/reach.mjs` with one line each on what it proves; say the game must be served on port 8765 for the browser ones.
- **Known limitations**: be honest (for example: the art is AI-generated; the game has been tested by automated checks and short human play; Google Analytics needs the team's own id).
- **Credits**: Three.js (vendored), art generated with AI image tools from the team's own reference sheets, code built with AI coding agents under human direction. Leave a line `Team: (add names)`.
- At most 250 lines.
