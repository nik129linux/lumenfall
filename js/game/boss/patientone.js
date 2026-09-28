import * as THREE from '../../vendor/three.module.js';
import { Boss } from './base.js';
import { Projectile } from '../fx.js';
import { predictLight } from '../ai.js';
import { AI, LEVELS } from '../../core/config.js';
import { audio } from '../../core/audio.js';

// L3 boss: The Patient One. Gets the most AI budget because the mechanic is the
// interesting one.
//
// It does not track Kael. It tracks the *light*. In a level with no ambient
// light, the sword halo is the only thing that betrays where the player is, and
// this boss reads that halo's path and strikes where it is going rather than
// where the player currently is. The counter-play falls out of that honestly:
// stand still in the dark and you are nearly invisible, but you also cannot
// attack, so it is a real trade rather than a trick.
//
// Prediction confidence is capped and falls off when the player is weaving, so
// a moving target is genuinely harder to lead than a still one.

const WEIGHTS_P1 = {
  fade: 1.0,
  reposition: 0.9,
  strike: 1.2,
  bait: 0.7,
  idle: 0.4,
  strike_hold: 0.7,
  reposition_hold: 0.8,
};

const WEIGHTS_P2 = {
  fade: 1.2,
  reposition: 0.7,
  strike: 1.5,
  ring: 1.1,
  bait: 0.6,
  idle: 0.25,
  strike_hold: 0.5,
  reposition_hold: 0.6,
  ring_hold: 1.0,
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

    this.opacity = 1;
    this.fadeTimer = 0;
    this.strikeTimer = 0;
    this.ringTimer = 0;
    this.lastPredicted = null;
    this.visionReveal = 0;
  }

  wake() {
    if (this.state !== 'sleep') return;
    this.state = 'idle';
    audio.sfxBoss();
  }

  update(dt, player, level, fx) {
    if (this.state === 'sleep') { this.updateCommon(dt, player, level); return; }
    this.updateCommon(dt, player, level);
    if (this.dead) return;

    const weights = this.phase === 1 ? WEIGHTS_P1 : WEIGHTS_P2;
    const action = this.think(dt, player, level, weights);
    const dx = player.cx - this.cx;
    this.facing = dx >= 0 ? 1 : -1;
    this.strikeTimer -= dt;
    this.ringTimer -= dt;

    if (this.state === 'phase') {
      this.body.vx = 0;
    } else {
      this._act(dt, action, player, dx, fx);
    }

    this.integrate(dt, level);

    // It is a shadow; it cannot simply stand in full opacity and swing. The fade
    // is the tell, and the strike is what it costs to reveal itself.
    const target = this.state === 'fade' ? 0.25 : 0.75 + this.visionReveal * 0.25;
    this.opacity += (target - this.opacity) * Math.min(1, dt * 5);
    this.sprite.material.userData.uniforms.alphaScale.value = this.opacity;
    this.visionReveal = Math.max(0, this.visionReveal - dt * 2);

    this._animate(dt, action);
  }

  _act(dt, action, player, dx, fx) {
    const speed = 22 + this.phase * 6;
    switch (action) {
      case 'fade':
        this.body.vx = Math.sign(dx) * speed * 0.7;
        this.fadeTimer -= dt;
        if (this.fadeTimer <= 0) this.fadeTimer = 2.5;
        break;
      case 'reposition':
        this.body.vx = Math.sign(dx) * speed;
        break;
      case 'bait':
        this.body.vx *= 0.9;
        break;
      case 'strike':
        this.body.vx = 0;
        if (this.strikeTimer <= 0) {
          this.strikeTimer = 1.6 - this.phase * 0.4;
          this._strikeLight(player, fx);
        }
        break;
      case 'ring':
        this.body.vx = 0;
        if (this.ringTimer <= 0) {
          this.ringTimer = 2.4;
          this._ring(player, fx);
        }
        break;
      default:
        this.body.vx *= 0.9;
    }
  }

  // The signature move: read the halo's path, then strike it.
  _strikeLight(player, fx) {
    const pred = predictLight(this.agent, this.model, AI.predictHorizon);
    this.lastPredicted = pred;

    // A low-confidence read (player is weaving) falls back to the actual
    // position, so the boss is not a perfect oracle.
    const aimX = pred ? (player.lightX + (pred.x - player.lightX) * pred.confidence) : player.lightX;
    const aimY = pred ? (player.lightY + (pred.y - player.lightY) * pred.confidence) : player.lightY;

    const dir = Math.sign(aimX - this.cx) || this.facing;
    audio.sfxSlash();
    this.visionReveal = 1;
    this.sprite.setFlash(0.6);

    // The lantern arc: it throws where it thinks the light will be. If the read
    // was right the bolts land on the player; if not, they land on empty air.
    const spread = pred ? 0.06 * (1 - pred.confidence) + 0.02 : 0.10;
    for (let i = -1; i <= 1; i++) {
      const a = Math.atan2(aimY - this.cy, aimX - this.cx) + i * spread * 2;
      const sp = 96;
      fx.projectiles.push(new Projectile(
        fx.scene, this.cx + dir * 10, this.cy + 4,
        Math.cos(a) * sp, Math.sin(a) * sp,
        { color: 0xff9a3c, r: 3, life: 2.0 }
      ));
    }
    this.fx.burst(this.cx + dir * 10, this.cy + 4, 0xff9a3c, 5, 50);
  }

  // Phase 2: an expanding ring, which punishes standing still. Deliberately the
  // opposite of the strike's counter-play, so the two cannot both be answered the
  // same way.
  _ring(player, fx) {
    audio.sfxPhase();
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (this.agent.time % 6) * 0.3;
      fx.projectiles.push(new Projectile(
        fx.scene, this.cx, this.cy + 6,
        Math.cos(a) * 54, Math.sin(a) * 54,
        { color: 0xffb060, r: 3, life: 2.6 }
      ));
    }
  }

  _animate(dt, action) {
    if (this.dead) { this.sprite.update(dt); return; }
    this.sprite.setFacing(this.facing);
    if (this.state === 'phase') this.sprite.play('teleport', { speed: 6 });
    else if (action === 'strike' || action === 'ring') this.sprite.play('raise', { speed: 6 });
    else if (action === 'fade') this.sprite.play('vanish', { speed: 8 });
    else if (Math.abs(this.body.vx) > 4) this.sprite.play('walk', { speed: 4 });
    else this.sprite.play('idle', { speed: 2.5 });
    this.sprite.update(dt);
  }
}
