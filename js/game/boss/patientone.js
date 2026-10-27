import { Boss } from './base.js';
import { predictLight } from '../ai.js';
import { AI } from '../../core/config.js';
import { audio } from '../../core/audio.js';

// L3 boss: The Patient One. Gets the most AI budget because the mechanic is the
// interesting one.
//
// It does not track Kael. It tracks the *light*. In a level with no ambient
// light, the sword halo is the only thing that betrays where the player is, and
// this boss reads that halo and drops a column of dark on it. The counter-play
// falls out of that honestly: stand still in the dark and you are nearly
// invisible, but you also cannot attack, so it is a real trade rather than a
// trick.
//
// It barely moves. Every attack lands from wherever it already is, so the fight
// is about reading the floor, not about a chase -- and the darkness is the only
// thing that has to arrive.
//
// Same three-stage contract as the statue and Ul Burjo: windup (planted,
// blinking marker on the floor) -> active (the damage, decided on ONE frame) ->
// recover (still, safe to hit). Nothing outside `active` can hurt the player,
// which is what makes standing beside a winding-up Patient One a legitimate
// thing to do. `surge` is the one attack with no damage of its own: the arena
// going dark is the weapon.

const WEIGHTS_P1 = {
  // The AI calls the light-strike `strike`; the attack is logged as `lantern`,
  // which is the name the fight and the gate both use.
  strike: 1.2,
  ring: 0.9,
  cutoff: 1.0,
  drift: 0.6,
  idle: 0.35,
  strike_hold: 0.7,
  ring_hold: 0.7,
  cutoff_hold: 0.7,
  drift_hold: 0.9,
};

const WEIGHTS_P2 = {
  strike: 1.0,
  ring: 1.0,
  cutoff: 1.2,
  surge: 0.8,
  drift: 0.4,
  idle: 0.2,
  strike_hold: 0.6,
  ring_hold: 0.6,
  cutoff_hold: 0.6,
  surge_hold: 0.6,
  drift_hold: 0.8,
};

// [windup, active, recover], in seconds. The recover is the longest part of a
// strike on purpose: it is the player's window to punish.
const T = {
  lantern: [1.00, 0.15, 1.00],
  ring: [0.90, 0.20, 1.00],
  cutoff: [0.80, 0.15, 0.90],
  surge: [1.00, 0.10, 1.20],
};
const P2_WINDUP = 0.8;      // phase 2 multiplies every windup by this
const AFTER_ATTACK = 0.35;  // pause after recover before the next decision
const SURGE_CD = 6.0;       // the dark can only close in so often
const SURGE_DARK = 0.6;     // light radius during the surge
const SURGE_TIME = 3.0;     // ...and for this long afterwards
const DRIFT_SPEED = 12;     // it barely moves
const DRIFT_STOP = 60;      // and it stops well short of the player
const CUTOFF_LEAD = 0.6;    // seconds of the player's velocity the cutoff reads
const MARK = {
  lantern: { w: 16, h: 60 },
  ring: { w: 90, h: 14 },
  cutoff: { w: 20, h: 40 },
  surge: { w: 220, h: 6 },
};

export class PatientOne extends Boss {
  constructor(opts) {
    super({
      ...opts,
      nameKey: 'bossPatient',
      w: 34, h: 66,
      hp: 22,
      phases: 2,
      contactDmg: 1,
    });
    this.body.x = opts.x;
    this.body.y = opts.y;
    this.homeX = opts.x;
    this.fx = opts.fx;
    this.pipeline = opts.pipeline;

    this.opacity = 1;
    this.visionReveal = 0;
    this.lastPredicted = null;
    // The attack in flight, or null. `stage`/`t`/`dur` are the clock; `tx` is
    // where the attack was aimed when the windup began, which is the only fair
    // thing to aim at -- re-aiming on the frame it lands would be undodgeable.
    this.atk = null;
    this.atkLog = [];
    this.pause = 0;
    this.surgeCd = SURGE_CD;
    this.surgeTime = 0;
  }

  wake() {
    if (this.state !== 'sleep') return;
    this.state = 'idle';
    audio.sfxBoss();
  }

