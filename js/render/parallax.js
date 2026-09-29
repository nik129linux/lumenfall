import * as THREE from '../vendor/three.module.js';
import { LOW_RES_W, LOW_RES_H } from '../core/config.js';
import { makeRng } from '../core/rng.js';

// Three parallax layers per level.
//
// Stage 1b rewrote the far layer. Stage 1 scaled the whole painting to cover the
// view, which was wrong twice over: the paintings are portrait, so that showed a
// random vertical slice, and it was then tiled to fill -- giving huge blurry
// blocks with visible seams. L3 came out dark blue, because 3.jpg is a drawing
// of a demon under brown trees, not a burnt-orange sky.
//
// The rule now:
//   * a purpose-made `assets/bg/lN.png` is used whole if the manifest lists one
//   * otherwise a fixed 16:9 crop of the painting: L1 the arch and statues, L2
//     the gothic arch, and L3 procedural (3.jpg carries a demon and the words
//     "PATIENT IS THE NIGHT", so it is not used as a backdrop at all)
//   * drawn ONCE into a 600x338 canvas, never tiled, scrolling across the level
//
// 600 is wider than the 480px view on purpose: that 120px of slack is the
// scroll range, so the backdrop pans once over the length of a level instead of
// repeating. One canvas texel is one buffer pixel.

const LAYER_Z = [-40, -20, 6];
const LAYER_PARALLAX = [0.10, 0.40, 1.20];

// The backdrop canvas. 600x338: 600 = view width + 120px of scroll slack,
// 338 = 600 / 16:9, which is 68px taller than the view so the whole crop is
// reachable vertically.
// 600 x 270. The height is exactly the view height (LOW_RES_H), so the painting
// is fitted to the view top to bottom and nothing is cut off -- the L1 arch used
// to be sliced because the canvas was 338 tall, 68px more than the view. The
// width is the view width plus 120px, which is the slack the horizontal parallax
// slides through. One canvas texel is one buffer pixel.
const BACK_W = 600;
const BACK_H = 270;
const PAINT_W = 480;   // BACK_H at 16:9: the painting drawn at its natural shape
const SLACK = (BACK_W - PAINT_W) / 2;

// How far the backdrop slides across a level, as a fraction of the camera's own
// travel. The brief asks for 0.1.
const FAR_PARALLAX = 0.10;

// Fractions of source height, full width, centre-cropped to 16:9.
const FALLBACK_CROP = {
  1: [0.28, 0.60],   // the arch, the statues and the steps; above the pool
  2: [0.00, 0.32],   // the gothic arch and its windows; above the goblin
};

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

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function nearestClamp(tex) {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Smoothing ON. This is a downscale (1152px of source into 600), and stage 1
// had imageSmoothingEnabled off because the sprites were NEAREST -- applied to the
// backdrop that turned the downscale into aliased noise.
function smoothScale(ctx, img, sx, sy, sw, sh) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, PAINT_W, BACK_H);
}

// The bottom 40% of a painting is floor, steps, a pool, statue bases: things
// that look walkable but are not, and the reason the playfield read as floating.
// Graded to 85% black it reads as distant ground instead, leaving our own floor
// and its coloured lip as the only surface that looks standable.
function darkenGround(ctx) {
  const y0 = Math.round(BACK_H * 0.60);
  const g = ctx.createLinearGradient(0, y0, 0, BACK_H);
  g.addColorStop(0.00, 'rgba(0,0,0,0)');
  g.addColorStop(0.50, 'rgba(0,0,0,0.52)');
  g.addColorStop(1.00, 'rgba(0,0,0,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, BACK_W, BACK_H - y0);
}

// The painting is 480 wide in a 600 canvas, so the 60px of slack on each side
// is filled by mirroring the painting's own edge columns. An edge smear would
// be visible at 480x270; a mirror is not, and it is still one authored canvas
// drawn once -- ClampToEdge and repeat 1,1 hold either way.
function paintBackdrop(source) {
  const c = newCanvas(BACK_W, BACK_H);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, SLACK, 0);
  ctx.save();
  ctx.translate(SLACK * 2, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, 0, 0, SLACK, BACK_H, 0, 0, SLACK, BACK_H);
  ctx.restore();
  ctx.save();
  ctx.translate(SLACK, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(source, PAINT_W - SLACK, 0, SLACK, BACK_H, 0, 0, SLACK, BACK_H);
  ctx.restore();
  darkenGround(ctx);
  return c;
}

function cropFromPainting(img, y0frac, y1frac) {
  const c = newCanvas(PAINT_W, BACK_H);
  const ctx = c.getContext('2d');
  const top = Math.round(img.height * y0frac);
  const bottom = Math.round(img.height * y1frac);
  let sh = bottom - top;
  let sw = Math.min(img.width, Math.round(sh * (PAINT_W / BACK_H)));
  let sx = Math.round((img.width - sw) / 2);
  smoothScale(ctx, img, sx, top, sw, sh);
  return c;
}

// L3: 3.jpg is a demon portrait with text in it, so the backdrop is drawn.
// A burnt-orange sky over black bare trees.
function lanternWood() {
  const c = newCanvas(BACK_W, BACK_H);
  const ctx = c.getContext('2d');

  const g = ctx.createLinearGradient(0, 0, 0, BACK_H);
  g.addColorStop(0.00, '#c0601f');
  g.addColorStop(0.45, '#5a2a10');
  g.addColorStop(1.00, '#120806');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BACK_W, BACK_H);

  const rng = makeRng(20260928);
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.lineCap = 'round';

  const trees = 8;
  for (let i = 0; i < trees; i++) {
    const x = Math.round(((i + 0.5) / trees) * BACK_W + rng.range(-14, 14));
    const h = BACK_H * rng.range(0.62, 0.94);
    const baseY = BACK_H;
    const lean = rng.range(-16, 16);
    // Trunk, drawn as a thin run of segments so it can lean and stay crooked.
    const segs = 9;
    for (let s = 0; s < segs; s++) {
      const t = s / segs;
      const sy = baseY - h * t;
      const sx = x + lean * t * t;
      const wTrunk = Math.max(1, Math.round(3.4 * (1 - t * 0.75)));
      ctx.fillRect(Math.round(sx - wTrunk / 2), Math.round(sy), wTrunk, Math.round(h / segs) + 1);
    }
    // Thin crooked branches.
    const branches = 5 + Math.floor(rng.range(0, 4));
    for (let b = 0; b < branches; b++) {
      const t = rng.range(0.45, 0.98);
      const by = baseY - h * t;
      const bx = x + lean * t * t;
      const dir = rng.sign();
      const len = rng.range(16, 52);
      const rise = rng.range(10, 34);
      ctx.lineWidth = Math.max(1, 3 * (1 - t * 0.7));
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + dir * len * 0.55, by - rise * 0.4);
      ctx.lineTo(bx + dir * len, by - rise);
      ctx.stroke();
    }
  }
  darkenGround(ctx);
  return c;
}

