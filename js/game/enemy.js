import * as THREE from '../vendor/three.module.js';
import { Body, moveX, moveY, tileAt, TILE, SOLID, PLATFORM } from './physics.js';
import { Agent } from './ai.js';
import { clamp, approach } from '../core/rng.js';
import { audio } from '../core/audio.js';
import { ENEMY_STAGGER, AI } from '../core/config.js';

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

// The minion attack contract, the small brother of the boss one in
// boss/base.js. Every minion attack has the same three stages:
//   windup  -- planted and blinking: the tell, the player's cue to move
//   active  -- the lunge (or the shot); the only frames that can hurt
//   recover -- stopped and open, the window to punish
// They used to lunge on the same tick the AI picked 'attack', with no tell at
// all, so a crawler hit was something you could not react to. Seconds per stage.
const ATTACK_T = {
  wisp:    { windup: 0.30, active: 0.28, recover: 0.40 },
  crawler: { windup: 0.34, active: 0.24, recover: 0.45 },
  spitter: { windup: 0.36, active: 0.10, recover: 0.50 },
};

// How close each type has to be before an attack is worth starting, in px:
// horizontal distance between min and max, and at most `dy` apart vertically.
// Out of range, an 'attack' decision becomes closing the distance instead of a
// lunge at empty air.
const RANGE = {
  wisp:    { min: 0,  max: 64,  dy: 28 },
  crawler: { min: 0,  max: 46,  dy: 18 },
  spitter: { min: 40, max: 180, dy: 44 },
};

// The spitter's comfort zone: closer than `near` it backs off, further than
// `far` it closes in, in between it holds and shoots.
const SPITTER_SPACING = { near: 70, far: 140 };

// How fast each type can change speed, in px/s^2. Minions used to set their
// velocity outright, which made every start and stop a one-frame snap.
const ACCEL = { wisp: 170, crawler: 260, spitter: 200 };

// Lunge speed during `active`, as a multiple of the walking speed.
const LUNGE = { wisp: 1.7, crawler: 2.4 };

// Horizontal speed of the spitter's shot. Must match the `dir * 88` in
// main.js _spitterShot(): the aim below needs the flight time.
const SHOT_SPEED = 88;

// Minions closer than this push gently apart, so a group spreads out instead
// of stacking into one sprite.
const SEPARATION = 18;   // px

let nextId = 1;

// Every minion that has been built, so neighbours can keep their spacing.
// Only the live ones count: dead, or out of the scene after a level reload.
const roster = new Set();
const isLive = (e) => !e.dead && e.mesh && e.mesh.parent;

