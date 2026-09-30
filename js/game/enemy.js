import * as THREE from '../vendor/three.module.js';
import { Body, moveX, moveY, tileAt, TILE, SOLID } from './physics.js';
import { Agent } from './ai.js';
import { clamp, approach } from '../core/rng.js';
import { audio } from '../core/audio.js';

const GRAVITY = 620;

// Base weights per type. Adaptation re-weights these; it can never introduce an
// action that is not in this table, which keeps the fairness gates meaningful.
const WEIGHTS = {
  wisp: {
    drift: 1.0, approach: 0.8, retreat: 0.5, attack: 0.9,
    attack_hold: 0.45,
  },
  crawler: {
    patrol: 1.2, approach: 0.9, attack: 1.0, retreat: 0.3,
    attack_hold: 0.4,
  },
  spitter: {
    hold: 1.4, approach: 0.5, attack: 1.1, retreat: 1.0,
    attack_hold: 0.7,
  },
};

// Hitboxes follow the cut sprites (wisp 34x22, crawler 36x20, spitter 64x40)
// rather than the old silhouettes. Each is inset from its cell: the sheets carry
// a shadow stroke and smoke that the player should not have to shoot through.
const STATS = {
  wisp:    { w: 16, h: 15, hp: 2, speed: 34, dmg: 1, aggro: 150 },
  crawler: { w: 26, h: 14, hp: 3, speed: 46, dmg: 1, aggro: 130 },
  spitter: { w: 30, h: 32, hp: 3, speed: 30, dmg: 1, aggro: 190 },
};

// Which clip each enemy plays when. The crawler sheet has no idle frame -- it is
// always walking or lunging -- so idle and move resolve to the same clip, and
// play() short-circuits instead of restarting the cycle every frame.
const CLIPS = {
  wisp:    { idle: 'float', move: 'float', attack: 'dash' },
  crawler: { idle: 'walk',  move: 'walk',  attack: 'lunge' },
  spitter: { idle: 'idle',  move: 'walk',  attack: 'cast'  },
};

// Stage 1's facing rule: look where you are going, but snap at most once every
// 0.15s. Without the cooldown a minion jitters between two directions while it
// hovers around a threshold.
const FLIP_COOLDOWN = 0.15;
const HURT_TIME = 0.15;
// The spitter's fireball leaves on the third cast frame, so a cast has to live
// long enough to reach it. This is also the floor between shots, in case the AI
// holds the attack action.
const SPIT_INTERVAL = 0.9;

let nextId = 1;

export class Enemy {
  constructor(def, model, governor, makeBodySprite) {
    this.id = nextId++;
    this.type = def.type;
    this.def = def;
    this.stats = STATS[def.type];
    this.agent = new Agent({ model, governor, self: this });
    this.patrol = def.patrol || null;
    this.patrolDir = 1;
    this.patrolT = Math.random() * 2;
    // 'wisp' the type also names the archetype's name prop; the hover flag needs its
    // own field so a boss cannot accidentally be treated as a floater.
    this.wisp = def.type === 'wisp';

    this.body = new Body(def.x, def.y, this.stats.w, this.stats.h);
    this.hp = this.stats.hp;
    this.maxHp = this.stats.hp;
    this.dead = false;
    this.deathTimer = 0;
    this.hurtFlash = 0;
    this.hurtTimer = 0;
    this.fireTimer = 0;
    this.castFired = false;
    this.flipTimer = 0;
    this.toPlayer = 1;
    this.homeX = def.x;

    this.sprite = makeBodySprite(this.type);
    this.mesh = this.sprite.object;
    this.mesh.position.set(def.x + this.stats.w / 2, def.y, 0);
  }

  get cx() { return this.body.cx; }
  get cy() { return this.body.cy; }
  get rect() {
    return { left: this.body.left, right: this.body.right, bottom: this.body.bottom, top: this.body.top };
  }

