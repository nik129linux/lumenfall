import * as THREE from '../../vendor/three.module.js';
import { Body, moveX, moveY } from '../physics.js';
import { Agent } from '../ai.js';
import { audio } from '../../core/audio.js';

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
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    this.sprite.setFlash(this.hurtFlash * 0.85);
    this.contactCd = Math.max(0, this.contactCd - dt);

    if (this.dead) {
      this.deathTimer += dt;
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
    this.body.vx *= 0.86;
    this.mesh.position.set(this.cx, this.body.bottom, 0);
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

  setPaletteLevel(id) { this.sprite.setPaletteLevel(id); }
}
