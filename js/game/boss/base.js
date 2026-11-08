import * as THREE from '../../vendor/three.module.js';
import { Body, moveX, moveY } from '../physics.js';
import { Agent } from '../ai.js';
import { audio } from '../../core/audio.js';
import { approach, damp, clamp } from '../../core/rng.js';

// Shared boss scaffolding: health, phases, the arena gate, and the contact
// damage. What each boss actually does lives in its own file.

export class Boss extends THREE.Object3D {
  constructor(opts) {
    super();
    this.nameKey = opts.nameKey;
    this.character = opts.character;
    this.model = opts.model;
    this.governor = opts.governor;
    this.fx = opts.fx;
    this.audio = opts.audio || audio;

    this.w = opts.w; this.h = opts.h;
    // Where the player's blade can land, centred on the body and standing on its
    // feet. The bodies are narrow (26-34 px) and the drawn bosses much wider and
    // taller, so by default it is the body and each boss passes its own.
    this.struck = opts.struck ?? { w: opts.w, h: opts.h };
    this.maxHp = opts.hp;
    this.hp = opts.hp;
    this.phase = 1;
    this.phases = opts.phases || 1;
    this.dead = false;
    this.deathTimer = 0;
    this.state = 'sleep';
    this.stateTimer = 0;
    this.hurtFlash = 0;
    this.facing = -1;
    this.contactDmg = opts.contactDmg ?? 1;
    this.contactCd = 0;
    this.homeX = 0;
    this.homeY = 0;
    this.recentAttacks = [];   // the last few attack names, for variety
    this.squash = 0;           // visual only: anticipation and follow-through
    this.lean = 0;

    this.body = new Body(0, 0, this.w, this.h);
    this.agent = new Agent({ model: opts.model, governor: opts.governor, self: this });

    this.sprite = opts.makeSprite();
    this.mesh = this.sprite.object;
    this.add(this.mesh);
  }

  get cx() { return this.body.cx; }
  get cy() { return this.body.cy; }
  get rect() {
    return { left: this.body.left, right: this.body.right, bottom: this.body.bottom, top: this.body.top };
  }
  // See `struck` in the constructor. Not `hurtRect`: that one is the boss's own
  // attack box, in front of it.
  struckRect() {
    return {
      left: this.cx - this.struck.w / 2, right: this.cx + this.struck.w / 2,
      bottom: this.body.bottom, top: this.body.bottom + this.struck.h,
    };
  }
  get hpFrac() { return Math.max(0, this.hp / this.maxHp); }

  get phaseThresholds() {
    // A phase change at 55% health reads better than a flat 50%: it gives the
    // player a beat of relief before the escalation rather than cutting the
    // moment they start to feel comfortable.
    if (this.phases < 2) return [];
    return [0.55];
  }

  get nextThreshold() {
    const t = this.phaseThresholds;
    if (this.phase - 1 >= t.length) return null;
    return t[this.phase - 1];
  }

  hurt(dmg) {
    if (this.dead || this.state === 'sleep') return false;
    this.hp -= dmg;
    this.hurtFlash = 1;
    this.audio.sfxHit();
    this.fx.burst(this.cx, this.cy, 0xffd08a, 6, 70);
    const t = this.nextThreshold;
    if (t !== null && this.hpFrac <= t) this.enterPhase(this.phase + 1);
    if (this.hp <= 0) { this.hp = 0; this.onDefeated(); }
    return true;
  }

  enterPhase(n) {
    this.phase = n;
    this.state = 'phase';
    this.stateTimer = 1.0;
    this.body.vx = 0;
    this.audio.sfxPhase();
    this.fx.burst(this.cx, this.cy, 0xffffff, 24, 130);
  }

  onDefeated() {
    this.dead = true;
    this.deathTimer = 0;
    this.state = 'dying';
    this.audio.sfxBoss();
  }

  // The blade and projectiles are the only damage sources; the body is harmless
  // to walk into, which is what lets a player safely stand next to a boss that is
  // winding up.
  hurtRect() {
    const w = 22, h = 20;
    const x = this.facing > 0 ? this.body.right - 2 : this.body.left - w + 2;
    return { left: x, right: x + w, bottom: this.body.bottom + 6, top: this.body.bottom + 6 + h };
  }

