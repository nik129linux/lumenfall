import * as THREE from '../vendor/three.module.js';
import { tileAt } from './physics.js';
import { makeRng } from '../core/rng.js';
import { makeSpriteMaterial } from '../render/materials.js';

// Particles and one-shot effects. Everything is a pooled sprite in a single
// group: at this resolution a particle is a few pixels, so the cost that matters
// is draw calls, not fill.

const MAX = 320;

// Red floor markers that show where a boss attack will land. Off by request.
const SHOW_TELEGRAPHS = false;

// Ambient motes: a separate, small pool, so the air never takes particles away
// from a hit. One look per level id: fireflies in the shrine, spores in the
// reliquary, embers in the wood. `rate` is spawns per second, `rise` the
// vertical drift in px/s, `wobble` the sideways sway amplitude in px/s.
const AMBIENT_MAX = 48;
const AMBIENT = {
  1: { rate: 5, colors: [0x9fffc8, 0x54f0a8], size: [1, 2], life: [2.5, 4.5], rise: [-3, 6], wobble: 7, blink: true },
  2: { rate: 6, colors: [0xc89cff, 0x9be34a], size: [1, 1], life: [3.0, 5.0], rise: [2, 7], wobble: 4, blink: false },
  3: { rate: 7, colors: [0xffb060, 0xff7a2a], size: [1, 2], life: [1.8, 3.2], rise: [10, 22], wobble: 6, blink: false },
};

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.telegraphs = [];
    this.rng = makeRng(9182);
    this.group = new THREE.Group();
    scene.add(this.group);

    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < MAX; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1, depthTest: false, depthWrite: false,
      }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.items.push({ mesh, life: 0, max: 1, vx: 0, vy: 0, g: 0, size: 2, fade: true });
    }
    this.next = 0;

    // Additive, so a mote glows against the dark instead of sitting on it.
    this.motes = [];
    this.moteTimer = 0;
    for (let i = 0; i < AMBIENT_MAX; i++) {
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
      }));
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.motes.push({ mesh, life: 0, max: 1, vy: 0, phase: 0, wobble: 0, blink: false });
    }
  }

  // Spawns and moves the ambient motes for the view at (viewX, viewY), which
  // is the bottom-left of the screen in level pixels. Motes are born inside
  // the view so none of the small pool is spent off-screen, fade in and out so
  // none pops, and sway on a sine so they drift rather than slide.
  ambient(dt, levelId, viewX, viewY, viewW, viewH) {
    const look = AMBIENT[levelId];
    if (!look) return;
    const r = this.rng;
    this.moteTimer += dt * look.rate;
    while (this.moteTimer >= 1) {
      this.moteTimer -= 1;
      const m = this.motes.find((x) => x.life <= 0);
      if (!m) break;
      m.life = m.max = r.range(look.life[0], look.life[1]);
      m.vy = r.range(look.rise[0], look.rise[1]);
      m.phase = r.range(0, Math.PI * 2);
      m.wobble = look.wobble * r.range(0.5, 1);
      m.blink = look.blink;
      const s = r.int(look.size[0], look.size[1]);
      m.mesh.scale.set(s, s, 1);
      m.mesh.material.color.set(r.pick(look.colors));
      m.mesh.position.set(viewX + r.range(0, viewW), viewY + r.range(viewH * 0.1, viewH * 0.9), 0);
      m.mesh.visible = true;
    }
    for (const m of this.motes) {
      if (m.life <= 0) continue;
      m.life -= dt;
      if (m.life <= 0) { m.mesh.visible = false; continue; }
      m.phase += dt * 1.3;
      m.mesh.position.x += Math.cos(m.phase) * m.wobble * dt;
      m.mesh.position.y += m.vy * dt;
      // Bell curve over the lifetime: 0 at birth and death, full in between.
      const k = 1 - m.life / m.max;
      let a = Math.sin(k * Math.PI);
      if (m.blink) a *= 0.55 + 0.45 * Math.sin(m.phase * 4);   // fireflies pulse
      m.mesh.material.opacity = a * 0.85;
    }
  }

  _take() {
    for (let i = 0; i < MAX; i++) {
      const idx = (this.next + i) % MAX;
      if (this.items[idx].life <= 0) {
        this.next = (idx + 1) % MAX;
        return this.items[idx];
      }
    }
    return this.items[this.next = (this.next + 1) % MAX];
  }

  spawn(x, y, opts = {}) {
    const p = this._take();
    p.life = p.max = opts.life ?? 0.4;
    p.vx = opts.vx ?? 0;
    p.vy = opts.vy ?? 0;
    p.g = opts.g ?? 0;
    p.size = opts.size ?? 2;
    p.drag = opts.drag ?? 0;
    p.mesh.position.set(x, y, 0);
    p.mesh.scale.set(p.size, p.size, 1);
    p.mesh.material.color.set(opts.color ?? 0xffffff);
    p.mesh.material.opacity = 1;
    p.mesh.visible = true;
    return p;
  }

  // ---- named effects
  burst(x, y, color, n = 8, speed = 60) {
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      this.spawn(x, y, {
        vx: Math.cos(a) * r.range(speed * 0.4, speed),
        vy: Math.sin(a) * r.range(speed * 0.4, speed),
        g: 90, life: r.range(0.2, 0.45), size: r.range(1, 3), color,
      });
    }
  }

  slashArc(x, y, facing, color = 0x9fe8ff) {
    // A short crescent thrown along the blade path. Rotating a flat quad by the
    // attack angle reads as a slash at 480px and costs one sprite.
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const p = this.spawn(x + facing * (4 + t * 16), y + 2 + t * 10, {
        vx: facing * 30, vy: 8, g: -20, life: 0.14 + t * 0.05,
        size: 3 + t * 3, color,
      });
      p.mesh.material.opacity = 1 - t * 0.6;
    }
  }

  dust(x, y, color = 0x6a7a70) {
    const r = this.rng;
    for (let i = 0; i < 4; i++) {
      this.spawn(x + r.range(-5, 5), y, {
        vx: r.range(-16, 16), vy: r.range(-6, 6), g: 30,
        life: r.range(0.15, 0.3), size: r.range(1, 2), color,
      });
    }
  }

  ember(x, y) {
    this.spawn(x, y, { vx: this.rng.range(-8, 8), vy: this.rng.range(20, 46), g: -6, life: 1.1, size: 2, color: 0x8fffc0 });
  }

  // The ending payoff: green bleeding back into the world from the Ember.
  colorBleed(x, y, n = 60) {
    const r = this.rng;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      const s = r.range(30, 160);
      this.spawn(x, y, {
        vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, g: -12,
        life: r.range(0.8, 2.0), size: r.range(2, 5), color: 0x54f0a8,
      });
    }
  }

  // ---- telegraphs
  //
  // A telegraph is the floor decal that says "this is about to happen here". It
  // is a plain quad rather than a pooled particle because it has to live for a
  // whole wind-up (up to a second) with a predictable size, and because it must
  // be removable as a group when a boss is interrupted mid-attack.

  // `x` is the CENTRE of the marker and `y` its BOTTOM edge, in level pixels --
  // the same convention as the hurt rectangles they mirror.
  telegraph(x, y, w, h, dur, color = 0xff3b3b) {
    // Requested in the course review: no red box on the floor. The bosses play
    // a warning sound at the start of each wind-up instead (audio.sfxWarn).
    // Flip SHOW_TELEGRAPHS to true to bring the boxes back.
    if (!SHOW_TELEGRAPHS) return null;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false }));
    mesh.scale.set(w, h, 1);
    mesh.position.set(x, y + h / 2, 0);
    mesh.renderOrder = 5;
    this.group.add(mesh);
    const t = { mesh, life: dur, age: 0 };
    this.telegraphs.push(t);
    return t;
  }

  // Drops every live marker. A boss that is interrupted, defeated or changed
  // phase calls this, so a decal is never left lying on a floor nothing is
  // about to hit.
  clearTelegraphs() {
    for (const t of this.telegraphs) { this.group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose(); }
    this.telegraphs = [];
  }

  update(dt) {
    // Telegraphs first: a marker placed this frame has to start blinking on the
    // frame it appears, not one frame later.
    for (const t of this.telegraphs) {
      t.age += dt; t.life -= dt;
      t.mesh.visible = Math.floor(t.age / 0.07) % 2 === 0;   // blink
    }
    this.telegraphs = this.telegraphs.filter((t) => {
      if (t.life > 0) return true;
      this.group.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh.material.dispose();
      return false;
    });

    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.mesh.visible = false; continue; }
      if (p.drag) {
        p.vx -= p.vx * p.drag * dt;
        p.vy -= p.vy * p.drag * dt;
      }
      p.vy += p.g * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.material.opacity = Math.min(1, p.life / p.max * 1.6);
    }
  }
}

