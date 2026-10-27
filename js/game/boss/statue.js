import { Boss } from './base.js';
import { audio } from '../../core/audio.js';

// L1 boss: the Marble Mummy. The tutorial boss, so it teaches the one thing the
// rest of the game asks for -- that an attack is a thing you can see coming.
//
// Every attack is the same three stages: windup (planted, red marker blinking
// on the floor), active (the damage, decided on ONE frame) and recover (still,
// safe to hit). Nothing outside `active` can hurt the player, which is what
// makes standing beside a winding-up boss a legitimate thing to do. Phase 2
// scales every windup up and adds the roots, the one attack that cannot be
// answered by swinging back.

const WEIGHTS = {
  chase: 1.0,
  swing: 1.0,
  slam: 0.7,
  idle: 0.6,
  swing_hold: 0.75,
  slam_hold: 0.9,
};

// [windup, active, recover], in seconds. The recover is the longest part of a
// swing on purpose: it is the player's window to punish.
const T = { swing: [0.65, 0.14, 0.80], slam: [0.85, 0.14, 1.00], roots: [0.90, 0.20, 0.90] };
const P2_WINDUP = 0.8;      // phase 2 multiplies every windup by this
const AFTER_ATTACK = 0.35;  // pause after recover before the next decision
const ROOTS_COOLDOWN = 4.0;

export class Statue extends Boss {
  constructor(opts) {
    super({
      ...opts,
      nameKey: 'bossStatue',
      w: 26, h: 46,
      hp: 12,
      phases: 2,
      contactDmg: 1,
    });
    this.body.x = opts.x;
    this.body.y = opts.y;
    this.homeX = opts.x;
    // The attack in flight, or null. `stage`/`t`/`dur` are the clock; `tx` is
    // where the player was when the windup began, which is the only fair target
    // for the roots -- re-aiming them at the end would be undodgeable.
    this.atk = null;
    this.atkLog = [];
    this.pause = 0;
    this.rootsCd = 2;
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

    const action = this.think(dt, player, level, WEIGHTS);
    const dx = player.cx - this.cx;
    // Tracking stops when the windup does. A swing that re-aimed on the frame
    // it lands would make the dodge -- the one the whole tell exists to allow --
    // not work.
    if (!this.atk || this.atk.stage === 'windup') this.facing = dx >= 0 ? 1 : -1;
    this.pause = Math.max(0, this.pause - dt);
    this.rootsCd = Math.max(0, this.rootsCd - dt);

    if (this.state === 'phase') this.body.vx = 0;
    else if (this.atk) this._runAttack(dt, player);
    else if (this.pause <= 0) this._decide(action, player, dx);
    else this.dampVx(0.8);

    this.integrate(dt, level);
    this._animate(dt, action);
  }

  _decide(action, player, dx) {
    // Roots come first in phase 2, and only from far enough away to be worth
    // the windup: at point-blank they would just be a second swing with a
    // different shape.
    if (this.phase >= 2 && this.rootsCd <= 0 && Math.abs(dx) > 50) { this._begin('roots', player); return; }
    if (action === 'swing' || action === 'slam') { this._begin(action, player); return; }
    if (action === 'chase') { this.body.vx = Math.sign(dx) * (26 + this.phase * 4); return; }
    this.dampVx(0.9);
  }

  _begin(name, player) {
    this.atk = {
      name,
      stage: 'windup',
      t: 0,
      dur: T[name][0] * (this.phase >= 2 ? P2_WINDUP : 1),
      tx: player.cx,
    };
    this.body.vx = 0;
    this._log();
    audio.sfxWarn();

    // The markers are the promise: same ground, same width, same lifetime as
    // the hit box that is coming, for as long as the player has to move.
    const y = this.body.bottom;
    if (name === 'swing') {
      this.fx.telegraph(this.cx + this.facing * 28, y, 30, 8, this.atk.dur);
    } else if (name === 'slam') {
      this.fx.telegraph(this.cx, y, 80, 14, this.atk.dur);
    } else {
      for (const x of [this.atk.tx - 14, this.atk.tx, this.atk.tx + 14]) {
        this.fx.telegraph(x, y, 12, 40, this.atk.dur);
      }
    }
  }

  _log() {
    const a = this.atk;
    this.atkLog.push({ name: a.name, stage: a.stage, dur: a.dur, phase: this.phase });
  }

  _runAttack(dt, player) {
    const a = this.atk;
    a.t += dt;
    // The lunge belongs to the active window and nothing else, so the boss can
    // never drift into the player during its own tell.
    this.body.vx = a.name === 'swing' && a.stage === 'active' ? this.facing * 60 : 0;

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
      if (a.name === 'roots') this.rootsCd = ROOTS_COOLDOWN;
    }
  }

  _strike(a, player) {
    const rects = [];
    if (a.name === 'swing') {
      audio.sfxSlash();
      this.fx.slashArc(this.cx + this.facing * 12, this.body.bottom + 24, this.facing, 0xbfe8d0);
      rects.push(this.hurtRect());
    } else if (a.name === 'slam') {
      audio.sfxHit();
      this.fx.burst(this.cx, this.body.bottom, 0x8fbfa0, 14, 90);
      this.fx.dust(this.cx, this.body.bottom);
      rects.push({ left: this.cx - 40, right: this.cx + 40, bottom: this.body.bottom, top: this.body.bottom + 14 });
    } else {
      for (const x of [a.tx - 14, a.tx, a.tx + 14]) {
        this.fx.burst(x, this.body.bottom, 0xbfe8d0, 10, 70);
        rects.push({ left: x - 6, right: x + 6, bottom: this.body.bottom, top: this.body.bottom + 40 });
      }
    }

    if (player.dead || player.isInvulnerable) return;
    for (const r of rects) {
      if (player.body.left < r.right && player.body.right > r.left &&
          player.body.bottom < r.top && player.body.top > r.bottom) {
        player.hurt();
        return;
      }
    }
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
  }

  _animate(dt, action) {
    if (this.dead) { this.sprite.update(dt); return; }
    this.sprite.setFacing(this.facing);
    if (this.state === 'phase') this.sprite.play('roots', { speed: 6 });
    else if (this.atk) {
      // Restarted on the strike: play() is a no-op while the clip is unchanged,
      // and the active window is 0.14s, so the follow-through has to start
      // there for the speed to be worth anything.
      if (this.atk.stage === 'windup') this.sprite.play('sweep', { speed: 3 });
      else if (this.atk.stage === 'active') this.sprite.play('sweep', { speed: 12, restart: true });
      else this.sprite.play('idle', { speed: 3 });
    } else if (Math.abs(this.body.vx) > 4) this.sprite.play('walk', { speed: 5 });
    else this.sprite.play('idle', { speed: 3 });
    this.sprite.update(dt);
  }
}