// Mid layer: pure black trunks. In stage 1 these read as grey-blue columns,
// which was the far layer's tiled content rather than the trunks -- but the
// colour is pinned here anyway so it cannot drift back.
function trunksCanvas(seed) {
  const c = newCanvas(BACK_W, BACK_H);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  ctx.clearRect(0, 0, BACK_W, BACK_H);
  ctx.fillStyle = '#000000';
  const n = 11;
  for (let i = 0; i < n; i++) {
    const x = Math.round(((i + 0.5) / n) * BACK_W + rng.range(-12, 12));
    const h = BACK_H * rng.range(0.55, 0.8);
    const baseY = BACK_H;
    const tw = Math.max(2, Math.round(BACK_W * rng.range(0.006, 0.013)));
    ctx.fillRect(x, baseY - h, tw, h);
    for (let b = 0; b < 3; b++) {
      const by = baseY - h * rng.range(0.5, 0.95);
      const dir = rng.sign();
      const len = Math.round(BACK_W * rng.range(0.02, 0.05));
      ctx.fillRect(x + (dir > 0 ? 0 : -len), by, len, Math.max(2, Math.round(tw * 0.8)));
    }
  }
  return c;
}

// Near layer: a thin band of grass and low branches along the bottom edge.
function foregroundCanvas(seed) {
  const c = newCanvas(BACK_W, BACK_H);
  const ctx = c.getContext('2d');
  const rng = makeRng(seed);
  ctx.clearRect(0, 0, BACK_W, BACK_H);
  ctx.fillStyle = '#000000';
  const baseY = BACK_H;
  for (let i = 0; i < 90; i++) {
    const x = Math.round(rng.range(0, BACK_W));
    const gh = Math.round(rng.range(6, BACK_H * 0.14));
    ctx.fillRect(x, baseY - gh, 1, gh);
    if (rng.chance(0.3)) ctx.fillRect(x + 1, baseY - gh + 2, 1, Math.max(2, gh - 4));
  }
  for (let i = 0; i < 6; i++) {
    const x = Math.round(rng.range(0, BACK_W));
    const len = Math.round(rng.range(30, 90));
    const th = 3;
    ctx.fillRect(x, baseY - th, len, th);
    ctx.fillRect(x + (rng.chance(0.5) ? 0 : len - 3), baseY - th * 3, 3, th * 2);
  }
  return c;
}

