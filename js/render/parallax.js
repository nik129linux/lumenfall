import * as THREE from '../vendor/three.module.js';
import { LOW_RES_W, LOW_RES_H, FLOOR_Y } from '../core/config.js';
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
const BACK_W = 600;
const BACK_H = 338;

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
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, BACK_W, BACK_H);
}

function cropFromPainting(img, y0frac, y1frac) {
  const c = newCanvas(BACK_W, BACK_H);
  const ctx = c.getContext('2d');
  const top = Math.round(img.height * y0frac);
  const bottom = Math.round(img.height * y1frac);
  let sh = bottom - top;
  let sw = Math.min(img.width, Math.round(sh * (BACK_W / BACK_H)));
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
    // Fraction of the painting's height where its dark ground band starts.
    this.groundLine = 0.8;
  }

  async setLevel(level) {
    if (this.currentLevel === level.id) return;
    this.currentLevel = level.id;
    // Loading is async and levels can be loaded back to back; without a
    // generation guard the two interleave and leave doubled layers.
    const gen = ++this._generation;
    this.levelWorldWidth = (level.width || 190) * 8;
    this.groundLine = level.groundLine ?? 0.8;

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
        const c = newCanvas(BACK_W, BACK_H);
        const ctx = c.getContext('2d');
        // Centre-crop the supplied art to 16:9 rather than stretching it.
        const target = BACK_W / BACK_H;
        let sw = img.width, sh = img.height;
        if (img.width / img.height > target) sw = Math.round(img.height * target);
        else sh = Math.round(img.width / target);
        const sx = Math.round((img.width - sw) / 2);
        const sy = Math.round((img.height - sh) / 2);
        smoothScale(ctx, img, sx, sy, sw, sh);
        return c;
      }
    }

    if (level.id === 3) return lanternWood();

    const crop = FALLBACK_CROP[level.id];
    if (!crop) return null;
    const src = { 1: '1.png', 2: '2.jpg' }[level.id];
    const img = await loadImage(src);
    if (!img) return null;
    return cropFromPainting(img, crop[0], crop[1]);
  }

  update(camX, camY) {
    // The far backdrop pans once across the level: offset runs 0 -> 120px as
    // the camera crosses the level. Tiling would repeat it, which is what stage
    // 1 did wrong.
    const span = Math.max(1, this.levelWorldWidth - LOW_RES_W);
    const progress = Math.max(0, Math.min(1, camX / span));
    const farOffset = progress * (BACK_W - LOW_RES_W);
    const cx = camX + LOW_RES_W / 2;

    for (const l of this.layers) {
      if (l.isFar) {
        // Centre the crop on the *view*, not on the camera, so it covers the
        // full 480px at every pan value: the left edge runs 0 -> -120 and the
        // right edge 600 -> 480, which always spans the viewport exactly once.
        l.mesh.position.x = cx + (BACK_W - LOW_RES_W) / 2 - farOffset;

        // Vertically, the crop is planted on the floor instead of being centred
        // in the view. Each painting's bottom ~35% is an empty dark ground band,
        // so what has to line up is the painting's ground line and our floor top
        // -- otherwise the painted ruins float a hundred pixels below the floor
        // and the band that should be under them is above it.
        //
        // The world is y-up and the camera bottom sits at camY, so the crop's
        // top edge is at mesh.y + BACK_H/2 and the ground line at
        // mesh.y + BACK_H/2 - groundLine * BACK_H. Solving for the floor puts
        // mesh.y at groundLine * BACK_H + FLOOR_Y - BACK_H/2.
        // Clamped so the crop still covers the whole view top to bottom: the
        // upper bound keeps its top edge above the view top, the lower bound
        // keeps its bottom edge below the view bottom. L2's ground line sits high
        // enough in its painting that honouring it exactly would expose sky
        // along the top edge, so it settles ~4px above the floor instead -- which
        // the brief allows, and the empty ground band hides the difference.
        const floorAligned = this.groundLine * BACK_H + FLOOR_Y - BACK_H / 2;
        const coverTop = camY + LOW_RES_H - BACK_H / 2;
        const coverBottom = camY + BACK_H / 2;
        l.mesh.position.y = Math.max(coverTop, Math.min(coverBottom, floorAligned));
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