  hurt(dmg) {
    if (this.dead) return false;
    this.hp -= dmg;
    this.hurtFlash = 1;
    this.hurtTimer = HURT_TIME;
    if (this.hp <= 0) { this.dead = true; this.deathTimer = 0; }
    return true;
  }

  update(dt, player, level) {
    if (this.dead) {
      this.deathTimer += dt;
      // Play the cut death animation rather than squashing the sprite flat: the
      // sheets have a real dissolve for all three, and it is the one clip that
      // cannot be faked by scaling.
      this.sprite.play('dead', { speed: 6, loop: false });
      this.sprite.update(dt);
      this.sprite.setFlash(Math.max(0, 1 - this.deathTimer * 3));
      return;
    }

    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    this.sprite.setFlash(this.hurtFlash * 0.8);

    const action = this.agent.update(dt, player, level, WEIGHTS[this.type], (key) => {
      if (key === 'attack' || key === 'antiAir') this.agent.markAttack();
    });

    const aggro = this.stats.aggro;
    const dx = player.cx - this.cx;
    const engaged = this.agent.sense.dist < aggro && !player.dead;
    this.toPlayer = Math.sign(dx) || this.toPlayer;

    this._act(dt, action, player, engaged, dx);

    // Physics
    this.body.vy = Math.max(-280, this.body.vy - GRAVITY * dt);
    if (!this.wisp) {
      moveX(this.body, level, this.body.vx * dt);
    } else {
      // Wisps hover: they integrate x only, and hold their height.
      this.body.x += this.body.vx * dt;
    }
    moveY(this.body, level, this.body.vy * dt);

    if (this.wisp) {
      this.body.y = approach(this.body.y, this.def.y, dt * 24);
      this.body.vy = 0;
    }

    this.mesh.position.set(this.cx, this.body.bottom, 0);
    this._animate(dt, action, player);
  }

  _act(dt, action, player, engaged, dx) {
    const dir = Math.sign(dx) || 1;
    const sp = this.stats.speed;

    switch (action) {
      case 'approach':
        this.body.vx = dir * sp;
        this.patrolDir = dir;
        break;
      case 'retreat':
        this.body.vx = -dir * sp;
        break;
      case 'drift': {
        // Wisps weave rather than charge, so a dash does not trivially pass them.
        this.patrolT += dt * 2.2;
        this.body.vx = Math.cos(this.patrolT) * sp * 1.3;
        this.body.y = this.def.y + Math.sin(this.patrolT * 1.7) * 5;
        break;
      }
      case 'bait':
        // Deliberately hold position. This is the counter to a dodger: the boss
        // stops throwing itself at them and waits for the opening.
        this.body.vx = approach(this.body.vx, 0, sp * 4 * dt);
        break;
      case 'patrol': {
        if (!this.patrol) { this.body.vx = approach(this.body.vx, 0, sp * 4 * dt); break; }
        const [a, b] = this.patrol;
        if (this.body.x < a * TILE && this.patrolDir < 0) this.patrolDir = 1;
        if (this.body.x > b * TILE && this.patrolDir > 0) this.patrolDir = -1;
        this.body.vx = this.patrolDir * sp * 0.6;
        break;
      }
      case 'hold':
        this.body.vx = approach(this.body.vx, 0, sp * 4 * dt);
        break;
      case 'attack':
        // Lunging is the only damage vector; the gate already ensured the player
        // was not invulnerable and that enough time had passed.
        if (this.type === 'crawler') {
          this.body.vx = dir * sp * 2.2;
          this._checkMelee(player);
        } else if (this.type === 'wisp') {
          this.body.vx = dir * sp * 1.6;
          this._checkMelee(player);
        } else {
          // Holding position, no vx. The cast clip and the fireball are driven
          // from `action` in _animate, so there is no flag to set here.
          this.body.vx = approach(this.body.vx, 0, sp * 4 * dt);
        }
        break;
      case 'antiAir':
        this.body.vx = dir * sp * 0.8;
        break;
      default:
        this.body.vx = approach(this.body.vx, 0, sp * 3 * dt);
    }
  }

