import * as THREE from '../vendor/three.module.js';
import { Sprite, Ghost } from '../render/sprite.js';
import { Body, moveX, moveY, TILE, SOLID, SPIKE, tileAt } from './physics.js';
import {
  PLAYER_W, PLAYER_H, DASH_TIME, DASH_SPEED, DASH_COOLDOWN, JUMP_VEL, JUMP_CUT,
  GRAVITY, MAX_FALL, RUN_SPEED, PIT_DEATH_Y, GROUND_ACCEL, AIR_ACCEL, GROUND_FRICTION, AIR_FRICTION,
  ATTACK_TIME, ATTACK_ACTIVE, ATTACK_REACH, ATTACK_DMG, IFRAMES_ON_HIT,
} from '../core/config.js';
import { clamp, approach } from '../core/rng.js';

export class Player {
  constructor(scene, character) {
    this.scene = scene;
    this.body = new Body(0, 0, PLAYER_W, PLAYER_H);
    this.sprite = new Sprite(character, { speed: 9, outline: 0x0a1410 });
    this.mesh = this.sprite.object;
    scene.add(this.mesh);

    this.ghosts = [];
    for (let i = 0; i < 4; i++) {
      const g = new Ghost(character, 0.26);
      scene.add(g.object);
      this.ghosts.push(g);
    }
    this._ghostTimer = 0;

    this.reset();
  }

  reset() {
    this.body.x = 24; this.body.y = 32;
    this.body.vx = 0; this.body.vy = 0;
    this.facing = 1;
    this.onGround = false;
    this.dashTimer = 0;
    this.dashCd = 0;
    this.airDashesLeft = 1;
    this.airDashUsed = false;
    this.attackTimer = 0;
    this.attackHit = false;
    this.hurtTimer = 0;
    this.hurtEvent = false;   // set once per hit, consumed by main.js
    this.dead = false;
    this.deadTimer = 0;
    this.pitDeath = false;   // set when the death was a fall out of a pit
    this.squash = 0;
    this.coyote = 0;
    this.jumpHeld = false;
    this.lightX = 0;
    this.lightY = 0;
    this.sprite.play('idle', { restart: true });
    this.sprite.setFacing(1);
  }

  get cx() { return this.body.cx; }
  get cy() { return this.body.cy; }
  get isDashing() { return this.dashTimer > 0; }
  get isInvulnerable() { return this.isDashing || this.hurtTimer > 0; }
  get isAttacking() { return this.attackTimer > 0; }
  get dashReady() { return this.dashCd <= 0; }

  // The attack box, in the level's local space.
  attackRect() {
    const w = ATTACK_REACH;
    const h = 22;
    const x = this.facing > 0 ? this.body.right - 2 : this.body.left - w + 2;
    return { left: x, right: x + w, bottom: this.body.bottom + 4, top: this.body.bottom + 4 + h };
  }

  hurt() {
    if (this.isInvulnerable || this.dead) return false;
    this.hurtTimer = IFRAMES_ON_HIT;
    this.body.vx = -this.facing * 90;
    this.body.vy = 110;
    this.sprite.setFlash(0.9);
    this.hurtEvent = true;
    return true;
  }

  kill() {
    if (this.dead) return;
    this.dead = true;
    this.deadTimer = 0;
    this.body.vx = 0;
    this.sprite.play('dead', { restart: true, loop: false, speed: 6 });
  }

  update(dt, input, level) {
    if (this.dead) return this._updateDead(dt, level);

    this.hurtTimer = Math.max(0, this.hurtTimer - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.attackTimer = Math.max(0, this.attackTimer - dt);
    this.sprite.setFlash(Math.max(0, this.sprite.material.userData.uniforms.flash.value - dt * 4));

    const canAct = this.hurtTimer <= 0;

    // ---- dash
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.body.vx = this.facing * DASH_SPEED;
      this.body.vy = 0;
      this._emitGhost();
      if (this.dashTimer <= 0) {
        // Hand back to normal momentum, but keep a little so the dash does not
        // feel like hitting a wall.
        this.body.vx *= 0.45;
      }
    } else {
      if (canAct && input.consume('dash') && this._tryDash()) {
        // started
      } else {
        this._walk(dt, input);
      }
    }

    // ---- jump. Coyote time and jump buffering are what make a platformer feel
    // fair; without them a landing one frame late eats the input and the player
    // reads it as the game dropping them.
    this.coyote = this.onGround ? 0.1 : Math.max(0, this.coyote - dt);
    const wantsJump = input.isDown('jump');
    if (canAct && input.consume('jump') && this.coyote > 0) {
      this.body.vy = JUMP_VEL;
      this.coyote = 0;
      this.onGround = false;
      this.squash = 0.14;
      this.justJumped = true;
    }
    if (!wantsJump && this.body.vy > 0 && this.jumpHeld) {
      this.body.vy *= JUMP_CUT;   // variable jump height
    }
    this.jumpHeld = wantsJump;

    // ---- attack
    if (canAct && input.consume('attack') && this.attackTimer <= 0) {
      this.attackTimer = ATTACK_TIME;
      this.attackHit = false;
      this.sprite.play('attack', { restart: true, loop: false, speed: 11 });
    }

    // ---- integrate
    this.body.vy = Math.max(-MAX_FALL, this.body.vy - GRAVITY * dt);
    const wasAir = !this.onGround;
    moveX(this.body, level, this.body.vx * dt);
    moveY(this.body, level, this.body.vy * dt);
    this.onGround = this.body.onGround;
    this._clampToLevel(level);

    if (this.onGround) {
      if (wasAir && this.body.vy <= 0) this.squash = -0.16;
      this.airDashUsed = false;
    }

    this.squash = approach(this.squash, 0, dt * 2.4);
    this.sprite.setSquash(this.squash);

    this._animate(dt);
    this._updateLight();
    this._checkSpikes(level);
    this._checkVoid(level);
  }

