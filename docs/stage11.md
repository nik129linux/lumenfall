# Stage 11 — Watch any cutscene directly (for the team, the demo and the professor)

Nico cannot see cutscene panels 11-19 without beating three bosses. Add a URL parameter that
plays one cutscene straight away.

Done when `node tools/gate11.mjs` prints GATE PASS. Run it, read the FAIL lines, fix, repeat. Do not edit the gate.
The game is served on http://localhost:8765 (no new server). Do not run `git commit`.

## Files you may edit
`js/main.js`, `js/ui/hud.js` (only if the menu needs a line), `README.md` (one line, see the end). Nothing else.

## Behaviour
- `index.html?cutscene=KEY` with KEY one of `prologue`, `theft`, `reveal`, `waking`, `return`: the game boots, skips the menu, and plays `buildScript(KEY)` immediately (use the existing `playCutscene` / `cutscene.play`, state CUTSCENE, the ui `cutscene` view shown, the HUD hidden).
- When it ends (or the player presses Esc) go back to the MENU (`this.machine.to(S.MENU); this.ui.show('menu')`), do NOT start a level.
- The dealing scene (`deal`, which happens in game next to the elder) is not a cutscene key: do not handle it.
- An unknown KEY is ignored: the normal menu opens, no error.
- Handle the parameter inside `_applyUrlParams()` next to the existing `?level=` / `?boss=` handling. Do not change what `?level=` and `?boss=` do.
- README: in the Controls section add one line: `Watch a cutscene directly: index.html?cutscene=prologue|theft|reveal|waking|return`.