  updateCommon(dt, player, level) {
    this.frameDt = dt;   // for dampVx() in code paths that are not handed dt
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    this.sprite.setFlash(this.hurtFlash * 0.85);
    this.contactCd = Math.max(0, this.contactCd - dt);

    if (this.dead) {
      this.deathTimer += dt;
      this.mesh.rotation.z = 0;   // the collapse is straight down, not tilted
      this.mesh.scale.y = this.sprite.cell[1] * Math.max(0, 1 - this.deathTimer * 0.5);
      if (this.deathTimer < 1.2 && Math.random() < 0.5) {
        this.fx.burst(this.cx + this.body.w / 2, this.body.bottom + Math.random() * this.h, 0xffd08a, 3, 50);
      }
      return;
    }

    if (this.stateTimer > 0) {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.onStateEnd();
    }

    // Contact damage, rate-limited so brushing past a boss is survivable.
    if (this.contactCd <= 0 && !player.dead && !player.isInvulnerable &&
        player.body.left < this.body.right && player.body.right > this.body.left &&
        player.body.bottom < this.body.top && player.body.top > this.body.bottom) {
      if (player.hurt()) this.contactCd = 0.6;
    }
  }

  integrate(dt, level) {
    this.body.vy = Math.max(-320, this.body.vy - 620 * dt);
    moveX(this.body, level, this.body.vx * dt);
    moveY(this.body, level, this.body.vy * dt);
    this.dampVx(0.86, dt);
    this.mesh.position.set(this.cx, this.body.bottom, 0);
    this._bodyLanguage(dt);
  }

  // Squash and lean, read off the attack stage and the walk. Anticipation
  // (a slow crouch through the windup) is what makes a big body read as
  // heavy; the stretch on `active` sells the release. Small numbers on
  // purpose: the floor markers are the tell, this only supports them.
  // Visual only -- the hit boxes come from `body`, never from the mesh.
  _bodyLanguage(dt) {
    const a = this.atk;
    const target = a && a.stage === 'windup' ? -0.06 * Math.min(1, a.t / a.dur)
      : a && a.stage === 'active' ? 0.05 : 0;
    this.squash = damp(this.squash, target, 10, dt);
    this.sprite.setSquash(this.squash);
    this.lean = damp(this.lean, -clamp(this.body.vx / 60, -1, 1) * 0.05, 6, dt);
    this.sprite.setLean(this.lean);
  }

  // Friction, written as the factor it applies per frame AT 60 FPS. The bosses
  // used to do `vx *= 0.86` once per frame, which brakes 2.4x harder on a
  // 144 Hz screen than on a 60 Hz one. Raising the factor to dt * 60 keeps the
  // 60 fps feel exactly and makes every other frame rate match it.
  dampVx(perFrame, dt = this.frameDt ?? 1 / 60) {
    this.body.vx *= Math.pow(perFrame, dt * 60);
  }

  // Eases toward a walking speed instead of setting it outright, so a boss
  // starts and stops walking over a few frames rather than in one. The accel is
  // high on purpose: integrate() brakes by 0.86 a frame, and a softer push
  // would settle below the walking speed it asked for.
  steer(targetVx, dt = this.frameDt ?? 1 / 60, accel = 420) {
    this.body.vx = approach(this.body.vx, targetVx, accel * dt);
  }

  // Variety: no attack three times in a row. The AI rolls weights every
  // decision, so long streaks of the same move happen by chance and read as a
  // boss with one idea. Each boss swaps to another attack when this says no.
  repeatsTooMuch(name) {
    const r = this.recentAttacks;
    return r.length >= 2 && r[r.length - 1] === name && r[r.length - 2] === name;
  }

  noteAttack(name) {
    this.recentAttacks.push(name);
    if (this.recentAttacks.length > 4) this.recentAttacks.shift();
  }

  // After an attack, while it pauses: a boss standing inside the player steps
  // back to its spacing instead of resting there, which used to make the
  // contact damage the follow-up to every attack.
  keepSpacing(dx, minGap, speed) {
    if (Math.abs(dx) < minGap) this.steer(-Math.sign(dx || this.facing) * speed);
    else this.dampVx(0.8);
  }

  onStateEnd() { this.state = 'idle'; }

  // Shared: the decision loop, gated so a boss will not act during the player's
  // i-frames. Subclasses supply their weight table.
  think(dt, player, level, weights) {
    return this.agent.update(dt, player, level, weights, (key) => {
      if (key === 'attack' || key === 'antiAir' || key === 'strike' || key === 'slam') {
        this.agent.markAttack();
      }
    });
  }

}
