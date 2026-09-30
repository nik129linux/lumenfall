import * as THREE from '../../vendor/three.module.js';
import { Boss } from './base.js';
import { Projectile } from '../fx.js';
import { TILE } from '../physics.js';
import { audio } from '../../core/audio.js';

// L2 boss: Ul Burjo, who was the kind elder in L1.
//
// Phase 1 is a ranged duel: he throws toxic bolts and repositions, teaching the
// arena. Phase 2 turns the arena itself into the weapon -- he rotates the room,
// which is the same mechanic the player has been using all level, now aimed at
// them. Using the player's own tool against them is the point.
//
// Same three-stage contract as the L1 statue: windup (planted, blinking marker
// on the floor) -> active (the damage, decided on ONE frame) -> recover (still,
// safe to hit). Nothing outside `active` can hurt the player, which is what
// makes standing beside a winding-up Ul Burjo a legitimate thing to do. The
// turn is the one attack with no damage of its own: the arena is the weapon.

const WEIGHTS_P1 = {
  reposition: 1.0,
  volley: 1.1,
  sweep: 0.8,
  blink: 0.9,
  bait: 0.9,
  idle: 0.5,
  volley_hold: 0.8,
  sweep_hold: 0.6,
  blink_hold: 0.5,
};

const WEIGHTS_P2 = {
  rotate: 1.2,
  volley: 1.0,
  sweep: 1.1,
  blink: 0.7,
  bait: 0.8,
  idle: 0.35,
  volley_hold: 0.6,
  sweep_hold: 0.5,
  blink_hold: 0.5,
};

// [windup, active, recover], in seconds. The recover is the longest part of a
// throw on purpose: it is the player's window to punish.
const T = {
  volley: [0.70, 0.15, 0.90],
  sweep: [0.60, 0.14, 0.80],
  blink: [0.50, 0.10, 0.70],
  rotate: [1.00, 0.10, 1.20],
};
const P2_WINDUP = 0.8;      // phase 2 multiplies every windup by this
const AFTER_ATTACK = 0.35;  // pause after recover before the next decision
const ROTATE_CD = 6.0;      // a turn at most this often, phase 2 only
const BLINK_OFFSET = 60;    // he lands this far past the player, never on them
const SWEEP_RANGE = 50;     // a sweep is a point-blank answer, not a poke
const BOLT_SPEED = 400;     // px/s: crosses the strip inside the active window
const ROTATE_MARK = 0x9b5cf0;

export class UlBurjo extends Boss {
  constructor(opts) {
    super({
      ...opts,
      nameKey: 'bossUlBurjo',
      w: 22, h: 44,
      hp: 18,
      phases: 2,
      contactDmg: 1,
    });
    this.body.x = opts.x;
    this.body.y = opts.y;
    this.homeX = opts.x;
    this.homeY = opts.y;
    this.level = opts.level;             // the Level, for the arena rotation
    // The attack in flight, or null. `stage`/`t`/`dur` are the clock; `tx` is
    // where the player was when the windup began -- the only fair thing to aim
    // at, since re-aiming on the frame it lands would be undodgeable -- and
    // `bx` is where a blink has already promised to land.
    this.atk = null;
    this.atkLog = [];
    this.pause = 0;
    this.rotateCooldown = 0;
    this.rotateRequested = false;
    this.announcedReveal = false;
  }

  get turning() { return !!this.level?.isRotating; }

  wake() {
    if (this.state !== 'sleep') return;
    this.state = 'idle';
    audio.sfxBoss();
  }

  update(dt, player, level) {
    if (this.state === 'sleep') { this.updateCommon(dt, player, level); return; }
    this.updateCommon(dt, player, level);
    if (this.dead) return;

    // First time the player sees him in phase 2, the disguise is dropped: the
    // elder's sprite swaps for the sorcerer's. Same character, revealed.
    if (this.phase === 2 && !this.announcedReveal) {
      this.announcedReveal = true;
      this.swapTo('badwitch');
    }

    // A turn of the room is the loudest tell in the game, and it moves every
    // floor marker at once -- so an attack in flight when one starts would be
    // leaving a decal pointing at the wrong patch of floor. The turn is the
    // exception: by the time the room is moving it has already said everything
    // it has to say.
    if (this.atk && this.turning) {
      this.fx.clearTelegraphs();
      if (this.atk.name !== 'rotate') { this.atk = null; this.pause = AFTER_ATTACK; }
    }

    this.rotateCooldown = Math.max(0, this.rotateCooldown - dt);
    this.pause = Math.max(0, this.pause - dt);
    const weights = this.phase === 1 ? WEIGHTS_P1 : WEIGHTS_P2;
    const action = this.think(dt, player, level, weights);
    const dx = player.cx - this.cx;
    // Tracking stops when the windup does. A cast that re-aimed on the frame it
    // landed would make the dodge -- the one the whole tell exists to allow --
    // not work.
    if (!this.atk || this.atk.stage === 'windup') this.facing = dx >= 0 ? 1 : -1;

    // Standing still through a phase change: the room is in charge and it is not
    // a moment to start something. A turn only stops him from *starting* -- the
    // attack that asked for it is still in flight and has to be allowed to land
    // its recover on schedule, or he would sit in `active` for the whole turn.
    if (this.state === 'phase' || (this.turning && !this.atk)) this.body.vx = 0;
    else if (this.atk) this._runAttack(dt, player);
    else if (this.pause <= 0) this._decide(action, player, dx);
    else this.body.vx *= 0.8;

    this.integrate(dt, level);
    this._animate(dt);
  }

