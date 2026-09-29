import * as THREE from '../vendor/three.module.js';

// Procedural minion art.
//
// Stage 1 removed the old mapping that drew wisps with the demon, crawlers with
// the statue and spitters with Ul Burjo -- which meant the final boss walked
// around level 1 in his own sheet. These are silhouettes instead.
//
// They are silhouettes on purpose. The painted characters carry teal cloaks,
// silver plate and orange rim light; anything with that much detail at 10-20px
// would compete with Kael for attention. A black shape with two accent-coloured
// eye pixels reads instantly against all three backdrops and stays clearly
// secondary to the cast.

// Hard ceiling on an entity's additive halo, in buffer pixels. See makeGlowTexture.
const MAX_GLOW_PX = 40;

const SHAPES = {
  wisp: [
    '..1111..',
    '.111111.',
    '11222111',
    '11222111',
    '.111111.',
    '..1111..',
  ],
  crawler: [
    '.1111111111.',
    '111111111111',
    '112111111121',
    '.1111111111.',
    '..1.1.1.1.1.',
  ],
  // Second crawler pose: the leg pixels move, which is the whole walk cycle at
  // this size. Anything finer just turns to noise.
  'crawler:2': [
    '.1111111111.',
    '111111111111',
    '112111111121',
    '.1111111111.',
    '.1.1.1.1.1..',
  ],
  spitter: [
    '....1111....',
    '..11111111..',
    '.1111111111.',
    '112111111211',
    '112111111111',
    '.1111111111.',
    '.1111111111.',
    '..11111111..',
    '..11....11..',
    '..11....11..',
  ],
};

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Body and eyes are baked into two textures so one shape serves all three
// levels: the eyes take the level's accent colour, the body stays black.
const FRAG = /* glsl */`
  precision mediump float;
  uniform sampler2D bodyMask;
  uniform sampler2D eyeMask;
  uniform vec3  eyeColor;
  uniform vec3  bodyColor;
  uniform float alphaScale;
  uniform float flash;
  varying vec2 vUv;

  void main() {
    float b = texture2D(bodyMask, vUv).a;
    float e = texture2D(eyeMask, vUv).a;
    if (b < 0.02 && e < 0.02) discard;
    vec3 col = mix(bodyColor, eyeColor, clamp(e, 0.0, 1.0));
    col = mix(col, vec3(1.0), flash);
    gl_FragColor = vec4(col, max(b, e) * alphaScale);
  }
`;

function nearest(tex) {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// '1' is body, '2' is an eye, '.' is empty.
function makeShape(rows) {
  const rw = rows[0].length;
  const cw = rw + 4;
  const ch = rows.length + 4;
  const body = document.createElement('canvas');
  body.width = cw; body.height = ch;
  const bimg = body.getContext('2d').createImageData(cw, ch);
  const eyes = document.createElement('canvas');
  eyes.width = cw; eyes.height = ch;
  const eimg = eyes.getContext('2d').createImageData(cw, ch);

  const ox = 2, oy = 2;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rw; x++) {
      const v = rows[y][x];
      if (v === '.') continue;
      const i = ((oy + y) * cw + (ox + x)) * 4;
      bimg.data[i] = 255; bimg.data[i + 3] = 255;
      if (v === '2') eimg.data[i] = 255; eimg.data[i + 3] = 255;
    }
  }
  body.getContext('2d').putImageData(bimg, 0, 0);
  eyes.getContext('2d').putImageData(eimg, 0, 0);
  return { body: nearest(new THREE.CanvasTexture(body)),
           eyes: nearest(new THREE.CanvasTexture(eyes)),
           cell: [cw, ch] };
}

// The one texture in the game that is NOT NEAREST. A 32px radial gradient
// sampled with NearestFilter shows its individual texels, so a halo read as a
// grid of visible squares. Silhouettes stay NEAREST on purpose -- that
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
  // More stops than the old 32px version: with a smooth filter the falloff
  // itself has to be smooth, or the steps between stops stay visible as rings.
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

