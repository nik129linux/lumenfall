import * as THREE from '../vendor/three.module.js';
import { LOW_RES_W, LOW_RES_H } from '../core/config.js';

// Renders the game into a 480x270 buffer, then upscales it with a fullscreen
// pass.
//
// Stage 1 removed film grain, scanlines and chromatic aberration from this pass.
// They were actively fighting the art: the source sheets are carefully painted
// pixel art, and a grain field over a 480x270 buffer turns every clean sprite
// into noise. The pixel look comes from the low-res buffer and NEAREST upscale
// alone, which is all it ever needed. What remains is the vignette, the L3
// light falloff, and the linear->sRGB encode (without which the raw ShaderMaterial
// output renders about a stop and a half dark).

const POST_FRAG = /* glsl */`
  precision mediump float;

  uniform sampler2D scene;
  uniform vec2  resolution;
  uniform float time;
  uniform float vignette;
  uniform float darkness;   // L3: how much to crush everything outside the light
  uniform vec2  lightPos;   // in buffer pixels
  uniform float lightRadius;
  uniform float fade;       // global fade to black, for transitions
  uniform float hurt;       // red flash, for the pit fall-out

  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    vec2 centred = uv - 0.5;

    vec3 col = texture2D(scene, uv).rgb;

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

    // Vignette only.
    float v = 1.0 - dot(centred, centred) * vignette;
    col *= clamp(v, 0.0, 1.0);

    // Red flash, before the fade: it has to survive being multiplied down, or
    // the last thing you see of a fall is grey.
    if (hurt > 0.001) {
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum * 1.15, lum * 0.06, lum * 0.06), hurt);
    }

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
    //
    // HalfFloat, not UnsignedByte. Linear light is concentrated near zero, so
    // 8 bits per channel throws away the dark half of every colour: an sRGB
    // (30,14,5) lands on (3,1,0) in 8-bit linear, which is pure red. That is why
    // the burnt-orange L3 backdrop measured a yellow-green hue and the blue-black
    // 3.jpg came out as muddy blue. 16 bits of float holds the shadows, and at
    // 480x270 the bandwidth is irrelevant.
    this.target = new THREE.WebGLRenderTarget(LOW_RES_W, LOW_RES_H, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      colorSpace: THREE.LinearSRGBColorSpace,
    });

    this.postUniforms = {
      scene: { value: this.target.texture },
      resolution: { value: new THREE.Vector2(LOW_RES_W, LOW_RES_H) },
      time: { value: 0 },
      vignette: { value: 0.35 },
      darkness: { value: 0 },
      lightPos: { value: new THREE.Vector2(LOW_RES_W / 2, LOW_RES_H / 2) },
      lightRadius: { value: 120 },
      fade: { value: 1 },
      hurt: { value: 0 },
    };
    this.lightScale = 1;

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
    // Vignette is capped low: at 480x270 a strong one eats a third of the frame
    // and dims the art it is supposed to be framing.
    this.postUniforms.vignette.value = level.id === 3 ? 0.55 : 0.35;
    this.postUniforms.darkness.value = level.id === 3 ? 1 : 0;
  }

  setLight(px, py, radius) {
    this.postUniforms.lightPos.value.set(px, py);
    this.postUniforms.lightRadius.value = radius * this.lightScale;
  }

  // A gameplay effect (the L3 boss closing the dark in) can squeeze the halo
  // without owning the per-frame setLight call. It is a scale rather than a
  // radius, so the call site keeps passing the real value and the light comes
  // back on its own the moment the scale goes back to 1.
  setLightScale(k) { this.lightScale = k; }

  setFade(v) { this.postUniforms.fade.value = v; }

  setHurt(v) { this.postUniforms.hurt.value = v; }

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