// Attack tokens. Only AI.maxConcurrentAttackers minions may be in windup or
// active at the same time; the rest wait their turn. Without it, three
// minions reaching the player on the same tick land three hits that no dodge
// can answer. A token is held through windup and active and handed back at
// recover.
const attackers = new Set();
function takeAttackToken(e) {
  for (const a of attackers) if (!isLive(a) || !a.atk || a.atk.stage === 'recover') attackers.delete(a);
  if (attackers.size >= AI.maxConcurrentAttackers) return false;
  attackers.add(e);
  return true;
}

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
    this.staggerTimer = 0;
    this.atk = null;          // the attack in progress: { stage, t, dur, dir }
    this.attackArmed = false; // set by an 'attack' decision, spent by starting one
    this.flipTimer = 0;
    this.toPlayer = 1;
    this.homeX = def.x;

    this.sprite = makeBodySprite(this.type);
    this.mesh = this.sprite.object;
    this.mesh.position.set(def.x + this.stats.w / 2, def.y, 0);
    roster.add(this);
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
    this.staggerTimer = ENEMY_STAGGER;
    // A hit interrupts the attack, windup included: reading the tell and
    // striking first is supposed to pay off.
    this._cancelAttack();
    if (this.hp <= 0) { this.dead = true; this.deathTimer = 0; }
    return true;
  }

  update(dt, player, level) {
    if (this.dead) {
      this._cancelAttack();
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
    this.staggerTimer = Math.max(0, this.staggerTimer - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);

    const action = this.agent.update(dt, player, level, WEIGHTS[this.type], (key) => {
      // One decision buys at most one attack. Without the latch, an 'attack'
      // action that outlives a fast attack would start a second one that never
      // went through the fairness gates.
      if (key === 'attack' || key === 'antiAir') { this.agent.markAttack(); this.attackArmed = true; }
    });

    const aggro = this.stats.aggro;
    const dx = player.cx - this.cx;
    const engaged = this.agent.sense.dist < aggro && !player.dead;
    this.toPlayer = Math.sign(dx) || this.toPlayer;

    // A staggered enemy is knocked out of its action: it keeps the knockback
    // velocity instead of acting, which is what makes a hit feel like it landed.
    // The decay is per second (0.9 per frame at 60 fps), so it reads the same at
    // any frame rate.
    if (this.staggerTimer <= 0) this._act(dt, action, player, engaged, dx, level);
    else this.body.vx *= Math.exp(-6.3 * dt);

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

  _act(dt, action, player, engaged, dx, level) {
    // An attack in progress owns the body until it has fully recovered.
    if (this.atk) { this._runAttack(dt, player, level); return; }

    const dir = Math.sign(dx) || 1;
    const sp = this.stats.speed;
    let want = 0;   // the velocity this action asks for; the body eases toward it

    // The leash. The AI table offers 'approach' and 'attack' at any distance,
    // so a minion used to chase the player from across the whole level. Out of
    // aggro range, those turn into going back to its own patch of the level.
    if (!engaged && (action === 'approach' || action === 'attack' || action === 'antiAir')) {
      action = this.patrol ? 'patrol' : 'home';
    }

    switch (action) {
      case 'home': {
        const off = this.homeX - this.body.x;
        want = Math.abs(off) > TILE ? Math.sign(off) * sp * 0.6 : 0;
        break;
      }
      case 'approach':
        // Close in, but stop once inside striking distance: pressing on into
        // the player only stacks minions on top of each other.
        if (this.type === 'spitter' && engaged) want = this._spacing(dir, Math.abs(dx));
        else want = Math.abs(dx) > RANGE[this.type].max * 0.6 ? dir * sp : 0;
        this.patrolDir = dir;
        if (this.wisp) this._bob(dt);
        break;
      case 'retreat':
        want = -dir * sp;
        break;
      case 'drift': {
        // Wisps weave rather than charge, so a dash does not trivially pass them.
        this.patrolT += dt * 2.2;
        want = Math.cos(this.patrolT) * sp * 1.3;
        this.body.y = this.def.y + Math.sin(this.patrolT * 1.7) * 5;
        break;
      }
      case 'bait':
        // Deliberately hold position. This is the counter to a dodger: the boss
        // stops throwing itself at them and waits for the opening.
        want = 0;
        break;
      case 'patrol': {
        if (!this.patrol) break;
        const [a, b] = this.patrol;
        if (this.body.x < a * TILE && this.patrolDir < 0) this.patrolDir = 1;
        if (this.body.x > b * TILE && this.patrolDir > 0) this.patrolDir = -1;
        want = this.patrolDir * sp * 0.6;
        break;
      }
      case 'hold':
        want = this.type === 'spitter' && engaged ? this._spacing(dir, Math.abs(dx)) : 0;
        break;
      case 'attack':
      case 'antiAir':
        // The fairness gates already passed when the AI picked this. What is
        // left is whether the attack can actually connect from here.
        if (this._inRange(dx, player)) {
          if (this.attackArmed && takeAttackToken(this)) {
            this._beginAttack(dir);
            return;
          }
          // In range but another minion holds the token: wait at this
          // distance for the turn instead of crowding into the player.
          want = this.type === 'spitter' ? this._spacing(dir, Math.abs(dx)) : 0;
          break;
        }
        // Out of range: close in (or, for the spitter, find its spacing).
        want = this.type === 'spitter' ? this._spacing(dir, Math.abs(dx)) : dir * sp;
        break;
      default:
        want = 0;
    }

    want += this._separation();

    // Never walk off a ledge or into a wall. A patrol turns around instead of
    // standing at the edge.
    if (want !== 0 && !this._pathClear(Math.sign(want), level)) {
      want = 0;
      if (action === 'patrol') this.patrolDir *= -1;
    }

    this.body.vx = approach(this.body.vx, want, ACCEL[this.type] * dt);
  }

  // A push away from any live neighbour that is too close, as a velocity.
  // Walkers only push walkers and wisps only wisps: a wisp above a crawler is
  // not crowding it.
  _separation() {
    let push = 0;
    for (const o of roster) {
      if (o === this) continue;
      if (!isLive(o)) { roster.delete(o); continue; }
      if (o.wisp !== this.wisp) continue;
      const d = this.cx - o.cx;
      if (Math.abs(d) < SEPARATION && Math.abs(this.cy - o.cy) < 16) {
        push += (Math.sign(d) || (this.id > o.id ? 1 : -1)) * (1 - Math.abs(d) / SEPARATION);
      }
    }
    return push * this.stats.speed * 1.2;
  }

  // Wisps on the approach bob a little instead of flying a straight line.
  _bob(dt) {
    this.patrolT += dt * 2.2;
    this.body.y = this.def.y + Math.sin(this.patrolT * 1.7) * 4;
  }

  _inRange(dx, player) {
    const r = RANGE[this.type];
    const adx = Math.abs(dx);
    return adx >= r.min && adx <= r.max && Math.abs(player.cy - this.cy) <= r.dy;
  }

  // The spitter's preferred distance: back off when crowded, close in when far.
  _spacing(dir, adx) {
    const sp = this.stats.speed;
    if (adx < SPITTER_SPACING.near) return -dir * sp;
    if (adx > SPITTER_SPACING.far) return dir * sp * 0.7;
    return 0;
  }

  // True when the body can take a step in `dir`: no wall in front, and (for
  // anything that walks) floor under the next step. Wisps fly, so only walls
  // stop them. The floor check does not look at onGround on purpose: it can
  // read false for a frame on flat ground, and that one frame was enough to
  // walk a crawler into a pit.
  _pathClear(dir, level) {
    if (!dir) return true;
    const b = this.body;
    const tx = Math.floor((dir > 0 ? b.right + 2 : b.left - 2) / TILE);
    const tyFeet = Math.floor((b.bottom + 1) / TILE);
    if (tileAt(level, tx, tyFeet) === SOLID) return false;
    if (this.wisp) return true;
    const below = tileAt(level, tx, Math.floor((b.bottom - 1) / TILE));
    return below === SOLID || below === PLATFORM;
  }

  _beginAttack(dir) {
    this.attackArmed = false;
    this.atk = { stage: 'windup', t: 0, dur: ATTACK_T[this.type].windup, dir };
  }

  _cancelAttack() {
    this.atk = null;
    attackers.delete(this);
  }

  _runAttack(dt, player, level) {
    const a = this.atk;
    const T = ATTACK_T[this.type];
    a.t += dt;

    if (a.stage === 'windup') {
      // Planted for the tell. Easing to a stop instead of freezing in place.
      this.body.vx = approach(this.body.vx, 0, 600 * dt);
      if (a.t >= a.dur) {
        a.stage = 'active'; a.t = 0; a.dur = T.active;
        if (this.type === 'spitter') this._spit(player);
        else this.fx?.dust(this.cx, this.body.bottom);
      }
    } else if (a.stage === 'active') {
      if (this.type !== 'spitter') {
        // The lunge is the only damage vector, and it still stops at a ledge.
        const clear = this._pathClear(a.dir, level);
        this.body.vx = clear ? a.dir * this.stats.speed * LUNGE[this.type] : 0;
        this._checkMelee(player);
      }
      if (a.t >= a.dur) { a.stage = 'recover'; a.t = 0; a.dur = T.recover; attackers.delete(this); }
    } else {
      this.body.vx = approach(this.body.vx, 0, 320 * dt);
      if (a.t >= a.dur) this.atk = null;
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

  // Fires the spitter's shot. The shot always flies at SHOT_SPEED horizontally;
  // the aim is only its vertical speed, set to arrive where the player will be.
  // It leads by HALF the player's vertical motion: a full lead would snipe
  // anyone mid-jump, half a lead makes jumping over it a choice, not a dice roll.
  _spit(player) {
    if (!this.onFire) return;
    const dir = Math.sign(player.cx - this.cx) || 1;
    const x = this.cx + dir * 8, y = this.cy + 4;
    const t = Math.max(0.25, Math.abs(player.cx - x) / SHOT_SPEED);
    const targetY = player.cy + player.body.vy * t * 0.5;
    const vy = clamp((targetY - y) / t, -40, 40);
    this.onFire(x, y, dir, vy);
  }

  _animate(dt, action, player) {
    const moving = Math.abs(this.body.vx) > 6;
    const a = this.atk;
    const attacking = !!a && a.stage !== 'recover';

    // Facing: locked to the attack direction once an attack starts (like the
    // bosses, a lunge does not re-aim mid-tell), otherwise the direction of
    // travel. Standing still keeps the current facing instead of snapping to
    // the right, which is what `vx >= 0` used to do. Capped at one flip per
    // FLIP_COOLDOWN.
    this.flipTimer -= dt;
    if (this.flipTimer <= 0) {
      const want = a ? a.dir : (Math.abs(this.body.vx) > 4 ? Math.sign(this.body.vx) : this.sprite.facing);
      if (want && want !== this.sprite.facing) this.sprite.setFacing(want);
      this.flipTimer = FLIP_COOLDOWN;
    }

    // The tell: blinking during windup, on top of whatever hurt flash is left.
    const blink = a && a.stage === 'windup' && Math.floor(a.t * 14) % 2 === 0 ? 0.55 : 0;
    this.sprite.setFlash(Math.max(this.hurtFlash * 0.8, blink));

    if (this.hurtTimer > 0) {
      this.sprite.play('hurt', { speed: 6, loop: false });
      this.sprite.update(dt);
      return;
    }

    const map = CLIPS[this.type];
    const clip = attacking ? map.attack : (moving ? map.move : map.idle);
    const speed = attacking ? 7 : (moving ? 6 : 3);
    this.sprite.play(clip, { speed });
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
