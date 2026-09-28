import * as THREE from '../vendor/three.module.js';
import { LOW_RES_W, LOW_RES_H } from '../core/config.js';

// Renders the game into a 480x270 buffer, then upscales it with a fullscreen
// pass that adds grain, vignette, scanlines and a touch of chromatic
// aberration. The low-res buffer is the whole reason the game looks like this:
// it forces every sprite, particle and gradient to land on a coarse pixel grid.

const POST_FRAG = /* glsl */`
  precision mediump float;

  uniform sampler2D scene;
  uniform vec2  resolution;
  uniform float time;
  uniform float grainAmount;
  uniform float vignette;
  uniform float aberration;
  uniform float scanline;
  uniform float darkness;   // L3: how much to crush everything outside the light
  uniform vec2  lightPos;   // in buffer pixels
  uniform float lightRadius;
  uniform float fade;       // global fade to black, for transitions

  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract((p.x + p.y) * p.x);
  }

  void main() {
    vec2 uv = vUv;
    vec2 centred = uv - 0.5;

    // Chromatic aberration grows toward the edges, so the middle of the screen
    // stays crisp and the corners smear the way a cheap lens would.
    float ab = aberration * dot(centred, centred);
    vec2 dir = normalize(centred + 1e-6);
    vec3 col;
    col.r = texture2D(scene, uv - dir * ab * 0.0016).r;
    col.g = texture2D(scene, uv).g;
    col.b = texture2D(scene, uv + dir * ab * 0.0016).b;

    // Scanlines, locked to buffer rows so they read as a CRT and not as moire.
    float row = floor(uv.y * resolution.y);
    col *= 1.0 - scanline * mod(row, 2.0);

    // In L3 the sword halo is the only light: crush everything outside its
    // radius. Done here rather than with scene lights so it costs one pass.
    // L3: the sword halo is the only light. Two terms, not one: a tight core
    // that falls off hard, plus a wide soft ambient so the level is navigable
    // rather than a black rectangle with a torch in it.
    if (darkness > 0.001) {
      vec2 bufPos = uv * resolution;
      float d = distance(bufPos, lightPos);
      float core = 1.0 - smoothstep(lightRadius * 0.2, lightRadius * 1.3, d);
      float halo = 1.0 - smoothstep(lightRadius * 0.6, lightRadius * 4.5, d);
      float light = 0.30 + 0.70 * core * core + 0.40 * halo;
      col *= mix(1.0, light, darkness);
    }

    // Film grain, animated. Sampled at buffer resolution so the grain is chunky
    // and stays chunky after the upscale.
    float g = hash(floor(uv * resolution) + floor(time * 24.0));
    col += (g - 0.5) * grainAmount;

    // Vignette.
    float v = 1.0 - dot(centred, centred) * vignette;
    col *= clamp(v, 0.0, 1.0);

    col *= fade;

    // Linear -> sRGB.
    //
    // Sprite and canvas textures are tagged sRGB, so the scene pass samples them
    // into linear. This final pass is a raw ShaderMaterial writing straight to
    // the default framebuffer, so nothing encodes it back -- without this the
    // whole game renders about a stop and a half too dark. The pixel grid is
    // untouched; only the transfer function is.
    col = max(col, vec3(0.0));
    col = mix(col * 12.92,
              1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055,
              step(0.0031308, col));

    gl_FragColor = vec4(col, 1.0);
  }
`;

const POST_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export class Pipeline {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, LOW_RES_W, LOW_RES_H, 0, -100, 100);

    // Linear, not sRGB: the post pass does the encode, so the scene pass must
    // store linear values or they get encoded twice.
    this.target = new THREE.WebGLRenderTarget(LOW_RES_W, LOW_RES_H, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    });

    this.postUniforms = {
      scene: { value: this.target.texture },
      resolution: { value: new THREE.Vector2(LOW_RES_W, LOW_RES_H) },
      time: { value: 0 },
      grainAmount: { value: 0.055 },
      vignette: { value: 0.85 },
      aberration: { value: 1.0 },
      scanline: { value: 0.05 },
      darkness: { value: 0 },
      lightPos: { value: new THREE.Vector2(LOW_RES_W / 2, LOW_RES_H / 2) },
      lightRadius: { value: 120 },
      fade: { value: 1 },
    };

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: this.postUniforms,
        vertexShader: POST_VERT,
        fragmentShader: POST_FRAG,
        depthTest: false,
        depthWrite: false,
      })
    );
    quad.frustumCulled = false;
    this.postScene.add(quad);
  }

  // 1 world unit == 1 low-res pixel, so the camera and the sprite cells are the
  // same grid and nothing is ever resampled between them.
  //
  // The level is a horizontal strip only ~272px tall against a 270px-tall
  // viewport, so the camera is clamped to sit at the bottom of the level rather
  // than centred on it. Anything else shows a band of void above the ground.
  setView(x, y) {
    this.camera.left = x;
    this.camera.right = x + LOW_RES_W;
    this.camera.top = y + LOW_RES_H;
    this.camera.bottom = y;
    this.camera.updateProjectionMatrix();
    this.viewX = x;
    this.viewY = y;
  }

  get viewSize() { return { w: LOW_RES_W, h: LOW_RES_H }; }

  screenToBuffer(wx, wy) {
    return { x: wx - this.camera.left, y: wy - this.camera.bottom };
  }

  setLevelLook(level) {
    this.postUniforms.grainAmount.value = level.id === 3 ? 0.055 : 0.04;
    // A strong vignette on a 480px buffer eats most of the frame. Kept mild
    // except in L3, where crushing the edges is the point.
    this.postUniforms.vignette.value = level.id === 3 ? 0.75 : 0.55;
    this.postUniforms.aberration.value = level.id === 3 ? 1.4 : 0.8;
    this.postUniforms.darkness.value = level.id === 3 ? 1 : 0;
  }

  setLight(px, py, radius) {
    this.postUniforms.lightPos.value.set(px, py);
    this.postUniforms.lightRadius.value = radius;
  }

  setFade(v) { this.postUniforms.fade.value = v; }

  // The sky is a fullscreen backdrop pinned to the camera, not a quad sitting at
  // a fixed world position. Without this it only covers the 0..LOW_RES_W corner
  // of the view, and the rest of the frame falls through to the clear colour.
  updateSky(sky) {
    if (!sky?.mesh) return;
    sky.mesh.position.x = (this.viewX || 0) + LOW_RES_W / 2;
    sky.mesh.position.y = (this.viewY || 0) + LOW_RES_H / 2;
  }

  update(dt) { this.postUniforms.time.value += dt; }

  render() {
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  resize() { /* the buffer is fixed; only the canvas scales, handled by CSS */ }
}
