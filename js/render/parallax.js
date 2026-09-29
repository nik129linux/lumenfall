import * as THREE from '../vendor/three.module.js';
import { LOW_RES_W, LOW_RES_H } from '../core/config.js';
import { makeRng } from '../core/rng.js';

// Three parallax layers per level.
//
// Stage 1 replaced the procedural tree-sticks with the level paintings
// themselves: 1.png (emerald shrine), 2.jpg (purple/toxic), 3.jpg
// (burnt-orange/black) as the far layer, darkened and desaturated so they read
// as backdrop and never compete with the playfield.
//
//   far   factor 0.10  the level painting, cover-fit
//   mid   factor 0.40  black tree trunks, procedural, 30% opacity
//   near  factor 1.20  sparse grass and branches, bottom edge only, in FRONT
//
// 1.png is 5 MB. It is downscaled once into a canvas at load and never
// uploaded at full size.

// The near layer is the only one in front of the gameplay plane, so it needs a
// positive z and an explicit render order to win against sprites.
const LAYER_Z = [-40, -20, 6];
const LAYER_PARALLAX = [0.10, 0.40, 1.20];
const LAYER_TILE_W = 512;   // natural width of the procedural silhouette tiles

const LEVEL_ART = { 1: '1.png', 2: '2.jpg', 3: '3.jpg' };

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function nearest(tex) {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// Cover-fit downscale to at most `maxW`, darken and desaturate. Done once, on
// the CPU, so a 5 MB PNG never reaches the GPU.
function levelArtTexture(img, maxW, brightness, desaturate) {
  const scale = Math.min(1, maxW / img.width);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;    // keep it crisp; the upscale is NEAREST
  ctx.drawImage(img, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = (lum + (r - lum) * desaturate) * brightness;
    d[i + 1] = (lum + (g - lum) * desaturate) * brightness;
    d[i + 2] = (lum + (b - lum) * desaturate) * brightness;
  }
  ctx.putImageData(data, 0, 0);
  return nearest(new THREE.CanvasTexture(c));
}

// Mid layer: black trunks. Drawn as hard rectangles and steps, no curves -- at
// 480x270 a smooth edge resolves to the same pixels as a straight one and only
// costs time.
function trunksTexture(seed) {
  const w = 512, h = 288;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  const n = 13;
  for (let i = 0; i < n; i++) {
    const x = Math.floor((i / n) * w + rng.range(-10, 10));
    const th = h * rng.range(0.75, 1.05);
    const tw = Math.max(3, Math.round(w * rng.range(0.006, 0.013)));
    // Stepped taper: a trunk that is a constant-width rectangle reads as a bar.
    const steps = 7;
    for (let sIdx = 0; sIdx < steps; sIdx++) {
      const t = sIdx / steps;
      const stepW = Math.max(2, Math.round(tw * (1.55 - t * 0.75)));
      const sy = h - th + th * t;
      ctx.fillRect(x - Math.round((stepW - tw) / 2), sy, stepW, Math.ceil(th / steps) + 1);
    }
    ctx.fillRect(x, h - th, tw, th);
    // A few angular limbs, stepped rather than diagonal.
    for (let b = 0; b < 3; b++) {
      const by = h - th * rng.range(0.45, 0.95);
      const dir = rng.sign();
      const len = Math.round(w * rng.range(0.02, 0.055));
      ctx.fillRect(x + (dir > 0 ? 0 : -len), by, len, Math.max(2, Math.round(tw * 0.8)));
      ctx.fillRect(x + (dir > 0 ? len - tw : -len), by - Math.round(th * 0.1), tw, Math.round(th * 0.1));
    }
  }
  return nearest(new THREE.CanvasTexture(c));
}

// Near layer: a thin band of grass and low branches along the bottom edge only.
function foregroundTexture(seed) {
  const w = 512, h = 288;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000000';
  const baseY = h;
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rng.range(0, w));
    const gh = Math.floor(rng.range(6, Math.round(h * 0.15)));
    ctx.fillRect(x, baseY - gh, 1, gh);
    if (rng.chance(0.3)) ctx.fillRect(x + 1, baseY - gh + 2, 1, Math.max(2, gh - 4));
  }
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(rng.range(0, w));
    const len = Math.floor(rng.range(20, 70));
    const th = Math.max(2, Math.round(h * 0.012));
    ctx.fillRect(x, baseY - th, len, th);
    ctx.fillRect(x + (rng.chance(0.5) ? 0 : len - 3), baseY - th * 3, 3, th * 2);
  }
  return nearest(new THREE.CanvasTexture(c));
}

