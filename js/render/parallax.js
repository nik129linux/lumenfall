import * as THREE from '../vendor/three.module.js';
import { LOW_RES_W, LOW_RES_H } from '../core/config.js';
import { makeRng } from '../core/rng.js';

// Three parallax layers per level, at real z depths so the ortho camera still
// separates them and the scene has dimension behind the gameplay plane.
//
// assets/bg/ ships empty, so the procedural path below is the one that actually
// runs. Optional layer art is opt-in through assets/bg/manifest.json rather than
// by probing for filenames that do not exist -- probing means a 404 in the
// console on every single load, which reads as a broken game.
const LAYER_Z = [-40, -20, -8];
const LAYER_W = LOW_RES_W * 2.4;

let bgManifest = null;

async function loadBgManifest() {
  if (bgManifest) return bgManifest;
  try {
    const res = await fetch('assets/bg/manifest.json');
    bgManifest = res.ok ? await res.json() : { levels: {} };
  } catch (e) {
    bgManifest = { levels: {} };
  }
  return bgManifest;
}

function tryLoad(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// --- procedural silhouette shapes ------------------------------------------
// Each is drawn into a 2D context in a normalised 0..1 space, then scaled up.
// Deliberately blocky: at this buffer size a smooth curve would be indistinguishable
// from a straight line anyway, and hard steps match the pixel grid.

function drawLayer(ctx, w, h, level, depth, rng) {
  const theme = {
    1: { near: 'tree', mid: 'tree', far: 'arch' },
    2: { near: 'column', mid: 'crystal', far: 'arch' },
    3: { near: 'tree', mid: 'reed', far: 'haze' },
  }[level];
  const kind = depth === 0 ? theme.far : depth === 1 ? theme.mid : theme.near;

  if (kind === 'haze') {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#00000000');
    g.addColorStop(1, '#ffffff18');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  const count = depth === 0 ? 7 : depth === 1 ? 11 : 15;
  for (let i = 0; i < count; i++) {
    const x = Math.floor((i / count) * w + rng.range(-w * 0.02, w * 0.02));
    const baseY = h;
    const scale = (depth === 0 ? 0.45 : depth === 1 ? 0.7 : 1.0) * rng.range(0.75, 1.15);

    if (kind === 'tree') {
      const th = h * 0.95 * scale;
      const tw = Math.max(3, w * 0.012 * scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, baseY - th, tw, th);
      // Angular branches, in keeping with the reference art.
      const branches = 4 + Math.floor(rng.range(0, 4));
      for (let b = 0; b < branches; b++) {
        const by = baseY - th * rng.range(0.35, 0.95);
        const dir = rng.sign();
        const bl = w * rng.range(0.02, 0.06) * scale;
        const rise = th * rng.range(0.05, 0.18);
        ctx.beginPath();
        ctx.moveTo(x, by);
        ctx.lineTo(x + dir * bl, by - rise);
        ctx.lineTo(x + dir * bl, by - rise + tw * 1.6);
        ctx.lineTo(x, by + tw);
        ctx.closePath();
        ctx.fill();
      }
    } else if (kind === 'column') {
      const ch = h * 0.9 * scale;
      const cw = Math.max(4, w * 0.016 * scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, baseY - ch, cw, ch);
      ctx.fillRect(x - cw * 0.6, baseY - ch, cw * 2.2, ch * 0.04);
      ctx.fillRect(x - cw * 0.4, baseY - ch * 0.06, cw * 1.8, ch * 0.06);
    } else if (kind === 'crystal') {
      const ch = h * 0.6 * scale;
      const cw = Math.max(3, w * 0.014 * scale);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, baseY - ch);
      ctx.lineTo(x + cw, baseY - ch * 0.45);
      ctx.lineTo(x + cw * 0.6, baseY);
      ctx.lineTo(x - cw * 0.6, baseY);
      ctx.lineTo(x - cw, baseY - ch * 0.45);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'reed') {
      const ch = h * 0.7 * scale;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, w * 0.004 * scale);
      for (let s = 0; s < 4; s++) {
        const ox = x + s * w * 0.006;
        ctx.beginPath();
        ctx.moveTo(ox, baseY);
        ctx.quadraticCurveTo(ox + rng.range(-w * 0.01, w * 0.01), baseY - ch * 0.5,
                             ox + rng.range(-w * 0.02, w * 0.02), baseY - ch);
        ctx.stroke();
      }
    } else if (kind === 'arch') {
      const ah = h * 0.55 * scale;
      const aw = w * 0.07 * scale;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, baseY - ah, aw, ah);
      ctx.fillRect(x + aw, baseY - ah, aw, ah);
      ctx.fillRect(x, baseY - ah, aw * 2, aw * 0.5);
    }
  }
}

async function makeLayerTexture(levelIndex, depth, tint, seed) {
  const manifest = await loadBgManifest();
  const files = manifest.levels?.[String(levelIndex + 1)] || [];
  const file = files[depth];

  if (file) {
    const img = await tryLoad(`assets/bg/${file}`);
    if (img) {
      const tex = new THREE.Texture(img);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.wrapS = THREE.RepeatWrapping;
      tex.repeat.x = 2;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      return tex;
    }
  }

  const w = 512, h = 288;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  drawLayer(ctx, w, h, levelIndex + 1, depth, makeRng(seed + depth * 977));

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = 2;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class Parallax {
  constructor(scene) {
    this.group = new THREE.Group();
    this.layers = [];
    scene.add(this.group);
    this.currentLevel = -1;
  }

  async setLevel(level) {
    if (this.currentLevel === level.id) return;
    this.currentLevel = level.id;

    for (const l of this.layers) {
      this.group.remove(l.mesh);
      l.mesh.geometry.dispose();
      l.mesh.material.map?.dispose();
      l.mesh.material.dispose();
    }
    this.layers = [];

    for (let d = 0; d < 3; d++) {
      const def = level.layers[d];
      const tex = await makeLayerTexture(level.id - 1, d, def.tint, 1234 + level.id * 100);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: def.tint,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        opacity: d === 0 ? 0.7 : d === 1 ? 0.8 : 0.9,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(LAYER_W, LAYER_W * (hRatio())), mat);
      mesh.position.z = LAYER_Z[d];
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.layers.push({ mesh, mult: def.mult, y: def.y });
    }
  }

  update(camX, camY) {
    for (const l of this.layers) {
      // Each layer slides at its own rate and is wrapped, so the level can be
      // wider than the screen without the backdrop running out.
      l.mesh.position.x = -camX * l.mult;
      l.mesh.position.y = camY * l.mult + l.y * LOW_RES_H * 0.4;
    }
  }
}

function hRatio() { return LOW_RES_H / LOW_RES_W; }

// The vertical gradient behind everything. Not a layer, because it must not
// parallax at all -- it is the "sky", and a sliding sky looks wrong.
export class Sky {
  constructor(scene) {
    this.material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(LOW_RES_W * 1.05, LOW_RES_H * 1.15), this.material);
    this.mesh.position.z = -60;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  setLevel(level) {
    const [a, b, c] = level.sky;
    this.material.color.set(0xffffff);   // the map carries the colour
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
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