  update(dt, player, level) {
    if (this.state === 'sleep') { this.updateCommon(dt, player, level); return; }
    this.updateCommon(dt, player, level);
    if (this.dead) return;

    // The surge is a timed squeeze on the post pass rather than a hit box, so it
    // runs its own clock here. It survives the attack that cast it, a phase
    // change and even the fight ending, because a light that never came back on
    // would be a bug the player can see.
    if (this.surgeTime > 0) {
      this.surgeTime -= dt;
      if (this.surgeTime <= 0) this._restoreLight();
    }

    const weights = this.phase === 1 ? WEIGHTS_P1 : WEIGHTS_P2;
    const action = this.think(dt, player, level, weights);
    const dx = player.cx - this.cx;
    // Tracking stops when the windup does. An attack that re-aimed on the frame
    // it landed would make the dodge -- the one the whole tell exists to allow --
    // not work.
    if (!this.atk || this.atk.stage === 'windup') this.facing = dx >= 0 ? 1 : -1;
    this.pause = Math.max(0, this.pause - dt);
    this.surgeCd = Math.max(0, this.surgeCd - dt);

    if (this.state === 'phase') this.body.vx = 0;
    else if (this.atk) this._runAttack(dt, player);
    else if (this.pause <= 0) this._decide(action, player, dx);
    else this.dampVx(0.8);

    this.integrate(dt, level);

    // It is a shadow; it cannot simply stand in full opacity and strike. It is
    // dim while it drifts and it flares when an attack resolves, which is what
    // spends the tell -- the strike is what it costs to reveal itself.
    const target = this.atk ? 0.9 : 0.45 + this.visionReveal * 0.45;
    this.opacity += (target - this.opacity) * Math.min(1, dt * 5);
    this.sprite.material.userData.uniforms.alphaScale.value = this.opacity;
    this.visionReveal = Math.max(0, this.visionReveal - dt * 2);

    this._animate(dt);
  }

  _decide(action, player, dx) {
    // The surge comes first in phase 2, and only off its cooldown: it is the
    // one attack that does not hurt, so it has to be used to say something
    // about the room rather than to be a free one.
    if (this.phase >= 2 && this.surgeCd <= 0 && action === 'surge') { this._begin('surge', player); return; }
    if (action === 'strike') { this._begin('lantern', player); return; }
    if (action === 'ring' || action === 'cutoff') { this._begin(action, player); return; }
    // A drift is a shuffle, not a chase. It closes the gap a little and stops
    // well short: the patient one wins by standing still, so it must never be
    // the thing that walks the player into a hit.
    if (action === 'drift' && Math.abs(dx) > DRIFT_STOP) {
      this.body.vx = Math.sign(dx) * DRIFT_SPEED;
      return;
    }
    this.dampVx(0.9);
  }

  _begin(name, player) {
    // The read it makes while the lantern is charging: where the halo is
    // heading over the prediction horizon, and how much it trusts that. The
    // column it drops is on the halo itself, so this is a diagnosis rather than
    // an aim -- but it is the read the whole fight is named after, and it is
    // what the light path AI is there to produce.
    if (name === 'lantern') this.lastPredicted = predictLight(this.agent, this.model, AI.predictHorizon);
    this.atk = {
      name,
      stage: 'windup',
      t: 0,
      dur: T[name][0] * (this.phase >= 2 && name !== 'surge' ? P2_WINDUP : 1),
      // The lantern reads the light, the cutoff reads the body's momentum, and
      // both are frozen here so the marker and the hit box are the same patch of
      // floor.
      tx: name === 'lantern' ? player.lightX
        : name === 'cutoff' ? player.cx + player.body.vx * CUTOFF_LEAD
        : this.cx,
    };
    this.body.vx = 0;
    this.agent.markAttack();
    this._log();
    this._mark();
  }

  // The markers are the promise: same ground, same width, same lifetime as the
  // hit box that is coming, for as long as the player has to move.
  _mark() {
    const a = this.atk;
    const y = this.body.bottom;
    if (a.name === 'ring') {
      // Two strips, one either side of it. The wave leaves it, so the floor
      // under the boss is the one place it does not reach -- and it is a jump,
      // not a walk, that gets you off a fourteen-pixel strip.
      const m = MARK.ring;
      this.fx.telegraph(this.cx - m.w / 2, y, m.w, m.h, a.dur);
      this.fx.telegraph(this.cx + m.w / 2, y, m.w, m.h, a.dur);
      return;
    }
    const m = MARK[a.name];
    this.fx.telegraph(a.tx, y, m.w, m.h, a.dur);
  }

  _log() {
    const a = this.atk;
    this.atkLog.push({ name: a.name, stage: a.stage, dur: a.dur, phase: this.phase });
  }

