import * as THREE from './vendor/three.module.js';

import { LOW_RES_W, LOW_RES_H, LEVELS, CAM, DASH_COOLDOWN, ROTATE_TIME } from './core/config.js';
import { loadAssets } from './core/assets.js';
import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import { clamp, damp, makeRng } from './core/rng.js';

import { Pipeline } from './render/pipeline.js';
import { Parallax, Sky } from './render/parallax.js';
import { Sprite } from './render/sprite.js';

import { Level } from './game/level.js';
import { Player } from './game/player.js';
import { Enemy, Shard, Elder } from './game/enemy.js';
import { FX, Projectile } from './game/fx.js';
import { PlayerModel, Governor } from './game/ai.js';
import { Machine, S } from './game/state.js';
import { TILE } from './game/physics.js';

import { Statue } from './game/boss/statue.js';
import { UlBurjo } from './game/boss/ulburjo.js';
import { PatientOne } from './game/boss/patientone.js';

import { UI } from './ui/hud.js';
import { Cutscene, buildScript } from './ui/cutscene.js';
import { t, loadStoredLang, toggleLang, getLang } from './ui/i18n.js';

const BOSSES = { statue: Statue, ulburjo: UlBurjo, patientone: PatientOne };
const BOSS_INTRO = { 1: 'intro', 2: 'reveal', 3: 'waking' };
const HP_PER_LEVEL = 5;

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(LOW_RES_W, LOW_RES_H, false);
    this.renderer.setClearColor(0x05070a, 1);

    this.pipeline = new Pipeline(this.renderer);
    this.sky = new Sky(this.pipeline.scene);
    this.parallax = new Parallax(this.pipeline.scene);
    this.level = new Level(this.pipeline.scene);
    this.fx = new FX(this.pipeline.scene);
    this.fx.projectiles = [];
    this.fx.scene = this.pipeline.scene;

    this.ui = new UI();
    this.cutscene = new Cutscene(this.ui);
    this.input = new Input(window);
    this.machine = new Machine(S.BOOT);

    this.cam = { x: 0, y: 0, shake: 0, shakeX: 0, shakeY: 0 };
    this.rng = makeRng(4242);
    this.clock = 0;
    this.fade = 1;
    this.fadeTarget = 1;

    this.hp = HP_PER_LEVEL;
    this.ember = 0;
    this.levelIndex = 0;
    this.enemies = [];
    this.shards = [];
    this.elder = null;
    this.boss = null;
    this.bossDef = null;
    this.bossAwake = false;
    this.model = new PlayerModel();
    this.governor = new Governor('normal');
    this.characters = null;
    this.player = null;
    this.deathTimer = 0;
    this.hintTimer = 0;
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    loadStoredLang();
    this.ui.difficulty = 1;
    this.governor = new Governor(this.ui.difficultyKey());
    this.ui.onDifficultyChange = (key) => { this.governor = new Governor(key); };
    this.ui.onLangChange = () => this.ui.refreshStrings();
    this.ui.refreshStrings();
    this.wireMenu();

    const fill = document.getElementById('boot-fill');
    try {
      const loaded = await loadAssets((p) => {
        fill.style.width = `${Math.round(p * 100)}%`;
      });
      this.characters = loaded.characters;
    } catch (err) {
      console.error('asset load failed', err);
      document.getElementById('boot-note').textContent = 'Error al cargar los recursos';
      return;
    }

    this.player = new Player(this.pipeline.scene, this.characters.kael);
    this._wireMenuKeys();
    this._loadLevel(0, { silent: true });

    document.getElementById('boot').classList.add('gone');
    this.machine.to(S.MENU);
    this.ui.show('menu');
    this.fadeTarget = 1;

    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  wireMenu() {
    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', () => { audio.resume(); audio.sfxUi(); fn(); });
    on('menu-new', () => this.startRun(false));
    on('menu-continue', () => this.startRun(true));
    on('menu-controls', () => document.getElementById('controls-panel')?.classList.add('on'));
    on('menu-back', () => document.getElementById('controls-panel')?.classList.remove('on'));
    on('pause-resume', () => this.setPaused(false));
    on('pause-retry', () => this.retryLevel());
    on('pause-title-btn', () => this.toTitle());
    on('ending-restart', () => { this.machine.to(S.MENU); this.ui.show('menu'); this._loadLevel(0, { silent: true }); });
    on('ending-menu', () => { this.machine.to(S.MENU); this.ui.show('menu'); this._loadLevel(0, { silent: true }); });
  }

  _wireMenuKeys() {
    // Global keys that must work regardless of state.
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyL' && !e.repeat) {
        toggleLang();
        this.ui.refreshStrings();
        this.ui.showToast(t('language') + ': ' + (getLang() === 'es' ? 'Español' : 'English'), 1.4);
      }
      if (e.code === 'Escape' && this.machine.is(S.PLAY, S.BOSS)) {
        e.preventDefault();
        this.setPaused(true);
      } else if (e.code === 'Escape' && this.machine.is(S.PAUSED)) {
        e.preventDefault();
        this.setPaused(false);
      }
    });
  }

  // ------------------------------------------------------------------ flow
  startRun(hasSave) {
    audio.resume();
    this.hp = HP_PER_LEVEL;
    this.ember = 0;
    this.levelIndex = 0;
    this.governor = new Governor(this.ui.difficultyKey());
    const level = this._loadLevel(0, { silent: true });
    audio.ambient(0);
    this.playCutscene('intro', () => this.beginPlay());
  }

  playCutscene(key, onDone) {
    this.cutscene.play(buildScript(key), onDone);
    this.machine.to(S.CUTSCENE);
  }

  beginPlay() {
    this.machine.to(S.PLAY);
    this.ui.showHud();
    this.ui.setZone(LEVELS[this.levelIndex].nameKey);
    this.ui.setHealth(this.hp, HP_PER_LEVEL);
    this.ui.setEmber(this.ember);
    this.hintTimer = 3.0;
    this.ui.showToast(t('level' + (this.levelIndex + 1)) + ' — ' + t(LEVELS[this.levelIndex].nameKey), 2.2);
  }

  setPaused(on) {
    if (on) {
      if (!this.machine.can(S.PAUSED)) return;
      this.pausedFrom = this.machine.state;
      this.machine.to(S.PAUSED);
      this.ui.show('pause');
    } else {
      this.machine.to(this.pausedFrom || S.PLAY);
      this.ui.showHud();
    }
  }

  retryLevel() {
    this.hp = HP_PER_LEVEL;
    this.model.reset();
    this.governor.adapt = 0;
    this._loadLevel(this.levelIndex, { silent: true });
    this.setPaused(false);
    this.machine.to(S.PLAY);
    this.ui.showHud();
  }

  toTitle() {
    this.setPaused(false);
    this.machine.to(S.MENU);
    this.ui.show('menu');
    this._loadLevel(0, { silent: true });
  }

  // ------------------------------------------------------------------ level
  _loadLevel(index, opts = {}) {
    this.levelIndex = index;
    this.levelDef = LEVELS[index];
    const data = this.level.load(index);

    this.sky.setLevel(this.levelDef);
    this.pipeline.setLevelLook(this.levelDef);
    this.parallax.setLevel(this.levelDef);

    this.enemies = [];
    this.shards = [];
    this.projectiles = [];
    this.boss = null;
    this.bossAwake = false;
    this.elder = null;
    this.model.reset();

    for (const e of this.enemies) e.mesh.parent?.remove(e.mesh);

    for (const def of data.entities) {
      if (def.type === 'shard') {
        const s = new Shard(def);
        this.shards.push(s);
        this.pipeline.scene.add(s.mesh);
      } else if (def.type === 'wisp' || def.type === 'crawler' || def.type === 'spitter') {
        const en = new Enemy(def, this.model, this.governor, (type) => this._bodySprite(type));
        en.setPaletteLevel(this.levelDef.id);
        this.pipeline.scene.add(en.mesh);
        this.enemies.push(en);
      } else if (def.type === 'elder') {
        const el = new Elder(def, () => this._charSprite('goodwitch', 3.2));
        el.setPaletteLevel(this.levelDef.id);
        this.pipeline.scene.add(el.mesh);
        this.elder = el;
      } else if (def.type === 'boss') {
        this.bossDef = def;
      }
    }

    if (this.player) {
      this.player.reset();
      this.player.setPaletteLevel(this.levelDef.id);
      for (const g of this.player.ghosts) g.object.visible = false;
    }

    this.cam.x = 0; this.cam.y = 0;
    this._syncPlayerToWorld();
    this._updateCamera(0.016, true);
    this.pipeline.setView(this.cam.x, this.cam.y);
  }

  _charSprite(name, speed) {
    return new Sprite(this.characters[name], { speed, outline: 0x05080a });
  }

  // Enemies have no dedicated sheets, so they are assembled from the cast. It
  // keeps the whole game on one art pipeline instead of shipping placeholder
  // art for four enemy types.
  _bodySprite(type) {
    const map = { wisp: 'demon', crawler: 'statue', spitter: 'badwitch' };
    const speed = { wisp: 5, crawler: 6, spitter: 4 }[type] ?? 5;
    const s = this._charSprite(map[type] || 'statue', speed);
    s.enemyType = type;
    return s;
  }

  // ------------------------------------------------------------------ frame
  frame = (now) => {
    requestAnimationFrame(this.frame);
    let dt = (now - this.last) / 1000;
    this.last = now;
    // Clamp: a tab that was backgrounded returns a huge dt, which would tunnel
    // the player through the floor.
    dt = Math.min(dt, 1 / 20);
    this.clock += dt;

    this.fade = damp(this.fade, this.fadeTarget, 6, dt);
    this.pipeline.setFade(this.fade);
    this.pipeline.update(dt);
    this.ui.update(dt);
    this.machine.tick(dt);

    switch (this.machine.state) {
      case S.MENU: this._updateMenu(dt); break;
      case S.CUTSCENE: this._updateCutscene(dt); break;
      case S.PLAY:
      case S.BOSS: this._updatePlay(dt); break;
      case S.DEAD: this._updateDead(dt); break;
      case S.PAUSED: this._updatePaused(dt); break;
      case S.ENDING: this._updateEnding(dt); break;
      default: break;
    }

    this.fx.update(dt);
    this.pipeline.updateSky(this.sky);
    this.input.endFrame(dt);
    this.pipeline.render();
  };

  _updateMenu() {
    // The level renders behind the title, so it is stepped but not simulated.
    this.parallax.update(this.cam.x, this.cam.y);
    this._syncPlayerToWorld();
  }

  _updateCutscene(dt) {
    this.cutscene.update(dt);
    this.ui.typeLine.classList.toggle('done', !this.cutscene.typing);
    if (this.input.consume('confirm') || this.input.consume('attack') || this.input.consume('jump')) {
      this.cutscene.advance();
    }
    this._idleCamera(dt);
  }

  _updatePaused() {
    if (this.input.consume('confirm')) this.setPaused(false);
    this._syncPlayerToWorld();
  }

  _updateDead(dt) {
    this.deathTimer += dt;
    this.player.update(dt, { consume: () => false, isDown: () => false }, this.level.data);
    this.fx.update(dt);
    this._updateCamera(dt);
    this.parallax.update(this.cam.x, this.cam.y);
    this.ui.setBoss(null);
    if (this.deathTimer > 1.1 && (this.input.consume('confirm') || this.input.consume('jump'))) {
      this.retryLevel();
    }
  }

  _updateEnding(dt) {
    this._idleCamera(dt);
    this._colorBleedCanvas(dt);
    if (this.cutscene.active) this.cutscene.update(dt);
    if (this.cutscene.active &&
        (this.input.consume('confirm') || this.input.consume('jump') || this.input.consume('attack'))) {
      this.cutscene.advance();
    }
    if (this.endingHold > 0) { this.endingHold -= dt; return; }
    if (this.input.consume('confirm') || this.input.consume('jump')) {
      this.endingHold = 0.8;
      this.fx.colorBleed(this.player.mesh.position.x, this.player.mesh.position.y + 20, 40);
    }
  }

  _updatePlay(dt) {
    const p = this.player;
    const data = this.level.data;

    // ---- L2 rotate, handled outside the player so physics can be suspended
    if (this.level.canRotate && this.level.isRotating) {
      const done = this.level.updateRotation(dt);
      // The player is pinned in world space for the whole turn: the room swings
      // around them rather than them swinging around the room. The pinned point
      // is owned by the Level, not aliased to the body.
      const w = this.level.localToWorld(this.level.pinnedLocal);
      p.mesh.position.set(w.x, w.y, 0);
      if (done) {
        // `done` is already in local space (it came back out of worldToLocal).
        p.body.x = done.x; p.body.y = done.y;
        p.body.enabled = true;
        p.mesh.position.set(done.x, done.y, 0);
        this.boss?.onRotationDone?.();
      }
    } else {
      p.body.enabled = true;
      if (this.input.consume('rotate') && this.level.canRotate && this.level.beginRotate(
          new THREE.Vector3(p.cx, p.cy, 0))) {
        p.body.enabled = false;
        p.body.vx = 0; p.body.vy = 0;
        audio.sfxRotate();
        this.cam.shake = Math.max(this.cam.shake, 3);
        this.ui.showToast(t('rotateHint'), 1.2);
      }
    }

    // ---- player
    p.update(dt, this.input, data);
    p.updateGhosts(dt);
    if (p.justDashed) {
      p.justDashed = false;
      audio.sfxDash();
      this.fx.burst(p.cx, p.body.bottom, 0x7fd8ff, 5, 40);
    }
    if (p.justJumped) {
      p.justJumped = false;
      audio.sfxJump();
      this.fx.dust(p.cx, p.body.bottom);
    }

    // ---- the player model: everything the adaptive AI reads
    this._recordActions(dt);

    // ---- attack
    if (p.updateAttackFrame()) {
      audio.sfxSlash();
      this.fx.slashArc(p.lightX, p.lightY, p.facing);
      this._resolvePlayerHit();
    }

    // ---- enemies
    this.governor.update(this.model);
    for (const e of this.enemies) e.update(dt, p, data);
    for (const e of this.enemies) {
      if (e.dead && e.deathTimer > 0.45 && e.mesh.parent) {
        e.mesh.parent.remove(e.mesh);
        e.mesh = null;
      }
    }
    this.enemies = this.enemies.filter((e) => e.mesh);

    // ---- pickups
    for (const s of this.shards) {
      if (s.taken) continue;
      s.update(dt);
      if (Math.abs(s.x - p.cx) < 12 && Math.abs(s.y - p.cy) < 16) {
        s.taken = true;
        s.mesh.visible = false;
        this.ember++;
        this.ui.setEmber(this.ember);
        audio.sfxEmber();
        this.fx.burst(s.x, s.y, 0x8fffc0, 8, 45);
      }
    }

    // ---- elder
    if (this.elder) {
      this.elder.update(dt);
      const d = Math.abs(this.elder.x - p.cx);
      if (!this.elder.talked && d < 22) {
        this.elder.talked = true;
        this.ui.showToast(t('cs1a'), 3.0);
        this.elder.reveal();
      }
    }

    // ---- projectiles
    for (const pr of this.fx.projectiles) pr.update(dt, data, p);
    for (const pr of this.fx.projectiles) if (pr.dead) pr.dispose();
    this.fx.projectiles = this.fx.projectiles.filter((pr) => !pr.dead);

    // ---- boss
    this._updateBoss(dt);

    // ---- player hurt
    if (p.hurtTimer > 0 && !p.dead) {
      this.cam.shake = Math.max(this.cam.shake, 4);
      audio.sfxHurt();
    }
    if (p.dead) { this._onDeath(); return; }

    // ---- falling out of the world
    if (p.body.y < -40) p.kill();

    // ---- HUD
    this.ui.setHealth(this.hp, HP_PER_LEVEL);
    this.ui.setDash(p.dashReady, p.dashReady ? 1 : 1 - p.dashCd / DASH_COOLDOWN);
    if (this.hintTimer > 0) this.hintTimer -= dt;

    // ---- camera + parallax
    this._syncPlayerToWorld();
    this._updateCamera(dt);
    this.parallax.update(this.cam.x, this.cam.y);

    // L3: the sword halo is the only light, so the post pass is told where it is.
    if (this.levelDef.id === 3) {
      const b = this.pipeline.screenToBuffer(p.mesh.position.x + (p.facing * 8), p.mesh.position.y + 16);
      this.pipeline.setLight(b.x, b.y, 95);
    }

    // ---- exit into the boss
    if (this.boss && !this.bossAwake && this.bossDef &&
        Math.abs(p.cx - this.bossDef.x) < 130) {
      this._startBoss();
    }
  }

  // Records the rolling window the adaptive AI reads. Only meaningful actions are
  // recorded; holding a direction is not an action.
  _recordActions(dt) {
    const p = this.player;
    this._recAcc = (this._recAcc || 0) + dt;
    if (this._recAcc < 0.09) return;
    this._recAcc = 0;

    let type = 'move';
    if (p.dead) type = 'dead';
    else if (p.isDashing) type = 'dash';
    else if (p.isAttacking) type = 'attack';
    else if (!p.onGround) type = 'jump';
    else if (Math.abs(p.body.vx) < 4) type = 'idle';

    this.model.record(type, {
      dx: p.body.vx * 0.09,
      x: p.mesh.position.x,
      y: p.mesh.position.y,
    });
  }

  _resolvePlayerHit() {
    const p = this.player;
    const r = p.attackRect();
    for (const e of this.enemies) {
      if (e.dead || e.mesh == null) continue;
      const er = e.rect;
      if (r.left < er.right && r.right > er.left && r.bottom < er.top && r.top > er.bottom) {
        e.hurt(1);
        this.fx.burst(e.cx, e.cy, 0xffd08a, 6, 60);
        // Small knockback sells the hit even though the enemy has no physics.
        e.body.vx += Math.sign(p.facing) * 40;
      }
    }
    if (this.boss && !this.boss.dead && this.boss.state !== 'sleep') {
      const br = this.boss.rect;
      if (r.left < br.right && r.right > br.left && r.bottom < br.top && r.top > br.bottom) {
        this.boss.hurt(1);
      } else {
        const hr = this.boss.hurtRect();
        if (r.left < hr.right && r.right > hr.left && r.bottom < hr.top && r.top > hr.bottom) {
          this.boss.hurt(1);
        }
      }
    }
  }

  _startBoss() {
    if (!this.bossDef) return;
    const Cls = BOSSES[this.bossDef.boss];
    if (!Cls) return;
    this.bossAwake = true;
    audio.sfxBoss();
    this.cam.shake = 7;
    this.machine.to(S.BOSS);

    this.boss = new Cls({
      x: this.bossDef.x,
      character: this.characters,
      model: this.model,
      governor: this.governor,
      fx: this.fx,
      audio,
      level: this.level,
      makeSprite: () => {
        const name = { statue: 'statue', ulburjo: 'goodwitch', patientone: 'demon' }[this.bossDef.boss];
        const s = this._charSprite(name, 4);
        s.setPaletteLevel(this.levelDef.id);
        return s;
      },
    });
    this.boss.setPaletteLevel(this.levelDef.id);
    this.pipeline.scene.add(this.boss);

    const keys = { statue: 'bossStatue', ulburjo: 'bossUlBurjo', patientone: 'bossPatient' };
    this.ui.setBoss(keys[this.bossDef.boss], 1, 1, this.boss.phases);
    this.ui.showToast(t(keys[this.bossDef.boss]), 2.4);
  }

  _updateBoss(dt) {
    if (!this.boss) return;
    this.boss.wake?.();
    this.boss.update(dt, this.player, this.level.data, this.fx);
    this.ui.setBoss(
      { statue: 'bossStatue', ulburjo: 'bossUlBurjo', patientone: 'bossPatient' }[this.bossDef.boss],
      this.boss.hpFrac, this.boss.phase, this.boss.phases);

    if (this.boss.dead && this.boss.deathTimer > 2.2 && this.boss.mesh.parent) {
      this.pipeline.scene.remove(this.boss);
      this.boss = null;
      this.bossAwake = false;
      this.ui.setBoss(null);
      this._onBossDefeated();
    }
  }

  _onBossDefeated() {
    this.hp = Math.min(HP_PER_LEVEL, this.hp + 2);
    if (this.levelIndex >= 2) {
      this.machine.to(S.CUTSCENE);
      this.ui.show('cutscene');
      this.cutscene.play(buildScript('return'), () => this._showEnding());
      return;
    }
    this.levelIndex++;
    this._loadLevel(this.levelIndex, { silent: true });
    audio.ambient(this.levelIndex);
    this.machine.to(S.CUTSCENE);
    this.ui.show('cutscene');
    this.cutscene.play(buildScript(BOSS_INTRO[this.levelIndex] || 'theft'), () => this.beginPlay());
  }

  _showEnding() {
    this.machine.to(S.ENDING);
    this.ui.show('ending');
    this.endingHold = 1.0;
    this._bleedInit();
    audio.ambient(0);
  }

  _onDeath() {
    if (this.machine.state === S.DEAD) return;
    this.machine.to(S.DEAD);
    this.deathTimer = 0;
    audio.sfxDie();
    this.cam.shake = 8;
    this.ui.setBoss(null);
    this.ui.showToast(t('youDied'), 1.6);
  }

  // ------------------------------------------------------------------ camera
  _idleCamera(dt) {
    this._updateCamera(dt);
    this.parallax.update(this.cam.x, this.cam.y);
  }

  _syncPlayerToWorld() {
    if (!this.player) return;
    if (this.level.isRotating) return;   // rotation path owns the transform
    const w = this.level.localToWorld(new THREE.Vector3(this.player.cx, this.player.body.bottom, 0));
    this.player.mesh.position.set(w.x, w.y, 0);
  }

  _updateCamera(dt, snap = false) {
    const p = this.player;
    if (!p) return;
    // Follow the player's world position, not their local one, so a rotation
    // does not throw the camera across the level.
    const tx = p.mesh.position.x + p.facing * CAM.lookAhead - LOW_RES_W * 0.5;
    const ty = p.mesh.position.y - LOW_RES_H * 0.52;

    if (snap) {
      this.cam.x = tx; this.cam.y = ty;
    } else {
      this.cam.x = damp(this.cam.x, tx, CAM.lerp, dt);
      this.cam.y = damp(this.cam.y, ty, CAM.lerp, dt);
    }

    // Clamp to the level bounds in the group's local frame.
    const w = this.level.worldWidth, h = this.level.worldHeight;
    this.cam.x = clamp(this.cam.x, 0, Math.max(0, w - LOW_RES_W));
    this.cam.y = clamp(this.cam.y, 0, Math.max(0, h - LOW_RES_H));

    this.cam.shake = Math.max(0, this.cam.shake - dt * CAM.shakeDecay * 3);
    if (this.cam.shake > 0.01) {
      this.cam.shakeX = (Math.random() - 0.5) * this.cam.shake;
      this.cam.shakeY = (Math.random() - 0.5) * this.cam.shake;
    } else { this.cam.shakeX = 0; this.cam.shakeY = 0; }

    this.pipeline.setView(this.cam.x + this.cam.shakeX, this.cam.y + this.cam.shakeY);
  }

  // ------------------------------------------------------------------ ending
  // The green colour-bleed payoff: particles of the L1 emerald palette rise into
  // the frame over the closing text. Drawn to a 2D canvas over the letterbox.
  _bleedInit() {
    const c = document.getElementById('bleed-canvas');
    if (!c) return;
    c.width = 320; c.height = 180;
    this._bleedCtx = c.getContext('2d');
    this._bleed = Array.from({ length: 90 }, () => ({
      x: Math.random() * 320,
      y: 180 + Math.random() * 120,
      v: 6 + Math.random() * 26,
      r: 0.6 + Math.random() * 2.4,
      a: 0.15 + Math.random() * 0.55,
    }));
  }

  _colorBleedCanvas(dt) {
    const ctx = this._bleedCtx;
    if (!ctx) return;
    const c = ctx.canvas;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const p of this._bleed) {
      p.y -= p.v * dt;
      if (p.y < -6) { p.y = c.height + 10; p.x = Math.random() * c.width; }
      ctx.globalAlpha = p.a;
      ctx.fillStyle = '#54f0a8';
      ctx.fillRect(p.x, p.y, p.r, p.r * 2.2);
    }
    ctx.globalAlpha = 1;
  }
}

const game = new Game();
window.__lumenfall = game;   // handy for the headless smoke check
game.boot();