// ---------------------------------------------------------------- projectiles

export class Projectile {
  constructor(scene, x, y, vx, vy, opts = {}) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.dead = false;
    this.life = opts.life ?? 2.2;
    this.r = opts.r ?? 3;
    this.color = opts.color ?? 0xa86cf0;
    this.dmg = opts.dmg ?? 1;
    this.gravity = opts.gravity ?? 0;
    // A sprite projectile draws the cut frame instead of a coloured square. The
    // spitter's is the loose green fireball from Nico's sheet, so it needs a
    // ShaderMaterial rather than MeshBasicMaterial -- which also means it has no
    // `.opacity`, and the fade below has to go through the uniform instead.
    //
    // No outline on it. The outline shader offsets by one TEXEL, which suits a
    // character cell drawn 1:1, but the fireball is 25x16 texels drawn at
    // 12x8 and is solid green through the middle -- so almost every texel is
    // opaque and every interior gap has four opaque neighbours, and the outline
    // fills those gaps and turns the fireball into a solid block.
    this.sprite = opts.texture
      ? makeSpriteMaterial(opts.texture, { outline: 0 })
      : null;
    if (this.sprite) {
      const [w, h] = opts.size ?? [this.r * 2, this.r * 2];
      this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.sprite);
    } else {
      this.mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(this.r * 2, this.r * 2),
        new THREE.MeshBasicMaterial({ color: this.color, transparent: true, opacity: 0.95, depthTest: false })
      );
    }
    this.mesh.position.set(x, y, 0);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.scene = scene;
    this.t = 0;
    this.flicker = !!opts.flicker;
  }

  update(dt, level, player) {
    this.t += dt;
    this.life -= dt;
    this.vy += this.gravity * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.mesh.position.set(this.x, this.y, 0);

    if (this.sprite) {
      this.sprite.userData.uniforms.alphaScale.value = 0.92;
      // Two-frame flicker. A single still frame of a fireball reads as a
      // floating blob that happens to be moving; the size step is what sells it
      // as being spat.
      if (this.flicker) {
        const k = Math.floor(this.t * 16) % 2 ? 0.9 : 1.0;
        this.mesh.scale.set(k, k, 1);
      }
    } else {
      this.mesh.material.opacity = 0.6 + Math.sin(this.t * 18) * 0.3;
    }

    if (this.life <= 0) { this.dead = true; return; }
    if (tileAt(level, Math.floor(this.x / 8), Math.floor(this.y / 8)) === 1) { this.dead = true; return; }
    if (!player.dead && !player.isInvulnerable &&
        this.x > player.body.left - this.r && this.x < player.body.right + this.r &&
        this.y > player.body.bottom - this.r && this.y < player.body.top + this.r) {
      player.hurt();
      this.dead = true;
    }
  }

  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
