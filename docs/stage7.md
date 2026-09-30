# Stage 7 — Game metrics (what the professor asked: "metrics apply to games too")

The adaptive AI already exists and is proven by `node tools/gateai.mjs` (do not touch `js/game/ai.js`).
What is missing is player metrics: a small analytics layer, stored locally and forwarded to
Google Analytics when a measurement id is configured, plus a screen that shows them.

Done when `node tools/gate7.mjs` prints GATE PASS. Run it, read the FAIL lines, fix, repeat. Do not edit the gate.
The game is served on http://localhost:8765 (do not start a server). Do not run `git commit`.

## Files you may edit
`js/core/metrics.js` (NEW), `js/core/config.js` (one constant), `js/main.js`, `js/ui/hud.js`, `js/ui/strings.js`, `index.html`, `css/*.css`. Nothing else.

## 1. js/core/metrics.js
```js
const KEY = 'lumenfall.metrics.v1';     // localStorage: JSON { events: [...] }, keep at most 2000
export class Metrics {
  constructor()                // load from localStorage inside try/catch; start with { events: [] } on any error
  track(name, params = {})     // push { name, t: Date.now(), ...params }; save (try/catch); if typeof window.gtag === 'function' call window.gtag('event', name, params)
  reset()                      // empty the events and save
  get events()                 // the array
  summary()                    // see below
}
export function loadGoogleAnalytics(id)  // if id is a non-empty string: define window.dataLayer and window.gtag (push arguments), inject <script async src="https://www.googletagmanager.com/gtag/js?id=ID">, then gtag('js', new Date()); gtag('config', id). If id is empty do NOTHING (no script, no request).
```
`summary()` returns exactly:
```js
{ sessions,                                   // count of 'session_start'
  levelStarts:   { 1: n, 2: n, 3: n },        // 'level_start' by params.level
  levelCompletes:{ 1: n, 2: n, 3: n },        // 'level_complete'
  completionRate:{ 1: 0..1, 2: 0..1, 3: 0..1 }, // completes / starts, 0 when starts is 0
  deathsByLevel: { 1: n, 2: n, 3: n },        // 'player_death' by params.level
  deathsByZone:  { '1:3': n, ... },           // key `${level}:${zone}`
  avgSecondsByLevel: { 1: mean of level_complete.seconds, 2: ..., 3: ... }, // 0 when none
  bossesDefeated: { statue: n, ulburjo: n, patientone: n },
  gamesCompleted: n }                         // 'game_complete'
```
All three level keys (1, 2, 3) and all three boss keys always exist, with 0 when empty.
`js/core/config.js`: add `export const GA_MEASUREMENT_ID = '';` (empty on purpose: the team sets the real `G-XXXXXXXXXX`).

## 2. Wiring in js/main.js
Create `this.metrics = new Metrics()` in the constructor (so `window.__lumenfall.metrics` exists) and call `loadGoogleAnalytics(GA_MEASUREMENT_ID)` once. Events (names and params exact):
- `session_start` {} once when the Game is constructed.
- `level_start` { level } (1..3) every time a level begins play, INCLUDING the `?level=N` debug entry. Reset `this.levelClock = 0` and `this.levelDeaths = 0` there; add `dt` to `levelClock` while playing.
- `player_death` { level, zone, cause } once per death (not per frame). `zone = Math.floor(player tile x / 20)` where tile x = `player.body.x / 8`. `cause`: `'pit'` when `p.pitDeath`, otherwise `'hp'`. Increment `this.levelDeaths`.
- `boss_defeated` { boss, seconds, deaths } once when the boss dies (`'statue'|'ulburjo'|'patientone'`, seconds = `levelClock`).
- `level_complete` { level, seconds, deaths } when a level ends and the next one (or the ending) starts.
- `game_complete` { seconds, deaths } when the ending screen shows (seconds = sum of the level seconds).

## 3. The metrics screen
- Menu button `id="menu-metrics"`, label `t('menuMetrics')`, after the controls button.
- Overlay `id="metrics-panel"`, hidden by default (`display:none`), shown when the button is clicked. Content: title `t('metricsTitle')`; a table with one row per level 1..3 and columns level, starts, completes, completion % (e.g. `50%`), deaths, average time (`m:ss`); below it the 5 zones with most deaths (`1:3 -> 2`); when there are no events show `t('metricsEmpty')`. A close button `id="metrics-close"`; `Esc` also closes it. Reuse the existing UI classes/colours.
- Strings in BOTH languages in `js/ui/strings.js`: `menuMetrics, metricsTitle, metricsLevel, metricsStarts, metricsCompletes, metricsRate, metricsDeaths, metricsAvgTime, metricsZones, metricsClose, metricsEmpty`. `node tools/gatei18n.mjs` must still pass.