  _runAttack(dt, player) {
    const a = this.atk;
    a.t += dt;
    // It does not move through an attack: the darkness does the travelling, so
    // it can never drift into the player during its own tell.
    this.body.vx = 0;

    if (a.t < a.dur) return;
    if (a.stage === 'windup') {
      a.stage = 'active'; a.t = 0; a.dur = T[a.name][1];
      this._log();
      this._strike(a, player);
    } else if (a.stage === 'active') {
      a.stage = 'recover'; a.t = 0; a.dur = T[a.name][2];
      this._log();
    } else {
      this.atk = null;
      this.pause = AFTER_ATTACK;
      if (a.name === 'surge') this.surgeCd = SURGE_CD;
    }
  }

  // One frame, one decision, and nothing in here runs again until the next
  // attack. That is what makes the marker a promise instead of a decoration.
  _strike(a, player) {
    if (a.name === 'surge') { this._surge(); return; }
    this.visionReveal = 1;
    this.sprite.setFlash(0.6);
    const r = this._hitRect(a);
    if (a.name === 'lantern') {
      audio.sfxSlash();
      this.fx.burst(a.tx, this.body.bottom + 6, 0xff9a3c, 8, 70);
    } else if (a.name === 'ring') {
      audio.sfxHit();
      for (const x of [this.cx - MARK.ring.w / 2, this.cx + MARK.ring.w / 2]) {
        this.fx.burst(x, this.body.bottom + 2, 0xffb060, 7, 80);
      }
    } else {
      audio.sfxSlash();
      this.fx.burst(a.tx, this.body.bottom + 6, 0x8a6cf0, 8, 70);
    }
    if (this._hits(player, r)) player.hurt();
  }

  // The lantern drops a column of dark on the halo it locked during the windup:
  // a sixteen-pixel-wide column, sixty tall, the full height of the thing it is
  // reading. Kael's body is fourteen wide, so the marker's width is the honest
  // one -- if the halo is inside it, he is inside it.
  _hitRect(a) {
    const y = this.body.bottom;
    if (a.name === 'lantern') {
      const m = MARK.lantern;
      return { left: a.tx - m.w / 2, right: a.tx + m.w / 2, bottom: y, top: y + m.h };
    }
    if (a.name === 'ring') {
      const m = MARK.ring;
      return [
        { left: this.cx - m.w, right: this.cx, bottom: y, top: y + m.h },
        { left: this.cx, right: this.cx + m.w, bottom: y, top: y + m.h },
      ];
    }
    const m = MARK.cutoff;
    return { left: a.tx - m.w / 2, right: a.tx + m.w / 2, bottom: y, top: y + m.h };
  }

  // Harmless by design: the marker across the whole floor is the attack, and
  // what lands three seconds later is not a hit but a smaller world. It closes
  // the light around the player, so the next read of the halo is a read of a
  // third of the ground -- which is the trade the whole fight is about.
  _surge() {
    audio.sfxPhase();
    this.surgeTime = SURGE_TIME;
    this.surgeCd = SURGE_CD;
    this.pipeline?.setLightScale(SURGE_DARK);
  }

  _restoreLight() {
    this.surgeTime = 0;
    this.pipeline?.setLightScale(1);
  }

  _hits(player, r) {
    if (player.dead || player.isInvulnerable) return false;
    for (const rect of [].concat(r)) {
      if (player.body.left < rect.right && player.body.right > rect.left &&
          player.body.bottom < rect.top && player.body.top > rect.bottom) return true;
    }
    return false;
  }

  // A phase change and a death are both hard interrupts: half an attack would
  // leave the player reading a tell that never resolves, so the attack and its
  // markers go together.
  enterPhase(n) {
    super.enterPhase(n);
    this.atk = null;
    this.fx.clearTelegraphs();
  }

  onDefeated() {
    super.onDefeated();
    this.atk = null;
    this.fx.clearTelegraphs();
    this._restoreLight();
  }

  _animate(dt) {
    if (this.dead) { this.sprite.update(dt); return; }
    this.sprite.setFacing(this.facing);
    if (this.state === 'phase') this.sprite.play('teleport', { speed: 6 });
    else if (this.atk) {
      // Restarted on the strike: play() is a no-op while the clip is unchanged,
      // and the active window is a tenth of a second, so the follow-through has
      // to start there for the speed to be worth anything.
      if (this.atk.stage === 'windup') this.sprite.play('raise', { speed: 3 });
      else if (this.atk.stage === 'active') this.sprite.play('raise', { speed: 12, restart: true });
      else this.sprite.play('idle', { speed: 2.5 });
    } else if (Math.abs(this.body.vx) > 4) this.sprite.play('walk', { speed: 4 });
    else this.sprite.play('idle', { speed: 2.5 });
    this.sprite.update(dt);
  }
}
