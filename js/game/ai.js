import { AI, DIFFICULTY } from '../core/config.js';
import { clamp } from '../core/rng.js';

// Adaptive enemy AI.
//
// Every agent runs the same three-stage loop on a fixed tick:
//   sense  -> what can it perceive right now
//   decide  -> what to do, weighted by what the player has been doing
//   act    -> commit to it for a window
//
// The interesting part is the player model. Every meaningful thing the player
// does is pushed into a rolling window of the last 20 actions, and the agents
// read that window to bias their weights. A player who dashes out of everything
// gets baited instead of hit; a player who stands and trades gets punished for
// it.
//
// The ceiling is deliberate and structural, not a tunable. Adaptation happens
// strictly inside a band around the chosen difficulty and the resulting scalar
// is hard-clamped to never exceed 1.0, so the game can get sharper at reading
// you without ever getting harder than the option you picked. Fairness caps are
// separate from, and stricter than, adaptation.

// ---------------------------------------------------------------- player model

export class PlayerModel {
  constructor() { this.reset(); }

  reset() {
    this.window = [];
    this.ids = 0;
  }

  record(type, data = {}) {
    this.window.push({ type, t: this.ids++, ...data });
    if (this.window.length > AI.memory) this.window.shift();
  }

  get count() { return this.window.length; }

  // Recency-weighted counts: what the player is doing *now* matters more than
  // what they did nineteen actions ago, so entries are weighted by how recently
  // they landed in the window.
  _weighted(type) {
    let sum = 0, total = 0;
    const n = this.window.length;
    for (let i = 0; i < n; i++) {
      const w = (i + 1) / n;
      total += w;
      if (this.window[i].type === type) sum += w;
    }
    return total > 0 ? sum / total : 0;
  }

  // 0 = never evades, 1 = evades constantly.
  get dodgeBias() {
    return clamp(this._weighted('dash') * 0.65 + this._weighted('jump') * 0.35, 0, 1);
  }

  // 0 = passive, 1 = mashing.
  get aggression() {
    return clamp(this._weighted('attack'), 0, 1);
  }

  // How often the player repeats the same action as last time. High means
  // exploitable; agents lean harder on their counters when this is high.
  get predictability() {
    if (this.window.length < 4) return 0;
    let same = 0;
    for (let i = 1; i < this.window.length; i++) {
      if (this.window[i].type === this.window[i - 1].type) same++;
    }
    return clamp(same / (this.window.length - 1), 0, 1);
  }

  // The dominant recent pattern, used to pick a counter.
  get tendency() {
    if (!this.window.length) return 'neutral';
    const counts = {};
    for (const a of this.window) counts[a.type] = (counts[a.type] || 0) + 1;
    let best = 'neutral', bestN = 0;
    for (const [k, v] of Object.entries(counts)) if (v > bestN) { best = k; bestN = v; }
    return bestN / this.window.length > 0.4 ? best : 'neutral';
  }

  // Net drift over the window, so the Patient One can extrapolate motion.
  drift() {
    let dx = 0;
    for (const a of this.window) if (typeof a.dx === 'number') dx += a.dx;
    return this.window.length ? dx / this.window.length : 0;
  }

  // Where the player was, as a short trail. The Patient One walks this to work
  // out where the lantern-light is going.
  trail() {
    return this.window.filter((a) => typeof a.x === 'number').map((a) => ({ x: a.x, y: a.y, t: a.t }));
  }
}

// -------------------------------------------------------------- the governor

export class Governor {
  constructor(difficultyKey) {
    this.diffKey = DIFFICULTY[difficultyKey] ? difficultyKey : 'normal';
    this.base = DIFFICULTY[this.diffKey].scalar;
    this.adapt = 0;           // -band .. +band, drifts toward 0
    this.tick = 0;
  }

  get cfg() { return DIFFICULTY[this.diffKey]; }
  get reaction() { return Math.max(0.08, this.cfg.reaction / this.scalar); }