  _checkMelee(player) {
    if (player.isInvulnerable || player.dead) return;
    const r = this.rect;
    if (player.body.left < r.right && player.body.right > r.left &&
        player.body.bottom < r.top && player.body.top > r.bottom) {
      player.hurt();
    }
  }

  _spit(player) {
    this.fireTimer -= 1 / 60;
    if (this.fireTimer > 0) return;
    this.fireTimer = SPIT_INTERVAL;
    this.onFire?.(this.cx + Math.sign(player.cx - this.cx) * 8, this.cy + 4,
                   Math.sign(player.cx - this.cx) || 1);
  }

  _animate(dt, action, player) {
    const moving = Math.abs(this.body.vx) > 6;
    const attacking = action === 'attack' || action === 'antiAir';

    // Facing: movement direction normally, but face the player while attacking
    // so a spitter lines its shot up. Capped at one flip per FLIP_COOLDOWN.
    this.flipTimer -= dt;
    if (this.flipTimer <= 0) {
      const want = attacking ? this.toPlayer : (this.body.vx >= 0 ? 1 : -1);
      if (want && want !== this.sprite.facing) this.sprite.setFacing(want);
      this.flipTimer = FLIP_COOLDOWN;
    }

    if (this.hurtTimer > 0) {
      this.sprite.play('hurt', { speed: 6, loop: false });
      this.sprite.update(dt);
      return;
    }

    const map = CLIPS[this.type];
    const clip = attacking ? map.attack : (moving ? map.move : map.idle);
    const speed = attacking ? 7 : (moving ? 6 : 3);
    this.sprite.play(clip, { speed });

    // The fireball leaves on the third cast frame. `castFired` latches so a
    // single pass through the clip spawns exactly one.
    if (clip === 'cast') {
      if (!this.castFired && this.sprite.frame >= 2) {
        this.castFired = true;
        this._spit(player);
      }
    } else if (this.castFired) {
      this.castFired = false;
    }

    this.sprite.update(dt);
  }

}

// -------------------------------------------------------------- the shard pickup

export class Shard {
  constructor(def) {
    this.x = def.x; this.y = def.y;
    this.taken = false;
    this.t = Math.random() * 6;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 7),
      new THREE.MeshBasicMaterial({ color: 0x7fe8b0, transparent: true, opacity: 0.95 })
    );
    this.mesh.position.set(def.x, def.y + 3, 0);
    this.mesh.frustumCulled = false;
  }

  update(dt) {
    this.t += dt;
    this.mesh.position.y = this.y + 3 + Math.sin(this.t * 2.2) * 2;
    this.mesh.material.opacity = 0.7 + Math.sin(this.t * 3) * 0.25;
  }
}

// ----------------------------------------------------------------- the Elder NPC

export class Elder {
  constructor(def, makeSpriteFn) {
    this.x = def.x; this.y = def.y;
    this.sprite = makeSpriteFn();
    this.mesh = this.sprite.object;
    this.mesh.position.set(def.x, def.y, 0);
    this.talked = false;
    this.state = 'idle';
    this.t = 0;
    // He waits facing the way Kael arrives. goodwitch's sheet is drawn facing
    // right, so a left-facing elder is a flip, not a different frame.
    this.sprite.setFacing(def.face ?? 1);
  }

  // He is gone with the Ember once the theft has played: the mesh comes out of
  // the scene so nothing draws him for the rest of the level.
  remove() {
    this.mesh.parent?.remove(this.mesh);
    this.removed = true;
  }

  update(dt) {
    this.t += dt;
    if (this.state === 'offer') this.sprite.play('offer', { speed: 5 });
    else if (this.state === 'talk') this.sprite.play('talk', { speed: 4 });
    else this.sprite.play('idle', { speed: 3 });
    this.sprite.update(dt);
  }

  // The reveal beat: the disguise's last idle frame has green eyes, and the
  // sorcerer's frame swaps in underneath. Same character, two guises.
  reveal() {
    this.state = 'offer';
  }

}