export class MinionArt {
  constructor() {
    this.shapes = {};
    for (const [k, rows] of Object.entries(SHAPES)) this.shapes[k] = makeShape(rows);
    this.glow = makeGlowTexture();
  }

  material(kind, accent) {
    const shape = this.shapes[kind];
    if (!shape) throw new Error(`unknown minion kind: ${kind}`);
    return new THREE.ShaderMaterial({
      uniforms: {
        bodyMask: { value: shape.body },
        eyeMask: { value: shape.eyes },
        eyeColor: { value: new THREE.Color(accent) },
        bodyColor: { value: new THREE.Color(0x05070a) },
        alphaScale: { value: 1 },
        flash: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }

  cell(kind) { return this.shapes[kind].cell; }

  // Builds the two-frame variant used by the crawler's walk.
  materialVariant(kind, variant, accent) {
    const key = `${kind}:${variant}`;
    if (!this.shapes[key]) return this.material(kind, accent);
    const shape = this.shapes[key];
    return new THREE.ShaderMaterial({
      uniforms: {
        bodyMask: { value: shape.body },
        eyeMask: { value: shape.eyes },
        eyeColor: { value: new THREE.Color(accent) },
        bodyColor: { value: new THREE.Color(0x05070a) },
        alphaScale: { value: 1 },
        flash: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
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

// Adapter that gives the procedural art the same surface Sprite exposes, so
// Enemy and the bosses need no special-casing.
export class MinionSprite {
  constructor(art, kind, accent, opts = {}) {
    this.kind = kind;
    this.art = art;
    this.cell = art.cell(kind);
    this.facing = 1;
    this.t = 0;
    this.frame = 0;

    this.material = art.material(kind, accent);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.geometry.translate(0, 0.5, 0);
    this.mesh.scale.set(this.cell[0] * (opts.scale ?? 1), this.cell[1] * (opts.scale ?? 1), 1);

    // Additive halo behind the body. Wisps get it full strength; the ground
    // types get a trace so their eyes still read in a dark level.
    this.eyeColorHex = accent;
    this.glowMat = art.glowMaterial(accent);
    this.glowMat.opacity = kind === 'wisp' ? 0.45 : 0.07;
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.position.z = -0.1;
    // Halos are capped at 40 buffer px. A wisp cell is 12px, so 3x is 36 and
    // already under the cap; the clamp is here so a bigger kind cannot turn an
    // additive halo into a screen-wide wash that flattens the backdrop.
    this.glowSize = Math.min(MAX_GLOW_PX, kind === 'wisp' ? this.cell[0] * 3.0 : this.cell[0] * 1.25);
    this.glow.scale.set(this.glowSize, this.glowSize, 1);
    this.mesh.add(this.glow);
  }

  get object() { return this.mesh; }

  play(clip, opts = {}) { this.clip = clip; }
  setLoop() {}

  setFacing(dir) {
    if (!dir) return;
    this.facing = dir > 0 ? 1 : -1;
    // Minions are drawn symmetric, so facing is a plain mirror with no
    // nativeFacing to reason about.
    this.mesh.scale.x = Math.abs(this.mesh.scale.x) * this.facing;
  }

  update(dt) {
    this.t += dt;
    if (this.kind === 'wisp') {
      this.mesh.position.y = (this.baseY ?? this.mesh.position.y) + Math.sin(this.t * 2.6) * 3;
    } else if (this.kind === 'crawler') {
      // Swap the leg pose at ~8Hz.
      const want = Math.floor(this.t * 8) % 2;
      if (want !== this.frame) {
        this.frame = want;
        const m = this.art.materialVariant('crawler', 2, this.eyeColorHex);
        this.mesh.material = m;
        this.material = m;
      }
    }
  }

  setFlash(v) {
    const u = this.material.uniforms;
    if (u && u.flash) u.flash.value = v;
  }

  setSquash(a) { /* silhouettes do not squash */ }
}
