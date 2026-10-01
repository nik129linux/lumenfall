// The analytics layer: a flat, append-only log of what the player actually did.
//
// Every event is stored locally first and then handed to Google Analytics if a
// measurement id is configured, so the metrics screen works on a machine that has
// never been online -- which is most of the room on presentation day.
//
// The log is the single source of truth: summary() is derived from it on every
// read, so there is no second copy of the numbers to fall out of sync.

const KEY = 'lumenfall.metrics.v1';
const MAX_EVENTS = 2000;

// One zone per 20 tiles of run. Coarse on purpose: a per-tile breakdown on a
// 190-tile level is noise, a per-20-tile one still points at the room where
// people keep falling.
const ZONE_TILES = 20;

export class Metrics {
  constructor() {
    this._events = [];
    // Private mode, a full quota or someone hand-editing the key must never take
    // the game down: an unreadable log simply starts empty.
    try {
      const raw = localStorage.getItem(KEY);
      const data = raw ? JSON.parse(raw) : null;
      if (data && Array.isArray(data.events)) {
        this._events = data.events.slice(-MAX_EVENTS);
      }
    } catch (e) {
      this._events = [];
    }
  }

  get events() { return this._events; }

  track(name, params = {}) {
    this._events.push({ name, t: Date.now(), ...params });
    if (this._events.length > MAX_EVENTS) {
      this._events.splice(0, this._events.length - MAX_EVENTS);
    }
    this._save();
    // Analytics is a guest here: a stubbed or half-loaded gtag must never break
    // the frame that happened to emit an event.
    try {
      if (typeof window.gtag === 'function') window.gtag('event', name, params);
    } catch (e) { /* analytics is best-effort */ }
  }

  reset() {
    this._events.splice(0, this._events.length);
    this._save();
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ events: this._events }));
    } catch (e) { /* private mode / quota */ }
  }

  // The tile-column a body is standing in, which is what "where people die"
  // actually means: a raw pixel coordinate would make every number unique.
  static zoneOf(tileX) { return Math.floor(tileX / ZONE_TILES); }

  summary() {
    const out = {
      sessions: 0,
      levelStarts: { 1: 0, 2: 0, 3: 0 },
      levelCompletes: { 1: 0, 2: 0, 3: 0 },
      completionRate: { 1: 0, 2: 0, 3: 0 },
      deathsByLevel: { 1: 0, 2: 0, 3: 0 },
      deathsByZone: {},
      avgSecondsByLevel: { 1: 0, 2: 0, 3: 0 },
      bossesDefeated: { statue: 0, ulburjo: 0, patientone: 0 },
      gamesCompleted: 0,
    };
    const secondsByLevel = { 1: [], 2: [], 3: [] };

    for (const e of this._events) {
      if (!e || typeof e.name !== 'string') continue;
      const lv = e.level;
      const known = lv === 1 || lv === 2 || lv === 3;
      switch (e.name) {
        case 'session_start': out.sessions++; break;
        case 'level_start':
          if (known) out.levelStarts[lv]++;
          break;
        case 'level_complete':
          if (known) {
            out.levelCompletes[lv]++;
            if (Number.isFinite(e.seconds)) secondsByLevel[lv].push(e.seconds);
          }
          break;
        case 'player_death': {
          if (known) out.deathsByLevel[lv]++;
          const key = `${lv}:${e.zone}`;
          out.deathsByZone[key] = (out.deathsByZone[key] || 0) + 1;
          break;
        }
        case 'boss_defeated':
          if (e.boss in out.bossesDefeated) out.bossesDefeated[e.boss]++;
          break;
        case 'game_complete': out.gamesCompleted++; break;
        default: break;
      }
    }

    for (const lv of [1, 2, 3]) {
      const starts = out.levelStarts[lv];
      out.completionRate[lv] = starts > 0 ? out.levelCompletes[lv] / starts : 0;
      const times = secondsByLevel[lv];
      out.avgSecondsByLevel[lv] = times.length
        ? times.reduce((a, b) => a + b, 0) / times.length
        : 0;
    }
    return out;
  }
}

// Injects gtag.js. With an empty id this does nothing at all: no tag script, no
// request, no global -- an unconfigured build must not talk to Google.
export function loadGoogleAnalytics(id) {
  if (typeof id !== 'string' || !id.trim()) return false;
  const measureId = id.trim();
  if (typeof window === 'undefined') return false;

  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() { window.dataLayer.push(arguments); };
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measureId)}`;
  document.head.appendChild(script);

  window.gtag('js', new Date());
  window.gtag('config', measureId);
  return true;
}