  // Hard guarantee that the body stays inside the level, horizontally.
  //
  // tileAt() reports out-of-range columns as SOLID, which is enough to stop the
  // player at the wall most of the time -- but the resolution depends on which
  // out-of-range column the body happens to land in, so a fast step (the dash,
  // or a long frame) can leave them standing on that phantom solid outside the
  // level. Clamping explicitly makes it impossible. Y is left free on purpose:
  // the gaps in these levels are real pits, and falling out of one is how the
  // death check fires.
  _clampToLevel(level) {
    const maxX = level.width * TILE - this.body.w;
    if (this.body.x < 0) { this.body.x = 0; this.body.vx = 0; }
    if (this.body.x > maxX) { this.body.x = maxX; this.body.vx = 0; }
  }

  _tryDash() {
    if (this.dashCd > 0) return false;
    if (!this.onGround && this.airDashUsed) return false;   // one air dash
    if (!this.onGround) this.airDashUsed = true;
    this.dashTimer = DASH_TIME;
    this.dashCd = DASH_COOLDOWN;
    this.sprite.play('dash', { restart: true, loop: true, speed: 14 });
    this._emitGhost();
    this.justDashed = true;
    return true;
  }

  // Steering always answers, even inside the post-hurt iframes: the iframes
  // are protection (and the knockback still lands), not a stun, which is what
  // lets a shift-bridge crossing survive a wisp brushing past mid-walk.
  _walk(dt, input) {
    let dir = 0;
    if (input.isDown('left')) dir -= 1;
    if (input.isDown('right')) dir += 1;
    const accel = this.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const friction = this.onGround ? GROUND_FRICTION : AIR_FRICTION;

    if (dir !== 0) {
      this.body.vx = approach(this.body.vx, dir * RUN_SPEED, accel * dt);
      this.facing = dir;
    } else {
      this.body.vx = approach(this.body.vx, 0, friction * dt);
    }
  }

  _animate(dt) {
    this.sprite.setFacing(this.facing);
    if (this.attackTimer > 0) return;          // attack owns the animation
    if (this.dashTimer > 0) return;
    if (!this.onGround) {
      this.sprite.play('jump', { speed: 8 });
    } else if (Math.abs(this.body.vx) > 8) {
      this.sprite.play('run', { speed: 6 + Math.abs(this.body.vx) / RUN_SPEED * 6 });
    } else {
      this.sprite.play('idle', { speed: 4 });
    }
    this.sprite.update(dt);
  }

  _emitGhost() {
    this._ghostTimer -= 1;
    if (this._ghostTimer > 0) return;
    this._ghostTimer = 2;
    for (const g of this.ghosts) {
      if (!g.active) { g.spawn(this.mesh.position.x, this.mesh.position.y, this.facing, this.sprite.clip, this.sprite.frame); return; }
    }
  }

  // In L3 the sword is the only light source, so the halo tracks the blade tip
  // during an attack and the body otherwise.
  _updateLight() {
    const r = this.attackRect();
    if (this.attackTimer > 0) {
      this.lightX = this.facing > 0 ? r.right : r.left;
      this.lightY = (r.bottom + r.top) / 2;
    } else {
      this.lightX = this.cx + this.facing * 8;
      this.lightY = this.cy + 2;
    }
  }

  // A pit is bottomless. "Down" is always -Y: a body fully below the floor
  // line can only be inside a hole, everywhere else the ground occupies the
  // lowest rows.
  _checkVoid(level) {
    if (this.dead) return;
    // Fully below the floor line. A body down there can only be inside a hole:
    // everywhere else the ground occupies the lowest rows.
    const out = this.body.top < PIT_DEATH_Y;
    if (!out) return;
    this.pitDeath = true;
    this.kill();
  }

  _checkSpikes(level) {
    const x0 = Math.floor(this.body.left / TILE);
    const x1 = Math.floor((this.body.right - 0.001) / TILE);
    const y0 = Math.floor(this.body.bottom / TILE);
    const y1 = Math.floor((this.body.top - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tileAt(level, tx, ty) === SPIKE) this.hurt();
      }
    }
  }

  _updateDead(dt, level) {
    this.deadTimer += dt;
    this.body.vy = Math.max(-MAX_FALL, this.body.vy - GRAVITY * dt);
    moveX(this.body, level, this.body.vx * dt);
    moveY(this.body, level, this.body.vy * dt);
    this.sprite.update(dt);
  }

  // Called after the sprite animation is settled, so a single-frame attack always
  // gets to play. Returns true on the frame the blade is actually live.
  updateAttackFrame() {
    if (this.attackTimer > 0 && !this.attackHit) {
      const elapsed = ATTACK_TIME - this.attackTimer;
      if (elapsed >= (ATTACK_TIME - ATTACK_ACTIVE) / 2) {
        this.attackHit = true;
        return true;
      }
    }
    return false;
  }

  syncToWorld(worldX, worldY) {
    this.mesh.position.set(worldX, worldY, 0);
  }

  updateGhosts(dt) { for (const g of this.ghosts) g.update(dt); }

}