export class Parallax {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.layers = [];
    this.currentLevel = -1;
    this._generation = 0;
  }

  async setLevel(level) {
    if (this.currentLevel === level.id) return;
    this.currentLevel = level.id;
    // Loading a level's art is async, and loading two levels back to back
    // interleaves: the first call clears the layers and then awaits, the second
    // clears an already-empty list and awaits, and both push their results --
    // leaving six layers and a doubled backdrop. A generation counter makes any
    // superseded call drop its work on the floor.
    const gen = ++this._generation;

    for (const l of this.layers) {
      this.group.remove(l.mesh);
      l.mesh.geometry.dispose();
      l.mesh.material.map?.dispose();
      l.mesh.material.dispose();
    }
    this.layers = [];

    // Far: the level painting, cover-fit and pushed back.
    const art = LEVEL_ART[level.id] ? await loadImage(LEVEL_ART[level.id]) : null;
    if (gen !== this._generation) return;   // superseded mid-load
    let farMap;
    if (art) {
      farMap = levelArtTexture(art, 960, 1.0, 0.45);   // desaturate only
    // Brightness is applied through the material rather than baked in, because
    // the post pass re-encodes linear -> sRGB and that lift is not linear: a
    // factor applied to the canvas pixels comes out roughly squared on screen.
    // Measured against a target backdrop level rather than guessed.
    } else {
      farMap = trunksTexture(1);
    }
    const midMap = trunksTexture(1000 + level.id * 37);
    const nearMap = foregroundTexture(2000 + level.id * 53);

    const specs = [
      // Tuned by measuring the rendered result: the playfield is near-black, so
      // the backdrop has to sit well under it or the emerald pool reads as the
      // subject. See the note where the texture is built.
      { map: farMap, z: LAYER_Z[0], opacity: 1.0, depth: false, cover: true,
        brightness: 0x50 },
      { map: midMap, z: LAYER_Z[1], opacity: 0.30, depth: false, cover: false },
      { map: nearMap, z: LAYER_Z[2], opacity: 0.85, depth: true, cover: false },
    ];

    for (let d = 0; d < specs.length; d++) {
      const s = specs[d];
      const mat = new THREE.MeshBasicMaterial({
        map: s.map,
        color: s.brightness ?? 0xffffff,
        transparent: true,
        opacity: s.opacity,
        depthWrite: false,
        depthTest: false,
      });
      const img = s.map.image;
      const aspect = img.width / img.height;

      // The level paintings are portrait (1.png is 1152x2048) and the view is
      // 480x270. A literal cover-fit scales to the view's width, which shows a
      // random vertical slice -- in L1 that landed on a bright emerald pillar
      // filling the middle of the screen. Instead the painting is scaled so its
      // full height covers the view, then tiled across at its natural width. The
      // whole composition (arch, stairs, gate) stays legible as a backdrop.
      const planeH = s.cover ? LOW_RES_H * 1.3 : LOW_RES_H * 1.2;
      const tileW = s.cover ? planeH * aspect : LAYER_TILE_W;
      const planeW = LOW_RES_W * 1.3;
      s.map.wrapS = THREE.RepeatWrapping;
      s.map.repeat.x = planeW / tileW;
      s.map.repeat.y = 1;

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), mat);
      mesh.position.z = s.z;
      mesh.frustumCulled = false;
      // Explicit, because the whole scene shares z and the sort would otherwise
      // fall through to object ids.
      mesh.renderOrder = d === 0 ? -20 : d === 1 ? -10 : 40;
      this.group.add(mesh);
      this.layers.push({ mesh, mult: LAYER_PARALLAX[d], isNear: d === 2 });
    }
  }

  update(camX, camY) {
    // Each layer is centred on the view and then pulled back by camX*mult, so
    // it stays covering the frame while scrolling at `mult` of the camera's
    // speed. Offsetting by -camX*mult alone (the earlier form) slides the layer
    // off the side of the screen instead of parallaxing it.
    for (const l of this.layers) {
      l.mesh.position.x = (camX + LOW_RES_W / 2) - camX * l.mult;
      l.mesh.position.y = l.isNear
        ? (camY - LOW_RES_H * 0.02) - camY * l.mult * 0.25
        : (camY + LOW_RES_H / 2) - camY * l.mult;
    }
  }
}

// The vertical gradient behind everything. Not a parallax layer, because it
// must not move: it is the "sky", and a sliding sky looks wrong.
export class Sky {
  constructor(scene) {
    this.material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(LOW_RES_W * 1.05, LOW_RES_H * 1.15), this.material);
    this.mesh.position.z = -60;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setLevel(level) {
    const [a, b, c] = level.sky;
    this.material.color.set(0xffffff);
    this.material.map = gradientTexture(a, b, c);
    this.material.needsUpdate = true;
  }
}

function gradientTexture(a, b, c) {
  const canvas = document.createElement('canvas');
  canvas.width = 8; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, hex(a));
  g.addColorStop(0.55, hex(b));
  g.addColorStop(1, hex(c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  return nearest(new THREE.CanvasTexture(canvas));
}
