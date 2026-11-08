import * as THREE from '../vendor/three.module.js';

// Hitbox overlay, switched on with ?hitbox=1 and absent otherwise. Draws every
// box that decides a fight as a 1px outline over the scene:
//
//   cyan    Kael's body              yellow  his blade's reach, while swinging
//   red     the blade, on the frames where it can hurt
//   green   where a minion or boss RECEIVES a hit (struckRect)
//   grey    their body (what hurts Kael on contact)
//   orange  a boss's own attack box
//
// It exists so "the hitbox looks off" can be checked by looking, instead of
// guessing from a sprite. It reads game state and changes none of it.

const MAX_RECTS = 64;
const COLORS = {
  body: 0x4fe0ff, reach: 0xffd84a, live: 0xff3b3b,
  struck: 0x54f08a, enemyBody: 0x8a949c, bossAttack: 0xff9a3c,
};

export class HitboxOverlay {
  constructor(scene) {
    // One segment list per colour would be eight draw calls; one geometry with
    // vertex colours is one. Each rect is 4 segments = 8 vertices.
    this.pos = new Float32Array(MAX_RECTS * 8 * 3);
    this.col = new Float32Array(MAX_RECTS * 8 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, depthTest: false, depthWrite: false, transparent: true,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 100;
    scene.add(this.lines);
    this.n = 0;
    this._c = new THREE.Color();
  }

  _rect(r, colorHex) {
    if (this.n >= MAX_RECTS) return;
    const c = this._c.setHex(colorHex);
    const x0 = r.left, x1 = r.right, y0 = r.bottom, y1 = r.top;
    const corners = [x0, y0, x1, y0, x1, y0, x1, y1, x1, y1, x0, y1, x0, y1, x0, y0];
    let o = this.n * 8 * 3;
    for (let i = 0; i < 16; i += 2) {
      this.pos[o] = corners[i]; this.pos[o + 1] = corners[i + 1]; this.pos[o + 2] = 1;
      this.col[o] = c.r; this.col[o + 1] = c.g; this.col[o + 2] = c.b;
      o += 3;
    }
    this.n++;
  }

  update(game) {
    this.n = 0;
    const p = game.player;
    if (p && !p.dead) {
      const b = p.body;
      this._rect({ left: b.left, right: b.right, bottom: b.bottom, top: b.top }, COLORS.body);
      if (p.isAttacking) {
        // Red on the frames the blade can hurt, yellow while it is only swinging.
        const elapsed = 0.26 - p.attackTimer;
        const live = p.attackHit && elapsed < 0.2;
        this._rect(p.attackRect(), live ? COLORS.live : COLORS.reach);
      }
    }
    for (const e of game.enemies) {
      if (e.dead || !e.mesh) continue;
      this._rect(e.rect, COLORS.enemyBody);
      this._rect(e.struckRect(), COLORS.struck);
    }
    const boss = game.boss;
    if (boss && !boss.dead) {
      this._rect(boss.rect, COLORS.enemyBody);
      this._rect(boss.struckRect(), COLORS.struck);
      this._rect(boss.hurtRect(), COLORS.bossAttack);
    }
    this.geo.setDrawRange(0, this.n * 8);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