  _decide(action, player, dx) {
    // The turn comes first in phase 2, and only off its cooldown: it is the
    // loudest thing in the fight and the room has to be free for it.
    if (this.phase >= 2 && this.rotateCooldown <= 0 && action === 'rotate') { this._begin('rotate', player); return; }
    if (action === 'volley' || action === 'blink') { this._begin(action, player); return; }
    // A sweep is a point-blank answer. At range it would be a second volley with
    // a different shape and no more reach, so it waits for the player to close.
    if (action === 'sweep' && Math.abs(dx) <= SWEEP_RANGE) { this._begin('sweep', player); return; }
    if (action === 'reposition') { this.body.vx = Math.sign(dx) * (24 + this.phase * 5); return; }
    this.body.vx *= 0.9;
  }

  _begin(name, player) {
    // The turn keeps its full second. The 0.8 phase-2 scaling on a 1.00s windup
    // would put it under a 0.9s floor, and this is the one attack the player has
    // to walk out of rather than dodge.
    this.atk = {
      name,
      stage: 'windup',
      t: 0,
      dur: T[name][0] * (this.phase >= 2 && name !== 'rotate' ? P2_WINDUP : 1),
      tx: player.cx,
      bx: 0,
    };
    if (name === 'blink') {
      // The far side of the player from him: he never blinks onto them, and the
      // spot is fixed now so the marker and the landing are the same place.
      const away = Math.sign(this.cx - player.cx) || 1;
      this.atk.bx = player.cx - away * BLINK_OFFSET;
    }
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
    if (a.name === 'volley') {
      this.fx.telegraph(this.cx + this.facing * 30, y, 60, 6, a.dur);
    } else if (a.name === 'sweep') {
      this.fx.telegraph(this.cx + this.facing * 28, y, 30, 8, a.dur);
    } else if (a.name === 'blink') {
      this.fx.telegraph(a.bx, y, 20, 30, a.dur);
    } else {
      // The whole patch of floor the player is standing on: a turn pins them to
      // their own spot and swings the room underneath it, so the ground they are
      // on is exactly what the marker has to cover.
      this.fx.telegraph(a.tx, y, 220, 6, a.dur, ROTATE_MARK);
    }
  }

  _log() {
    const a = this.atk;
    this.atkLog.push({ name: a.name, stage: a.stage, dur: a.dur, phase: this.phase });
  }

