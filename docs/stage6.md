# Stage 6 — Real art for the three remaining cutscenes

Nico added panels `assets/cutscenes/11.png` ... `19.png` (all PNG now, read-only). The
scripts `reveal`, `waking` and `return` in `js/ui/cutscene.js` still use the old CSS art ids
(`ulburjo`, `demon`, `dark`, `ember`, `kael`, `green`). Point them at the images.

Done when `node tools/gate6.mjs` prints GATE PASS. Run it, read the FAIL lines, fix, repeat.
Do not edit the gate. The game is served on http://localhost:8765 (do not start a server).
Do not run `git commit`.

## Files you may edit (nothing else)
`js/ui/cutscene.js`. You may also delete the now-unused `.panel-art[data-art="..."]` gradient rules in `css/` only if nothing else uses them.

## 1. Preload
`PANEL_IDS` (line ~14) currently lists `'01'` ... `'10'`. Add `'11'` ... `'19'`.

## 2. The mapping (art ids exact, strings keys unchanged)
```js
reveal: [
  { art: '11', titleKey: 'cs3Title', textKey: 'cs3a' },
  { art: '12', titleKey: 'cs3Title', textKey: 'cs3b' },
  { art: '13', titleKey: 'cs3Title', textKey: 'cs3c' },
],
waking: [
  { art: '14', titleKey: 'cs4Title', textKey: 'cs4a' },
  { art: '14', titleKey: 'cs4Title', textKey: 'cs4b' },
  { art: '15', titleKey: 'cs4Title', textKey: 'cs4c' },
],
return: [
  { art: '16', titleKey: 'cs5Title', textKey: 'cs5a' },
  { art: '17', titleKey: 'cs5Title', textKey: 'cs5b' },
  { art: '18', titleKey: 'cs5Title', textKey: 'cs5c' },
  { art: '19', titleKey: 'cs5Title', textKey: 'cs5d' },
  { art: '19', titleKey: 'cs5Title', textKey: 'cs5e' },
],
```
Replace only those three entries inside `CUTSCENES`; leave `prologue`, `deal`, `theft` and everything else untouched.

## 3. Nothing else
Panel 15 is deliberately almost black (Kael in the dark): do not brighten it. Panels 14 and 19 are each shown for two lines: that is intended.
