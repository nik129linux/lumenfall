import * as THREE from '../../vendor/three.module.js';
import { Boss } from './base.js';
import { Projectile } from '../fx.js';
import { AI } from '../../core/config.js';
import { audio } from '../../core/audio.js';

// L2 boss: Ul Burjo, who was the kind elder in L1.
//
// Phase 1 is a ranged duel: he throws toxic bolts and repositions, teaching the
// arena. Phase 2 turns the arena itself into the weapon -- he rotates the room,
// which is the same mechanic the player has been using all level, now aimed at
// them. Using the player's own tool against them is the point.

const WEIGHTS_P1 = {
  reposition: 1.0,
  volley: 1.1,
  sweep: 0.8,
  bait: 0.9,
  idle: 0.5,
  volley_hold: 0.8,
  sweep_hold: 0.6,
};

const WEIGHTS_P2 = {
  rotate: 1.2,
  volley: 1.0,
  sweep: 1.1,
  bait: 0.8,
  idle: 0.35,
  volley_hold: 0.6,
  sweep_hold: 0.5,
};

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
    this.level = opts.level;             // the Level, for the arena rotation
    this.attackTimer = 0;
    this.volley = 0;
    this.rotateRequested = false;
    this.rotateCooldown = 0;
    this.announcedReveal = false;
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

    // First time the player sees him in phase 2, the disguise is dropped: the
    // elder's sprite swaps for the sorcerer's. Same character, revealed.
    if (this.phase === 2 && !this.announcedReveal) {
      this.announcedReveal = true;
      this.swapTo('badwitch');
    }

    this.attackTimer -= dt;
    this.rotateCooldown = Math.max(0, this.rotateCooldown - dt);
    const weights = this.phase === 1 ? WEIGHTS_P1 : WEIGHTS_P2;
    const action = this.think(dt, player, level, weights);
    const dx = player.cx - this.cx;
    this.facing = dx >= 0 ? 1 : -1;

    if (this.state === 'phase') {
      this.body.vx = 0;
    } else {
      this._act(dt, action, player, dx, fx);
    }

    this.integrate(dt, level);
    this._animate(dt, action);
  }

  _act(dt, action, player, dx, fx) {
    const speed = 24 + this.phase * 5;
    switch (action) {
      case 'reposition':
        this.body.vx = Math.sign(dx) * speed;
        break;
      case 'bait':
        this.body.vx *= 0.88;
        break;
      case 'volley':
        this.body.vx = Math.sign(dx) * speed * 0.4;
        if (this.attackTimer <= 0) {
          this.attackTimer = 1.5 - this.phase * 0.3;
          this._volley(player, fx);
        }
        break;
      case 'sweep':
        this.body.vx = this.facing * speed * 1.6;
        if (this.attackTimer <= 0) {
          this.attackTimer = 0.9;
          this._sweep(player);
        }
        break;
      case 'rotate':
        this.body.vx = 0;
        this._requestRotate();
        break;
      default:
        this.body.vx *= 0.9;
    }
  }

  _volley(player, fx) {
    audio.sfxSlash();
    const dir = Math.sign(player.cx - this.cx) || 1;
    // Three bolts with a vertical spread: a dash through the centre still gets
    // clipped unless the player reads the spread.
    for (let i = -1; i <= 1; i++) {
      fx.projectiles.push(new Projectile(fx.scene, this.cx + dir * 10, this.cy + 2,
        dir * 78, i * 26, { color: 0xa86cf0, r: 3, life: 2.4 }));
    }
  }

  _sweep(player) {
    audio.sfxSlash();
    this.fx.slashArc(this.cx + this.facing * 12, this.body.bottom + 22, this.facing, 0xc79cf0);
    const r = this.hurtRect();
    if (!player.dead && !player.isInvulnerable &&
        player.body.left < r.right && player.body.right > r.left &&
        player.body.bottom < r.top && player.body.top > r.bottom) {
      player.hurt();
    }
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
      this.rotateCooldown = 4.5;
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

  _animate(dt, action) {
    if (this.dead) { this.sprite.update(dt); return; }
    this.sprite.setFacing(this.facing);
    if (this.state === 'phase') this.sprite.play('raise', { speed: 5 });
    else if (action === 'volley') this.sprite.play('cast', { speed: 6 });
    else if (action === 'sweep') this.sprite.play('attack', { speed: 7 });
    else if (action === 'rotate') this.sprite.play('cast', { speed: 4 });
    else if (Math.abs(this.body.vx) > 4) this.sprite.play('sway', { speed: 5 });
    else this.sprite.play('idle', { speed: 3 });
    this.sprite.update(dt);
  }
}