export class Parallax {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.layers = [];
    this.currentLevel = -1;
    this._generation = 0;
    this.levelWorldWidth = LOW_RES_W;
  }

  async setLevel(level) {
    if (this.currentLevel === level.id) return;
    this.currentLevel = level.id;
    // Loading is async and levels can be loaded back to back; without a
    // generation guard the two interleave and leave doubled layers.
    const gen = ++this._generation;
    this.levelWorldWidth = (level.width || 190) * 8;

    for (const l of this.layers) {
      this.group.remove(l.mesh);
      l.mesh.geometry.dispose();
      l.mesh.material.map?.dispose();
      l.mesh.material.dispose();
    }
    this.layers = [];

    const far = await this._buildFar(level);
    if (gen !== this._generation || !far) return;

    // Brightness only. No hue tint and no desaturation: the paintings already
    // carry the right colour, and stage 1 proved what happens when a level grade
    // gets a say -- Kael rendered brown and the backdrop turned blue.
    const specs = [
      // Brightness only, and it stays on the material rather than baked into the
      // canvas: the post pass re-encodes linear -> sRGB, and a factor applied to
      // canvas pixels comes out roughly squared on screen.
      { canvas: far, z: LAYER_Z[0], brightness: level.id === 3 ? 0x909090 : 0x707070, opacity: 1.0, isFar: true },
      { canvas: trunksCanvas(1000 + level.id * 37), z: LAYER_Z[1], brightness: 0x000000, opacity: 0.35, isFar: false },
      { canvas: foregroundCanvas(2000 + level.id * 53), z: LAYER_Z[2], brightness: 0x000000, opacity: 0.85, isFar: false },
    ];

    for (let d = 0; d < specs.length; d++) {
      const s = specs[d];
      const tex = nearestClamp(new THREE.CanvasTexture(s.canvas));
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        color: s.brightness,
        transparent: true,
        opacity: s.opacity,
        depthWrite: false,
        depthTest: false,
      });
      // 1 canvas texel = 1 buffer pixel, since the canvas is authored at the
      // same scale the world uses.
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BACK_W, BACK_H), mat);
      mesh.position.z = s.z;
      mesh.frustumCulled = false;
      mesh.renderOrder = d === 0 ? -20 : d === 1 ? -10 : 40;
      this.group.add(mesh);
      this.layers.push({ mesh, mult: LAYER_PARALLAX[d], isFar: s.isFar, isNear: d === 2 });
    }
  }

  async _buildFar(level) {
    // A purpose-made landscape backdrop, if the manifest lists one.
    const manifest = await loadBgManifest();
    const listed = manifest.levels?.[String(level.id)] || [];
    const custom = listed.find((f) => /^l\d+\./.test(f));
    if (custom) {
      const img = await loadImage(`assets/bg/${custom}`);
      if (img) {
        const c = newCanvas(PAINT_W, BACK_H);
        const ctx = c.getContext('2d');
        // Centre-crop the supplied art to 16:9 rather than stretching it.
        const target = PAINT_W / BACK_H;
        let sw = img.width, sh = img.height;
        if (img.width / img.height > target) sw = Math.round(img.height * target);
        else sh = Math.round(img.width / target);
        const sx = Math.round((img.width - sw) / 2);
        const sy = Math.round((img.height - sh) / 2);
        smoothScale(ctx, img, sx, sy, sw, sh);
        return paintBackdrop(c);
      }
    }

    if (level.id === 3) return lanternWood();

    const crop = FALLBACK_CROP[level.id];
    if (!crop) return null;
    const src = { 1: '1.png', 2: '2.jpg' }[level.id];
    const img = await loadImage(src);
    if (!img) return null;
    return paintBackdrop(cropFromPainting(img, crop[0], crop[1]));
  }

  update(camX, camY) {
    // The backdrop is fitted to the view height, so vertically it is simply
    // centred on the camera: the whole painting is on screen, top to bottom, at
    // every camera height, and nothing scrolls.
    const cx = camX + LOW_RES_W / 2;
    const cy = camY + LOW_RES_H / 2;

    // Horizontally it parallaxes at FAR_PARALLAX. The canvas is 120px wider than
    // the view, so the slide has to be centred in that slack or the crop runs off
    // an edge and the sky shows through: offsetting by half the slide puts the
    // pan in the middle of the 120px, which covers a 190-tile level with room
    // to spare.
    const travel = Math.max(1, this.levelWorldWidth - LOW_RES_W);
    const slide = FAR_PARALLAX * travel;

    for (const l of this.layers) {
      if (l.isFar) {
        l.mesh.position.x = cx + slide / 2 - camX * FAR_PARALLAX;
        l.mesh.position.y = cy;
      } else if (l.isNear) {
        // Foreground, in front of the playfield. Moves faster than the camera.
        l.mesh.position.x = cx - BACK_W / 2 + camX * (l.mult - 1) * 0.5;
        l.mesh.position.y = camY - 12;
      } else {
        // Mid trunks: centred, a little parallax, and sat low so the trunk
        // bases (drawn at the bottom of their canvas) land near the floor.
        l.mesh.position.x = cx - BACK_W / 2 - camX * l.mult * 0.5;
        l.mesh.position.y = camY - 20 - camY * l.mult * 0.3;
      }
    }
  }
}

// The vertical gradient behind everything. Not a parallax layer, because it
// must not move. With the backdrop now covering the view it should never be
// visible -- it only fills a gap if the painting is missing or misaligned.
export class Sky {
  constructor(scene) {
    this.material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(LOW_RES_W * 1.05, LOW_RES_H * 1.15), this.material);
    this.mesh.position.z = -60;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -30;
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
  const canvas = newCanvas(8, 128);
  const ctx = canvas.getContext('2d');
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, hex(a));
  g.addColorStop(0.55, hex(b));
  g.addColorStop(1, hex(c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 128);
  return nearestClamp(new THREE.CanvasTexture(canvas));
}