  // Effective scalar, hard-clamped to the chosen ceiling. The clamp is the
  // promise made to the player: adaptation never exceeds the option selected.
  get scalar() {
    return clamp(this.base * (1 + this.adapt), 0, this.base);
  }

  update(model) {
    this.tick++;
    // Every few seconds, drift the adaptation toward whatever the player model
    // suggests. Slow on purpose: a boss that instantly matches you reads as
    // cheating, one that adapts over ~6s reads as learning.
    if (this.tick % 60 !== 0) return;

    const target = clamp(
      (model.aggression - 0.5) * this.cfg.band * 1.2 - (model.dodgeBias - 0.5) * this.cfg.band,
      -this.cfg.band, this.cfg.band);
    this.adapt += (target - this.adapt) * 0.25;
    this.adapt = clamp(this.adapt, -this.cfg.band, this.cfg.band);
  }

  // Exposed for the HUD/debug so the ceiling is inspectable rather than implied.
  describe() {
    return { difficulty: this.diffKey, base: this.base, adapt: +this.adapt.toFixed(3), scalar: +this.scalar.toFixed(3) };
  }
}

// ------------------------------------------------------------------- the agent

export class Agent {
  constructor(opts = {}) {
    this.model = opts.model;               // shared PlayerModel
    this.governor = opts.governor;         // shared Governor
    this.self = opts.self;

    this.accum = 0;
    this.phase = 'idle';                   // idle | act
    this.phaseTimer = 0;
    this.action = null;

    this.sense = { dist: 0, dx: 0, dy: 0, los: false, playerState: 'neutral' };
    this.threat = 0;

    // fairness state
    this.lastAttackAt = -999;
    this.time = 0;
    this.reactionArmed = false;
  }

  // --- stage 1
  perceive(player, level, clock) {
    const s = this.sense;
    const dx = player.cx - this.self.cx;
    const dy = player.cy - this.self.cy;
    s.dx = dx; s.dy = dy;
    s.dist = Math.hypot(dx, dy);
    s.playerState = player.dead ? 'dead'
      : player.isDashing ? 'dash'
      : player.isAttacking ? 'attack'
      : !player.onGround ? 'air' : 'ground';
    s.los = this._hasLineOfSight(player, level);
    s.clock = clock;
    return s;
  }

