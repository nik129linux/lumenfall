import * as THREE from '../vendor/three.module.js';
import { makeSpriteMaterial, setPalette, setLift } from './materials.js';

// An animated sprite driven by the frame tables emitted by the asset pipeline.
//
// The reference art is side-view only, so facing is just a horizontal flip and
// the UVs are mirrored rather than swapping in a second set of frames.

export class Sprite {
  constructor(character, opts = {}) {
    this.char = character;
    this.clip = 'idle';
    this.frame = 0;
    this.time = 0;
    this.speed = opts.speed ?? 8;      // frames per second
    this.loop = opts.loop ?? true;
    this.facing = 1;
    this.done = false;

    const geo = new THREE.PlaneGeometry(1, 1);
    this.material = makeSpriteMaterial(character.texture, {
      outline: opts.outline ?? 0x05070a,
      dither: opts.dither ?? 0.09,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;

    this.cell = character.cell;
    // The mesh is scaled to the cell size, and scale multiplies the geometry's
    // local positions. So to put the figure's FEET at the origin in world units,
    // the unit plane has to be shifted into the 0..1 range *before* scaling.
    // Translating by `baseline / 2` here instead stretches the quad to ~48x the
    // cell, which parks the whole sprite off-screen.
    this.mesh.geometry.translate(0, 0.5, 0);
    this.mesh.scale.set(this.cell[0], this.cell[1], 1);

    this._uv = new THREE.Vector2();
    this.applyFrame(0);
    if (opts.paletteLevel) setPalette(this.material, opts.paletteLevel);
  }

  setPaletteLevel(id) { setPalette(this.material, id); }

  setLift(v) { setLift(this.material, v); }

  get frameCount() {
    const list = this.char.frames[this.clip];
    return list ? list.length : 0;
  }

  play(clip, { restart = false, speed = null } = {}) {
    if (this.clip === clip && !restart) return;
    this.clip = clip;
    this.frame = 0;
    this.time = 0;
    this.done = false;
    if (speed !== null) this.speed = speed;
  }

  setFacing(dir) {
    if (dir === 0) return;
    this.facing = dir < 0 ? -1 : 1;
    this.mesh.scale.x = this.cell[0] * this.facing;
  }

  applyFrame(i) {
    const list = this.char.frames[this.clip];
    if (!list || !list.length) return;
    const idx = list[Math.max(0, Math.min(list.length - 1, i))];
    const tex = this.char.texture;
    const w = this.cell[0], h = this.cell[1];
    const u0 = idx[0] / tex.image.width;
    const u1 = (idx[0] + w) / tex.image.width;
    // Flip by swapping the u ends, which is cheaper and exact at this
    // resolution than negating scale on the whole object.
    const uv = this.mesh.geometry.attributes.uv;
    const l = this.facing < 0 ? u1 : u0;
    const r = this.facing < 0 ? u0 : u1;
    uv.setXY(0, l, 1); uv.setXY(1, r, 1);
    uv.setXY(2, l, 0); uv.setXY(3, r, 0);
    uv.needsUpdate = true;
  }

  update(dt) {
    const n = this.frameCount;
    if (!n) return;
    if (n === 1) { this.applyFrame(0); return; }
    this.time += dt * this.speed;
    if (this.time >= 1) {
      this.time %= 1;
      this.frame += 1;
      if (this.frame >= n) {
        if (this.loop) this.frame = 0;
        else { this.frame = n - 1; this.done = true; }
      }
    }
    this.applyFrame(this.frame);
  }

  setFlash(v) { this.material.userData.uniforms.flash.value = v; }

  // Squashes on landing, stretches on jump. Small, and always applied to scale.y
  // only, so a squash can never desync the collision box from the sprite.
  // The quad now runs 0..cellHeight in local Y, so the origin is already at the
  // feet and a squash only has to scale about that edge.
  setSquash(amount) {
    this.mesh.scale.y = this.cell[1] * (1 + amount);
  }

  get object() { return this.mesh; }
}

// A fading copy of a sprite, used for the dash ghost trail. It owns its own
// geometry instance because it animates independently of the source sprite.
export class Ghost {
  constructor(character, lifetime = 0.28) {
    this.char = character;
    this.life = lifetime;
    this.max = lifetime;
    this.material = makeSpriteMaterial(character.texture, { outline: 0x0a1420, dither: 0 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    // Same feet-at-origin anchor as Sprite; see the note there.
    this.mesh.geometry.translate(0, 0.5, 0);
    this.active = false;
    this.cell = character.cell;
  }

  spawn(x, y, facing, clip, frameIndex, tint = 0x6fe0ff) {
    this.mesh.position.set(x, y, 0);
    this.mesh.scale.set(this.cell[0] * facing, this.cell[1], 1);
    const list = this.char.frames[clip];
    if (!list || !list.length) { this.active = false; return; }
    const idx = list[Math.max(0, Math.min(list.length - 1, frameIndex))];
    const tex = this.char.texture;
    const w = this.cell[0], h = this.cell[1];
    const u0 = idx[0] / tex.image.width, u1 = (idx[0] + w) / tex.image.width;
    const uv = this.mesh.geometry.attributes.uv;
    uv.setXY(0, facing < 0 ? u1 : u0, 1); uv.setXY(1, facing < 0 ? u0 : u1, 1);
    uv.setXY(2, facing < 0 ? u1 : u0, 0); uv.setXY(3, facing < 0 ? u0 : u1, 0);
    uv.needsUpdate = true;
    this.material.userData.uniforms.tint.value.set(
      ((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255, 1);
    this.life = this.max;
    this.active = true;
    this.mesh.visible = true;
  }

  update(dt) {
    if (!this.active) return;
    this.life -= dt;
    const k = Math.max(0, this.life / this.max);
    this.material.userData.uniforms.alphaScale.value = k * 0.7;
    if (this.life <= 0) { this.active = false; this.mesh.visible = false; }
  }

  get object() { return this.mesh; }
}
