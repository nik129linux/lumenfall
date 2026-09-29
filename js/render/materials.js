import * as THREE from '../vendor/three.module.js';

// Sprite material.
//
// Stage 1 stripped this down hard. It used to posterise colour depth, apply a
// Bayer dither, trim saturation and push a per-level grade -- all of which ran
// the atlas texels through arithmetic before they reached the screen. That is
// why Kael rendered brown: his teal cloak and silver armour were being pulled
// toward whatever the level grade said they should be.
//
// The sprite shader now does two things and stops: it samples the atlas, and it
// draws a 1px outline from the alpha neighbours. The pixel look comes from the
// 480x270 buffer and the NEAREST upscale, not from mangling the source. Any
// colour in the sheet is the colour the player sees.

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
  uniform vec4  tint;
  uniform float flash;        // 0..1 white-out when the sprite takes a hit
  uniform float alphaScale;
  uniform vec3  outlineColor;
  uniform float outlineOn;

  varying vec2 vUv;

  vec2 texel() { return vec2(1.0) / vec2(textureSize(map, 0)); }

  void main() {
    vec2 px = gl_FragCoord.xy;
    vec4 c = texture2D(map, vUv);

    if (c.a < 0.02) {
      // Outline: drawn in buffer pixels, so it stays a hard 1px line and never
      // a soft halo. Threshold is high on purpose -- at a low one, a sprite with
      // soft alpha (the statue) gets outlined across its whole interior.
      if (outlineOn > 0.5) {
        vec2 t = texel();
        float a = 0.0;
        a += texture2D(map, vUv + vec2( t.x, 0.0)).a;
        a += texture2D(map, vUv + vec2(-t.x, 0.0)).a;
        a += texture2D(map, vUv + vec2(0.0,  t.y)).a;
        a += texture2D(map, vUv + vec2(0.0, -t.y)).a;
        if (a > 0.85) {
          gl_FragColor = vec4(outlineColor, 1.0);
          return;
        }
      }
      discard;
    }

    // Atlas texel, unchanged apart from the hit flash.
    vec3 col = mix(c.rgb * tint.rgb, vec3(1.0), flash);
    gl_FragColor = vec4(col, c.a * alphaScale);
  }
`;

export function makeSpriteMaterial(texture, opts = {}) {
  const uniforms = {
    map: { value: texture },
    tint: { value: new THREE.Vector4(1, 1, 1, 1) },
    flash: { value: 0 },
    alphaScale: { value: 1 },
    outlineColor: { value: new THREE.Color(opts.outline ?? 0x05070a) },
    outlineOn: { value: opts.outline ? 1 : 0 },
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
