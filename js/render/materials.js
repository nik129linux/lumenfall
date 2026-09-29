import * as THREE from '../vendor/three.module.js';

// Sprite material: the "Tenebris Somnia" look lives here.
//
// Three things make a sprite read as gritty pixel art rather than a small photo:
//   1. colour is snapped to a small per-level palette, so the mid-tones stay
//      desaturated and only the emissive accents keep their hue
//   2. a 1px outline is drawn from the alpha neighbours, sampled *in buffer
//      pixels*, so the edge is a hard chunky line and never a soft halo
//   3. dithering is applied when snapping to the palette, which keeps gradients
//      from banding into visible steps at this resolution

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision mediump float;

  uniform sampler2D map;
  uniform float levels;       // colour-depth cut; the actual "pixel" look
  uniform vec3  grade;       // per-level channel multiplier
  uniform float gradeLift;   // per-level brightness lift
  uniform float saturation;  // saturation trim
  uniform vec4  tint;
  uniform float flash;        // 0..1 white-out when the sprite takes a hit
  uniform float alphaScale;
  uniform vec3  outlineColor;
  uniform float outlineOn;
  uniform float dither;

  varying vec2 vUv;

  vec2 texel() { return vec2(1.0) / vec2(textureSize(map, 0)); }

  // 4x4 Bayer matrix, normalised to -0.5..0.5. Cheaper and steadier than a
  // hash and it tiles predictably, which matters when the whole frame is 480px.
  float bayer(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    int i = x + y * 4;
    float m[16];
    m[0]=0.0;  m[1]=8.0;  m[2]=2.0;  m[3]=10.0;
    m[4]=12.0; m[5]=4.0;  m[6]=14.0; m[7]=6.0;
    m[8]=3.0;  m[9]=11.0; m[10]=1.0; m[11]=9.0;
    m[12]=15.0;m[13]=7.0; m[14]=13.0;m[15]=5.0;
    float v = 0.0;
    for (int k = 0; k < 16; k++) { if (k == i) v = m[k]; }
    return v / 16.0 - 0.5;
  }

  vec4 src(vec2 uv) { return texture2D(map, uv); }

  void main() {
    vec2 px = gl_FragCoord.xy;
    vec4 c = src(vUv);

    if (c.a < 0.02) {
      if (outlineOn > 0.5) {
        vec2 t = texel();
        float a = 0.0;
        a += src(vUv + vec2( t.x, 0.0)).a;
        a += src(vUv + vec2(-t.x, 0.0)).a;
        a += src(vUv + vec2(0.0,  t.y)).a;
        a += src(vUv + vec2(0.0, -t.y)).a;
        if (a > 0.85) {
          gl_FragColor = vec4(outlineColor, 1.0);
          return;
        }
      }
      discard;
    }

    vec3 col = c.rgb * tint.rgb;

    // Posterise rather than snap-to-a-palette.
    //
    // An earlier version snapped every sprite to one of eight per-level colours.
    // That does quantise beautifully -- and it also turns Kael's brown and blue
    // into emerald, so the hero vanished into the shrine he was supposed to stand
    // out from. Grit comes from cutting colour *depth*, not from throwing hue
    // away. Level identity comes from the grade below, which shifts the whole
    // sprite without erasing what colour it was.
    if (levels > 1.5) {
      float d = bayer(px) * dither;
      col = floor((col + d) * levels) / levels;
    }

    // Per-level grade: a slight push toward the level's key colour, plus a
    // saturation trim. Keeps the palette coherent without flattening the art.
    col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, saturation);
    col = col * grade + gradeLift;

    col = mix(col, vec3(1.0), flash);

    gl_FragColor = vec4(col, c.a * alphaScale);
  }
`;

export function makeSpriteMaterial(texture, opts = {}) {
  const uniforms = {
    map: { value: texture },
    levels: { value: opts.levels ?? 7 },
    grade: { value: new THREE.Vector3(1, 1, 1) },
    gradeLift: { value: 0 },
    saturation: { value: opts.saturation ?? 0.9 },
    tint: { value: new THREE.Vector4(1, 1, 1, 1) },
    flash: { value: 0 },
    alphaScale: { value: 1 },
    outlineColor: { value: new THREE.Color(opts.outline ?? 0x05070a) },
    outlineOn: { value: opts.outline ? 1 : 0 },
    dither: { value: opts.dither ?? 0.09 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  mat.userData.uniforms = uniforms;
  return mat;
}

// Per-level grades, sampled from the reference art.
//
// `lift` matters more than it looks. The source sprites are painted dark, and
// the post pass then applies grain, a vignette and (in L3) near-total darkness
// on top. Without a lift the whole game renders as black rectangles.
export const GRADES = {
  1: { grade: [0.92, 1.06, 0.96], lift: 0.04, saturation: 0.92, levels: 7 },
  2: { grade: [1.02, 0.90, 1.12], lift: 0.04, saturation: 0.90, levels: 7 },
  3: { grade: [1.14, 0.94, 0.84], lift: 0.06, saturation: 0.88, levels: 6 },
  neutral: { grade: [1, 1, 1], lift: 0.10, saturation: 0.92, levels: 7 },
};

export function setPalette(mat, levelId) {
  const g = GRADES[levelId] || GRADES.neutral;
  const u = mat.userData.uniforms;
  u.grade.value.set(g.grade[0], g.grade[1], g.grade[2]);
  u.gradeLift.value = g.lift;
  u.saturation.value = g.saturation;
  u.levels.value = g.levels;
}

// Bosses get a brightness lift. They are the largest dark shapes on screen and
// the source art is painted dark, so without this they read as holes in the
// level rather than as characters.
export function setLift(mat, extra) {
  mat.userData.uniforms.gradeLift.value += extra;
}