  _hasLineOfSight(player, level) {
    // Cheap grid march between the two centres. Good enough for tick-rate
    // decisions and avoids allocating a raycast every 100ms per agent.
    const steps = Math.ceil(this.sense.dist / 8);
    if (steps === 0) return true;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = this.self.cx + (player.cx - this.self.cx) * t;
      const y = this.self.cy + (player.cy - this.self.cy) * t;
      const tx = Math.floor(x / 8), ty = Math.floor(y / 8);
      if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) return false;
      if (level.grid[ty * level.width + tx] === 1) return false;
    }
    return true;
  }

  // --- stage 2
  //
  // `weights` is the agent's own base preference. Adaptation re-weights it; it
  // never replaces it, so an agent can never be talked into an action its design
  // does not have.
  decide(player, weights) {
    const m = this.model;
    const g = this.governor;
    const s = this.sense;
    const out = {};
    for (const [k, w] of Object.entries(weights)) out[k] = w;

    // Counter-dodge: a player who evades a lot is dealt with by delaying rather
    // than committing into the dash. The delay scales with their dodge bias, so
    // the harder they try to avoid hits, the more the boss waits.
    if (s.playerState === 'dash' || m.dodgeBias > 0.4) {
      out.bait = (out.bait ?? 0) + m.dodgeBias * 1.6 * g.scalar;
      out.attack = (out.attack ?? 0) * (1 - m.dodgeBias * 0.55);
    }

    // Counter-aggression: a masher is met with spacing and a faster commit.
    if (m.aggression > 0.5) {
      out.approach = (out.approach ?? 0) + m.aggression * 0.9 * g.scalar;
      out.retreat = (out.retreat ?? 0) + m.aggression * 0.5;
    }

    // Counter-predictability: a repetitive player gets their tendency answered.
    if (m.predictability > 0.55) {
      switch (m.tendency) {
        case 'attack': out.attack = (out.attack ?? 0) * 1.5; break;
        case 'dash':   out.bait = (out.bait ?? 0) * 1.6; break;
        case 'jump':   out.antiAir = (out.antiAir ?? 0) + 1.2 * g.scalar; break;
        default: break;
      }
    }

    // Phase: attacking is only ever an option through this gate, so a single
    // change to the guards constrains every agent in the game.
    if (!this._attackAllowed(player, s)) {
      delete out.attack;
      delete out.antiAir;
    }

    let total = 0;
    for (const v of Object.values(out)) total += Math.max(0, v);
    if (total <= 0) return { key: 'idle', weights: out };
    let roll = Math.random() * total;
    for (const [k, v] of Object.entries(out)) {
      roll -= Math.max(0, v);
      if (roll <= 0) return { key: k, weights: out };
    }
    return { key: 'idle', weights: out };
  }

  // --- fairness gates. Every one of these is a hard rule, not a weight.
  _attackAllowed(player, s) {
    const g = this.governor;

    // Never swing into i-frames. Hitting a player who is untouchable is the
    // single most unfair thing an action game can do.
    if (AI.noAttackDuringIframes && player.isInvulnerable) return false;
    if (player.dead) return false;

    // Minimum gap between committed attacks.
    if (this.time - this.lastAttackAt < AI.minAttackGap) return false;

    // Off-screen grace: an agent that cannot see the player does not commit.
    if (!s.los) return false;

    // Reaction delay, scaled by difficulty and stretched by how much the player
    // has been evading. This is the floor that makes the boss feel like it is
    // reacting rather than reading minds.
    const reaction = g.reaction * (1 + this.model.dodgeBias * 0.8);
    if (this.time - this.lastAttackAt < reaction) return false;

    return true;
  }

  markAttack() { this.lastAttackAt = this.time; }

  // --- stage 3
  update(dt, player, level, weights, onAct) {
    this.time += dt;
    this.accum += dt;

    const period = 1 / AI.tickHz;
    if (this.accum >= period) {
      this.accum %= period;
      this.perceive(player, level, this.time);

      if (this.phase === 'idle') {
        const d = this.decide(player, weights);
        this.action = d.key;
        this.phase = 'act';
        // Actions have a window; the next decide happens when it expires.
        this.phaseTimer = (typeof weights[`${d.key}_hold`] === 'number' ? weights[`${d.key}_hold`] : 0.5)
                         / this.governor.scalar;
        if (onAct) onAct(d.key, d.weights);
      } else {
        this.phaseTimer -= period;
        if (this.phaseTimer <= 0) {
          this.phase = 'idle';
          this.action = null;
        }
      }
    }
    return this.action;
  }
}

// --------------------------------------------------------- light-path prediction

// Used by the Patient One. It does not track the player; it tracks the path the
// player's light is travelling, which means standing still in the dark is a
// valid tactic and so is moving predictably.
export function predictLight(agent, model, horizon) {
  const trail = model.trail();
  if (trail.length < 3) return null;

  const last = trail[trail.length - 1];
  const prev = trail[trail.length - 2];
  const dt = Math.max(1, last.t - prev.t);
  const vx = (last.x - prev.x) / dt;
  const vy = (last.y - prev.y) / dt;

  return {
    x: last.x + vx * horizon,
    y: last.y + vy * horizon,
    vx, vy,
    // Confidence falls off with how straight the recent path has been. A player
    // who is weaving should not be reliably hit by a lead-the-target read.
    confidence: clamp(1 - model.predictability * 0.3, 0, 1),
  };
}
