# Stage 10 — The between-level cutscenes play in the wrong place

Nico noticed that not all the cutscene art shows up. Measured cause, in `js/main.js`:

```js
const BOSS_INTRO = { 1: 'intro', 2: 'reveal', 3: 'waking' };          // line ~32
...
_onBossDefeated() { ...
  this.levelIndex++;                                                    // 0-based: becomes 1 after level 1, 2 after level 2
  ...
  this.cutscene.play(buildScript(BOSS_INTRO[this.levelIndex] || 'theft'), ...)   // line ~989
```
`levelIndex` is 0-based but `BOSS_INTRO` is keyed 1..3, so everything is shifted by one:
after level 1 the OLD `intro` script plays (CSS gradients, no painted art, old text); after level 2 the `reveal` plays (which belongs between 1 and 2); `waking` (panels 14, 15) NEVER plays; and a wrong key silently falls back to `theft`.

Done when `node tools/gate10.mjs` prints GATE PASS. Run it, read the FAIL lines, fix, repeat. Do not edit the gate.
The game is served on http://localhost:8765 (do not start a server). Do not run `git commit`.

## Files you may edit
`js/main.js`, `js/ui/cutscene.js`. Nothing else.

## What must happen
- After level 1's boss: `reveal` (panels 11, 12, 13), then level 2 starts.
- After level 2's boss: `waking` (panels 14, 14, 15), then level 3 starts.
- After level 3's boss: `return` (panels 16, 17, 18, 19, 19), then the ending (this part already works).
- Fix by keying the map by the 0-based index of the level that is ABOUT to start: `const BOSS_INTRO = { 1: 'reveal', 2: 'waking' };`
- Remove the `|| 'theft'` fallback: with the map above every reachable key exists; if a key is ever missing, skip the cutscene and call `beginPlay()` directly instead of playing a wrong one.
- Delete the old `intro` script (the three lines with `art: 'elder'`/`'kael'`) from `CUTSCENES` in `js/ui/cutscene.js`; nothing uses it any more. Do not delete the strings.