  _runAttack(dt, player) {
    const a = this.atk;
    a.t += dt;
    // Movement belongs to the active window and nothing else, so he can never
    // drift into the player during his own tell. The sweep's lunge is the one
    // that survives, and it is inside the window where its hit box was decided.
    this.body.vx = a.name === 'sweep' && a.stage === 'active' ? this.facing * 46 : 0;

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
    }
  }

  // One frame, one decision, and nothing in here runs again until the next
  // attack. That is what makes the marker a promise instead of a decoration.
  _strike(a, player) {
    if (a.name === 'blink') { this._blink(a); return; }
    if (a.name === 'rotate') { this._requestRotate(); return; }
    if (a.name === 'sweep') { this._sweep(player); return; }
    this._volley();
    if (this._hits(player, this._volleyRect())) player.hurt();
  }

  _hits(player, r) {
    return !player.dead && !player.isInvulnerable &&
      player.body.left < r.right && player.body.right > r.left &&
      player.body.bottom < r.top && player.body.top > r.bottom;
  }

  // A 60px strip of floor in front of him, six pixels tall: a wave to step off
  // or to clear with a jump, and the marker says exactly that much floor.
  _volleyRect() {
    const x = this.facing > 0 ? this.cx : this.cx - 60;
    return { left: x, right: x + 60, bottom: this.body.bottom, top: this.body.bottom + 6 };
  }

  // Three bolts in a vertical fan, and they live exactly as long as the active
  // window: the flight IS the attack. A slower bolt would still be in the air
  // while the boss is standing there again, which would punish a player who read
  // the marker and stepped out of the strip -- damage with no tell in front of
  // it, which is the one thing this fight is not allowed to do.
  _volley() {
    audio.sfxSlash();
    const dir = Math.sign(this.facing) || 1;
    for (let i = -1; i <= 1; i++) {
      this.fx.projectiles.push(new Projectile(this.fx.scene, this.cx + dir * 6, this.cy + 2 + i * 6,
        dir * BOLT_SPEED, i * 30, { color: 0xa86cf0, r: 3, life: T.volley[1] }));
    }
    this.fx.burst(this.cx + dir * 12, this.body.bottom + 4, 0xa86cf0, 6, 60);
  }

  _sweep(player) {
    audio.sfxSlash();
    this.fx.slashArc(this.cx + this.facing * 12, this.body.bottom + 22, this.facing, 0xc79cf0);
    if (this._hits(player, this.hurtRect())) player.hurt();
  }

  // Harmless by design: the marker is the whole attack. He leaves, the player
  // gets a free beat to reposition, and the landing spot has been on the floor
  // in plain sight for the entire windup rather than arriving on top of them.
  _blink(a) {
    this.fx.burst(this.cx, this.cy, 0xc79cf0, 12, 80);
    this.fx.burst(a.bx, this.homeY + this.body.h / 2, 0xc79cf0, 12, 80);
    if (!this._standable(a.bx)) return;
    const maxX = this.level.data.width * TILE - this.body.w;
    this.body.x = Math.max(0, Math.min(maxX, a.bx - this.body.w / 2));
    this.body.y = this.homeY;
    this.body.vx = 0;
  }

  // He does not blink into a pit. The arena has three of them and a boss that
  // teleports into one is a boss that stops existing. Standing still is a
  // legitimate outcome: the attack is the marker, not the landing.
  _standable(x) {
    const holes = this.level.data.holeCol;
    if (!holes) return true;
    for (let tx = Math.floor((x - this.body.w / 2) / TILE); tx <= Math.floor((x + this.body.w / 2) / TILE); tx++) {
      if (tx < 0 || tx >= holes.length || holes[tx]) return false;
    }
    return true;
  }

  // Drops the disguise: the elder's sheet is swapped for the sorcerer's, so the
  // reveal is the same figure in different art rather than a different model.
  swapTo(characterName) {
    const next = this.characterSet?.[characterName];
    if (!next) return;
    this.sprite.mesh.material = next.material;
    this.sprite.char = next.char;
    this.sprite.cell = next.char.cell;
    this.sprite.mesh.scale.set(next.char.cell[0], next.char.cell[1], 1);
  }

  // Asks the level to turn. The level owns the tween, so the rotation is exactly
  // the player's own mechanic with the same 0.6s timing and the same fairness.
  _requestRotate() {
    if (this.rotateRequested || !this.level) return;
    if (this.level.isRotating) return;
    // The arena is a punctuation mark, not the fight. A long cooldown keeps it
    // readable and stops the room from spinning faster than the player can
    // reorient, which is the failure mode that makes the mechanic feel unfair.
    if (this.rotateCooldown > 0) return;
    const p = new THREE.Vector3(this.cx, this.cy, 0);
    if (this.level.beginRotate(p)) {
      this.rotateRequested = true;
      this.rotateCooldown = ROTATE_CD;
      this.state = 'rotate';
      audio.sfxRotate();
    }
  }

  // Called by the game once the level rotation finishes, so the boss does not
  // spam another turn while the tween is still running.
  onRotationDone() {
    this.rotateRequested = false;
    if (this.state === 'rotate') this.state = 'idle';
    // The turn moves the boss along with the room; re-seat him on the floor.
    this.body.x = Math.floor(this.body.x / 8) * 8;
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

  _animate(dt) {
    if (this.dead) { this.sprite.update(dt); return; }
    this.sprite.setFacing(this.facing);
    if (this.state === 'phase') this.sprite.play('raise', { speed: 5 });
    else if (this.atk) {
      // Restarted on the strike: play() is a no-op while the clip is unchanged,
      // and the active window is a tenth of a second, so the follow-through has
      // to start there for the speed to be worth anything.
      const clip = this.atk.name === 'sweep' ? 'attack' : 'cast';
      if (this.atk.stage === 'windup') this.sprite.play(clip, { speed: 3 });
      else if (this.atk.stage === 'active') this.sprite.play(clip, { speed: 12, restart: true });
      else this.sprite.play('idle', { speed: 3 });
    } else if (Math.abs(this.body.vx) > 4) this.sprite.play('sway', { speed: 5 });
    else this.sprite.play('idle', { speed: 3 });
    this.sprite.update(dt);
  }
}
