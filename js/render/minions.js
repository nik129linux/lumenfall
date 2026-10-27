import * as THREE from '../vendor/three.module.js';
import { makeSpriteMaterial } from './materials.js';

// Minion sprites, cut from Nico's painted sheets by tools/cut_minions.py.
//
// The sheets live in assets/ and are read-only, so the cut is committed to
// sprites/ instead, and loaded the same way the painted cast is: a manifest plus
// one PNG per enemy.
//
// Every atlas keeps its cells at TWICE the size the minion is drawn in (the
// `display` field in the manifest). The sheets are painted at 1300-2500px wide
// but a wisp is 22px tall on screen, so the cut has to throw away most of the
// pixels anyway -- doing it in the atlas and downscaling with NEAREST lands on
// whole texels, where dropping to the final size first would chew the legs off
// a crawler.
//
// The sprites are NOT tinted. They already carry the level's palette in the
// paint, and the accent survives as the additive halo behind them.

const ATLASES = ['wisp', 'crawler', 'spitter', 'spitterShot'];

// Hard ceiling on an entity's additive halo, in buffer pixels. See makeGlowTexture.
const MAX_GLOW_PX = 40;

function nearest(tex) {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed to load ' + url));
    img.src = url;
  });
}

// The one texture in the game that is NOT NEAREST. A 32px radial gradient
// sampled with NearestFilter shows its individual texels, so a halo read as a
// grid of visible squares. The sprites stay NEAREST on purpose -- that
// crispness is what makes them read at 480x270 -- so this one is filtered
// smoothly and nothing else changes.
function smoothGlow(tex) {
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function makeGlowTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s; c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  // More stops than a 32px version: with a smooth filter the falloff itself has
  // to be smooth, or the steps between stops stay visible as rings.
  g.addColorStop(0.00, 'rgba(255,255,255,0.75)');
  g.addColorStop(0.20, 'rgba(255,255,255,0.44)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.20)');
  g.addColorStop(0.70, 'rgba(255,255,255,0.06)');
  g.addColorStop(0.88, 'rgba(255,255,255,0.01)');
  g.addColorStop(1.00, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return smoothGlow(new THREE.CanvasTexture(c));
}

// Loads sprites/manifest.json plus one atlas per enemy and hands back the same
// per-character shape loadAssets produces, so a minion can be drawn by the same
// code path as the cast.
export async function loadMinions(onProgress) {
  const manifest = await fetch('sprites/manifest.json').then((r) => r.json());

  const characters = {};
  const jobs = ATLASES.map((name) => async () => {
    const img = await loadImage(`sprites/${name}.png`);
    const def = manifest[name];
    // The manifest stores clips as [clipName, [[x, y], ...]] exactly like
    // assets/atlases/manifest.json; rekey to the object form Sprite expects.
    const frames = {};
    for (const [clip, rects] of def.frames) frames[clip] = rects;
    characters[name] = {
      name,
      texture: nearest(new THREE.Texture(img)),
      // `cell` is the atlas cell; `display` is what is drawn. MinionSprite maps
      // one onto the other, unlike Sprite where they are the same number.
      cell: def.cell,
      display: def.display ?? def.cell,
      nativeFacing: def.nativeFacing ?? 1,
      frames,
    };
  });

  let done = 0;
  for (const job of jobs) {
    await job();
    done++;
    if (onProgress) onProgress(done / jobs.length);
  }

  return { characters, glow: makeGlowTexture() };
}

export class MinionArt {
  constructor(loaded) {
    this.characters = loaded.characters;
    this.glow = loaded.glow;
  }

  character(kind) {
    const c = this.characters[kind];
    if (!c) throw new Error(`unknown minion kind: ${kind}`);
    return c;
  }

  glowMaterial(accent) {
    return new THREE.MeshBasicMaterial({
      map: this.glow,
      color: new THREE.Color(accent),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0.5,
    });
  }
}

// Adapter that gives the cut sprites the same surface Sprite exposes, so Enemy
// needs no special-casing. It differs from Sprite in exactly one way: frames are
// sampled out of a cell twice the drawn size.
export class MinionSprite {
  constructor(art, kind, accent, opts = {}) {
    this.kind = kind;
    this.art = art;
    this.char = art.character(kind);
    // `cell` is the DRAWN size, because Enemy squashes the death animation with
    // sprite.cell[1] and reads that as world height.
    this.cell = this.char.display;
    this.clip = null;
    this.frame = 0;
    this.time = 0;
    this.done = false;
    this.speed = opts.speed ?? 8;
    this.facing = 1;
    this.t = 0;

    this.material = makeSpriteMaterial(this.char.texture, {
      outline: 0x05070a,
      dither: 0.09,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    // Feet at the origin, same anchoring as Sprite, so Enemy can place a minion
    // by its body's bottom edge.
    this.mesh.geometry.translate(0, 0.5, 0);
    this.mesh.scale.set(this.cell[0], this.cell[1], 1);

    // Additive halo behind the body. Wisps get the most; the ground types get a
    // trace so their eyes still read in a dark level. The art is never tinted --
    // only this halo carries the accent.
    //
    // Kept well below the 0.45 the procedural silhouettes used. Those WERE a
    // glow, so a strong halo was the sprite. These are painted creatures whose
    // art already carries its own light, and at 0.45 the halo swallowed the
    // wisp's tendrils into one green blob.
    this.glowMat = art.glowMaterial(accent);
    this.glowMat.opacity = kind === 'wisp' ? 0.22 : 0.07;
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 9;
    this.glow.position.z = -0.1;
    // Halos are capped at 40 buffer px so a bigger kind cannot turn an additive
    // glow into a screen-wide wash that flattens the backdrop. The halo is a
    // child of a quad already scaled to `cell`, so its local size is the buffer
    // size divided back out.
    const glowPx = Math.min(MAX_GLOW_PX,
      kind === 'wisp' ? this.cell[0] * 2.4 : this.cell[0] * 1.35);
    this.glow.scale.set(glowPx / this.cell[0], glowPx / this.cell[1], 1);
    this.mesh.add(this.glow);

    this._applyFlip();
    this.applyFrame(0);
  }

  get object() { return this.mesh; }

  get frameCount() {
    const list = this.char.frames[this.clip];
    return list ? list.length : 0;
  }

  play(clip, { restart = false, speed = null, loop = true } = {}) {
    if (!this.char.frames[clip]) return;
    if (this.clip === clip && !restart) {
      if (speed !== null) this.speed = speed;
      return;
    }
    this.clip = clip;
    this.frame = 0;
    this.time = 0;
    this.done = false;
    this.loop = loop;
    if (speed !== null) this.speed = speed;
  }

  // `facing` is the world direction the minion should LOOK: +1 = screen right.
  // All three sheets are drawn facing right, so this is a plain mirror of the
  // same kind Sprite does -- one mechanism, expressed relative to nativeFacing.
  setFacing(dir) {
    if (!dir) return;
    this.facing = dir > 0 ? 1 : -1;
    this._applyFlip();
  }

  _applyFlip() {
    const native = this.char.nativeFacing ?? 1;
    const flip = this.facing === native ? 1 : -1;
    this.mesh.scale.x = this.cell[0] * flip;
    this.flipped = flip < 0;
  }

  applyFrame(i) {
    const list = this.char.frames[this.clip];
    if (!list || !list.length) return;
    const idx = list[Math.max(0, Math.min(list.length - 1, i))];
    const tex = this.char.texture;
    const w = this.char.cell[0], h = this.char.cell[1];
    const u0 = idx[0] / tex.image.width;
    const u1 = (idx[0] + w) / tex.image.width;
    // U runs left-to-right always. The mirror is the scale, not the UVs.
    const uv = this.mesh.geometry.attributes.uv;
    uv.setXY(0, u0, 1); uv.setXY(1, u1, 1);
    uv.setXY(2, u0, 0); uv.setXY(3, u1, 0);
    uv.needsUpdate = true;
  }

  update(dt) {
    this.t += dt;
    // A wisp never stops drifting, whatever the AI picked. Enemy re-seats the
    // mesh position from its physics body every frame, so this adds to the
    // fresh value rather than accumulating.
    if (this.kind === 'wisp' && !this.done) {
      this.mesh.position.y += Math.sin(this.t * 2.6) * 2.2;
    }
    const n = this.frameCount;
    if (!n) return;
    if (n === 1) { this.applyFrame(0); return; }
    this.time += dt * this.speed;
    while (this.time >= 1) {
      this.time -= 1;
      this.frame += 1;
      if (this.frame >= n) {
        if (this.loop === false) { this.frame = n - 1; this.done = true; break; }
        this.frame = 0;
      }
    }
    this.applyFrame(this.frame);
  }

  setFlash(v) { this.material.userData.uniforms.flash.value = v; }

  // Never called for minions -- the sheets have a real death clip -- but kept so
  // Enemy can treat every sprite the same.
  setSquash(a) { this.mesh.scale.y = this.cell[1] * (1 + a); }

  // Same as Sprite.setLean: a tilt about the feet, visual only.
  setLean(a) { this.mesh.rotation.z = a; }
}
