import * as THREE from './vendor/three.module.js';

import { LOW_RES_W, LOW_RES_H, LEVELS, CAM, DASH_COOLDOWN, ROTATE_TIME, PIT_DEATH_Y } from './core/config.js';
import { loadAssets } from './core/assets.js';
import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import { clamp, damp, makeRng } from './core/rng.js';

import { Pipeline } from './render/pipeline.js';
import { Parallax, Sky } from './render/parallax.js';
import { Sprite } from './render/sprite.js';
import { MinionArt, MinionSprite } from './render/minions.js';

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
import { Cutscene, buildScript, PanelStage, preloadPanels } from './ui/cutscene.js';
import { t, loadStoredLang, toggleLang, getLang } from './ui/i18n.js';

const BOSSES = { statue: Statue, ulburjo: UlBurjo, patientone: PatientOne };
const BOSS_INTRO = { 1: 'intro', 2: 'reveal', 3: 'waking' };

// The deal: in-game dialogue with the level still rendering behind it. `panel`
// names a still that fades in over the level for that line; null shows the level.
const DEAL = [
  { panel: null,  who: 'elder', textKey: 'deal1a' },
  { panel: '03',  who: 'kael',  textKey: 'deal1b' },
  { panel: '07',  who: 'elder', textKey: 'deal2a' },
  { panel: '08',  who: 'elder', textKey: 'deal2b' },
  { panel: '04',  who: 'kael',  textKey: 'deal3a' },
  { panel: '04',  who: 'elder', textKey: 'deal3b' },
  { panel: '09',  who: 'kael',  textKey: 'deal3c' },
];
const DEAL_RANGE = 28;      // px between Kael's centre and the elder
const DEAL_EASE = 0.5;      // camera ease, seconds
const DEAL_TYPE_CPS = 44;
const ROTATE_HINT_TILES = 6;   // how close to a hole before the hint repeats
const HP_PER_LEVEL = 5;
// Distance before the arena door that the boss fight starts.
const BOSS_TRIGGER = 150;
// Floor height in world px: the ground occupies the lowest tile rows.
const FLOOR_Y = 4 * 8;

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
    this.story = null;
    this.storyPanel = new PanelStage(this.ui.storyPanel);
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

    const boot = document.getElementById('boot');
    boot.classList.add('gone');
    // The fade is 400ms; without this the overlay keeps painting (and ghosting
    // its title across the menu) for as long as it stays in the DOM.
    setTimeout(() => boot.remove(), 500);
    this.machine.to(S.MENU);
    this.ui.show('menu');
    this._onMenuOpen();      // after show(): focus() on a display:none node is a no-op
    this.fadeTarget = 1;
    // Last, so it overrides the menu that was just set up.
    this._applyUrlParams();

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
    on('ending-restart', () => { this.machine.to(S.MENU); this.ui.show('menu'); this._loadLevel(0, { silent: true }); this._onMenuOpen(); });
    on('ending-menu', () => { this.machine.to(S.MENU); this.ui.show('menu'); this._loadLevel(0, { silent: true }); this._onMenuOpen(); });

  }

  // ?level=1|2|3 and ?boss=1 drop straight into a level or its boss fight.
  // Stage 1's acceptance checks use these to reach the later levels and the
  // bosses without playing through them.
  _applyUrlParams() {
    const q = new URLSearchParams(location.search);
    const lv = parseInt(q.get('level') || '', 10);
    const boss = q.get('boss') === '1';
    if (!lv && !boss) return;
    const index = lv >= 1 && lv <= 3 ? lv - 1 : 0;
    this.ui.hideAll();
    this._loadLevel(index, { silent: true });
    this.cutscene.active = false;
    this.cutscene.onDone = null;
    // BOOT may only go to MENU, so the skip has to pass through it.
    this.machine.to(S.MENU);
    this.machine.to(S.PLAY);
    this.ui.showHud();
    this.ui.setZone(this.levelDef.nameKey);
    this.ui.setHealth(this.hp, HP_PER_LEVEL);
    this.ui.setEmber(this.ember);
    if (boss) {
      this.player.body.x = this.bossDef.x - 110;
      this.player.body.y = 32;
      this._startBoss();
    }
  }

  // Menu keyboard navigation.
  //
  // Previously Enter did nothing on the title screen: the buttons only responded
  // to clicks. Focus starts on "Nueva partida" when the menu opens, Up/Down (and
  // W/S) move it, and Enter/Space activates.
  _menuNav() {
    const order = ['menu-new', 'menu-continue', 'menu-controls'];
    return order.map((id) => document.getElementById(id)).filter(Boolean);
  }

  _focusMenu(delta) {
    const items = this._menuNav();
    if (!items.length) return;
    const cur = items.findIndex((b) => b === document.activeElement);
    const next = cur < 0
      ? (delta > 0 ? 0 : items.length - 1)
      : (cur + delta + items.length) % items.length;
    items[next].focus();
    audio.sfxUi();
  }

  _activateMenu() {
    const b = document.activeElement;
    if (b && b.tagName === 'BUTTON' && this.machine.is(S.MENU)) b.click();
  }

  _onMenuOpen() {
    const items = this._menuNav();
    if (items[0]) items[0].focus();
  }

  _wireMenuKeys() {
    // Global keys that must work regardless of state.
    window.addEventListener('keydown', (e) => {
      // Menu navigation, before anything else can swallow the key.
      if (this.machine.is(S.MENU)) {
        if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); this._focusMenu(1); return; }
        if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); this._focusMenu(-1); return; }
        if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyJ' || e.code === 'KeyZ') {
          e.preventDefault(); this._activateMenu(); return;
        }
      }
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
    preloadPanels();
    this.playCutscene('prologue', () => this.beginPlay());
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
    // The level number string and the zone name are the same string, so joining
    // them printed "Santuario de la Brasa — Santuario de la Brasa". One name.
    this.ui.showToast(t(LEVELS[this.levelIndex].nameKey), 2.2);
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
    this._resetPitFlash();
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
    this._onMenuOpen();
    this._loadLevel(0, { silent: true });
  }

  // ------------------------------------------------------------------ level
  _loadLevel(index, opts = {}) {
    this.levelIndex = index;
    this.levelDef = LEVELS[index];
    const data = this.level.load(index);

    this._resetPitFlash();
    this._hintOnEntry = false;
    this._hintNearHole = false;
    this.sky.setLevel(this.levelDef);
    this.pipeline.setLevelLook(this.levelDef);
    this.parallax.setLevel(this.levelDef);

    // Detach the old level's actors BEFORE dropping the references. This loop
    // used to sit after the assignments below, so it iterated an already-empty
    // array and removed nothing: every enemy, shard and the elder stayed in the
    // scene for the rest of the run, which is why the elder turned up in the
    // level 2 and level 3 screenshots.
    for (const e of this.enemies) e.mesh.parent?.remove(e.mesh);
    for (const s of this.shards) s.mesh.parent?.remove(s.mesh);
    for (const pr of this.fx.projectiles) pr.dispose();
    if (this.elder) this.elder.mesh.parent?.remove(this.elder.mesh);
    // Mirrors the removal on the boss death path below.
    if (this.boss) this.pipeline.scene.remove(this.boss);

    this.enemies = [];
    this.shards = [];
    this.fx.projectiles = [];
    this.boss = null;
    this.bossAwake = false;
    this.elder = null;
    this.story = null;
    this.model.reset();

    for (const def of data.entities) {
      if (def.type === 'shard') {
        const s = new Shard(def);
        this.shards.push(s);
        this.pipeline.scene.add(s.mesh);
      } else if (def.type === 'wisp' || def.type === 'crawler' || def.type === 'spitter') {
        const en = new Enemy(def, this.model, this.governor, (type) => this._bodySprite(type));
        this.pipeline.scene.add(en.mesh);
        this.enemies.push(en);
      } else if (def.type === 'elder') {
        const el = new Elder(def, () => this._charSprite('goodwitch', 3.2));
        this.pipeline.scene.add(el.mesh);
        this.elder = el;
      } else if (def.type === 'boss') {
        this.bossDef = def;
      }
    }

    if (this.player) {
      this.player.reset();
      for (const g of this.player.ghosts) g.object.visible = false;
    }

    this.cam.x = 0; this.cam.y = 0; this._bounds = null;
    this._syncPlayerToWorld();
    this._updateCamera(0.016, true);
    this.pipeline.setView(this.cam.x, this.cam.y);
  }

  _charSprite(name, speed) {
    return new Sprite(this.characters[name], { speed, outline: 0x05080a });
  }

  // Minions are drawn procedurally. They used to be assembled from the cast --
  // wisps wore the demon, crawlers the statue, spitters Ul Burjo -- which put the
  // level 3 boss on screen in level 1.
  _bodySprite(type) {
    if (!this.minionArt) this.minionArt = new MinionArt();
    const scale = { wisp: 0.8, crawler: 1.0, spitter: 1.0 }[type] ?? 1;
    return new MinionSprite(this.minionArt, type, this.levelDef?.accent ?? 0x54f0a8, { scale });
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
      case S.STORY: this._updateStory(dt); break;
      case S.PLAY:
      case S.BOSS: this._updatePlay(dt); break;
      case S.DEAD: this._updateDead(dt); break;
      case S.PAUSED: this._updatePaused(dt); break;
      case S.ENDING: this._updateEnding(dt); break;
      default: break;
    }

    this.fx.update(dt);
    this.level.updateRunes(this.machine.time);
    this.pipeline.updateSky(this.sky);
    this.input.endFrame(dt);
    this.pipeline.render();
  };

  _updateMenu() {
    // The level renders behind the title, so it is stepped but not simulated.
    this.parallax.update(this.pipeline.viewX || 0, this.pipeline.viewY || 0);
    this._syncPlayerToWorld();
  }

  _updateCutscene(dt) {
    this.cutscene.update(dt);
    this.ui.typeLine.classList.toggle('done', !this.cutscene.typing);
    // Esc takes the whole scene, not one line per press.
    if (this.input.consume('pause')) { this.cutscene.skip(); return; }
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
    this.parallax.update(this.pipeline.viewX || 0, this.pipeline.viewY || 0);
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
    // Anything that falls into a pit is gone. Same rule as the player, so a
    // crawler walking off a ledge does not stand on the void forever.
    for (const e of this.enemies) {
      if (!e.dead && e.body && e.body.top < PIT_DEATH_Y) { e.body.enabled = false; e.dead = true; e.deathTimer = 0; }
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

    // ---- rotation hint. On entering L2, and again the first time the player
    // gets near one of its holes: the holes are the one mechanic in the game
    // with nothing on screen saying they exist.
    if (this.level.canRotate) {
      if (!this._hintOnEntry) { this._hintOnEntry = true; this.ui.showToast(t('rotateWorld'), 4.0); }
      else if (!this._hintNearHole) {
        for (const [hx] of (this.level.data.holes || [])) {
          if (Math.abs(p.cx - hx * TILE) > ROTATE_HINT_TILES * TILE) continue;
          this._hintNearHole = true;
          this.ui.showToast(t('rotateWorld'), 4.0);
          break;
        }
      }
    }

    // ---- elder
    if (this.elder) {
      this.elder.update(dt);
      const d = Math.abs(this.elder.x - p.cx);
      if (!this.story && !this.elder.talked && d < DEAL_RANGE) this._startDeal();
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
    // A fall out of a pit gets its own short sequence: red flash, then a
    // fall-out fade, then the normal death flow. The player is already dead
    // when this starts, so the generic path is held off until the fade is done.
    if (p.dead && p.pitDeath) { this._pitSequence(dt); return; }
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
    this.parallax.update(this.pipeline.viewX || 0, this.pipeline.viewY || 0);

    // L3: the sword halo is the only light, so the post pass is told where it is.
    if (this.levelDef.id === 3) {
      const b = this.pipeline.screenToBuffer(p.mesh.position.x + (p.facing * 8), p.mesh.position.y + 16);
      this.pipeline.setLight(b.x, b.y, 95);
    }

    // ---- boss trigger: fires on ENTERING the arena, not on being near the boss.
    // A distance check both ways let a player sprinting at full speed run clean
    // past the trigger radius and finish the level without ever meeting him.
    if (this.bossDef && !this.bossAwake && this.machine.is(S.PLAY, S.BOSS) &&
        p.cx > this.bossDef.x - BOSS_TRIGGER) {
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

    const spriteName = { statue: 'statue', ulburjo: 'goodwitch', patientone: 'demon' }[this.bossDef.boss];
    this.boss = new Cls({
      x: this.bossDef.x,
      // Without this the boss body had y=undefined, which became NaN after one
      // physics step and the sprite was never drawn at all -- the fight ran
      // with a health bar and an invisible opponent.
      y: this.bossDef.y ?? FLOOR_Y,
      character: this.characters,
      model: this.model,
      governor: this.governor,
      fx: this.fx,
      audio,
      level: this.level,
      makeSprite: () => {
        const s = this._charSprite(spriteName, 4);
        return s;
      },
    });
    // Ul Burjo drops the elder's disguise in phase 2, so the boss needs a handle
    // on the alternate sheet to swap into.
    if (this.bossDef.boss === 'ulburjo') {
      const alt = this._charSprite('badwitch', 4);
      this.boss.characterSet = { badwitch: { char: alt.char, material: alt.material, paletteLevel: this.levelDef.id } };
    }
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

  // ------------------------------------------------------------ the deal

  // Kael stops where he is, turns to face the elder, and the camera eases so
  // both of them are framed. Only then does the first line start, so the
  // conversation is never spoken over a camera that is still catching up.
  _startDeal() {
    this.elder.talked = true;
    const p = this.player;

    p.body.vx = 0;
    p.facing = this.elder.x >= p.cx ? 1 : -1;
    p.sprite.play('idle');

    const mid = (this.elder.x + p.cx) / 2 - LOW_RES_W / 2;
    this.story = {
      index: 0,
      chars: 0,
      typing: true,
      ease: DEAL_EASE,
      camFrom: this.cam.x,
      camTo: mid,
    };
    this.machine.to(S.STORY);
    this.ui.showStory(true);
    // Nothing typed yet, so the caret is hidden until the first line lands.
    this.ui.storyLine.classList.add('done');
  }

  _dealLine() { return DEAL[this.story.index] || null; }

  _paintStory() {
    const line = this._dealLine();
    if (!line) return;
    this.ui.storySpeaker.textContent = t(line.who === 'elder' ? 'spkElder' : 'spkKael');
    this.ui.storyLine.textContent = t(line.textKey).slice(0, this.story.chars);
    this.ui.storyLine.classList.toggle('done', !this.story.typing);
    // A still fades in for its own lines and back out on the first unmarked one.
    this.storyPanel.set(line.panel);
    this.ui.story.classList.toggle('has-panel', !!line.panel);
  }

  _updateStory(dt) {
    const p = this.player;
    const s = this.story;
    if (!s) { this.machine.to(S.PLAY); return; }

    if (s.ease > 0) {
      s.ease -= dt;
      const k = 1 - Math.max(0, s.ease) / DEAL_EASE;
      const e = 1 - Math.pow(1 - k, 3);
      this.cam.x = s.camFrom + (s.camTo - s.camFrom) * e;
      this.pipeline.setView(this.cam.x, this.cam.y);
      this.parallax.update(this.cam.x, this.cam.y);
      p.sprite.update(dt);
      this.elder?.update(dt);
      if (s.ease <= 0) { s.chars = 0; s.typing = true; this._paintStory(); }
      return;
    }

    const line = this._dealLine();
    if (!line) { this._endDeal(); return; }

    const text = t(line.textKey);
    if (s.typing && s.chars < text.length) {
      s.chars = Math.min(text.length, s.chars + DEAL_TYPE_CPS * dt);
      if (s.chars >= text.length) s.typing = false;
      this._paintStory();
    }

    // The two of them keep breathing; nothing else in the level simulates.
    p.sprite.update(dt);
    this.elder?.update(dt);

    if (this.input.consume('confirm') || this.input.consume('attack') || this.input.consume('jump')) {
      if (s.typing) {
        // First press finishes the line, second advances, same as a cutscene.
        s.chars = text.length;
        s.typing = false;
        this._paintStory();
      } else {
        s.index++;
        s.chars = 0;
        s.typing = true;
        if (s.index >= DEAL.length) { this._endDeal(); return; }
        this._paintStory();
      }
    }
  }

  // The deal hands straight into the theft cutscene, which gives control back
  // with the elder gone and a puff where he stood.
  _endDeal() {
    const gone = this.elder;
    const at = gone ? gone.x : this.player.cx;
    this.ui.showStory(false);
    this.story = null;
    this.machine.to(S.CUTSCENE);
    this.ui.show('cutscene');
    preloadPanels();
    this.cutscene.play(buildScript('theft'), () => {
      gone?.remove();
      this.elder = null;
      this._puff(at);
      this.beginPlay();
    });
  }

  // Toxic green where he stood. Deliberately given a longer life than a combat
  // burst: this one is supposed to still be drifting when control comes back.
  _puff(at) {
    const r = this.fx.rng;
    for (let i = 0; i < 16; i++) {
      this.fx.spawn(at + r.range(-11, 11), FLOOR_Y + r.range(4, 28), {
        vx: r.range(-18, 18), vy: r.range(20, 56), g: -5,
        life: r.range(0.9, 1.6), size: r.range(1, 3), color: 0x8fffc0,
      });
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

  // 0.12s of red flash, then 0.4s of fade to black, then the existing flow.
  // Held on the game rather than on the player, because it is a presentation
  // beat and the player's own state is already "dead".
  _pitSequence(dt) {
    if (this._pitTimer === undefined || this._pitTimer < 0) {
      this._pitTimer = 0;
      audio.sfxDie();
      this.cam.shake = 8;
    }
    this._pitTimer += dt;
    const FLASH = 0.12, FADE = 0.4;
    this.pipeline.setHurt(Math.max(0, 1 - this._pitTimer / FLASH) * 0.6);
    const after = Math.max(0, this._pitTimer - FLASH);
    this.pipeline.setFade(Math.max(0, 1 - after / FADE));

    this.fx.update(dt);
    this._updateCamera(dt);
    this.parallax.update(this.pipeline.viewX || 0, this.pipeline.viewY || 0);

    if (after >= FADE) {
      this._resetPitFlash();
      this.player.pitDeath = false;
      this._onDeath();
    }
  }

  _resetPitFlash() {
    this._pitTimer = -1;
    this.pipeline.setHurt(0);
    this.pipeline.setFade(1);
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
    this.parallax.update(this.pipeline.viewX || 0, this.pipeline.viewY || 0);
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

    // Work entirely in WORLD space, centred on the player, and clamp against the
    // axis-aligned bounds of the *transformed* level.
    //
    // The earlier version followed and clamped in the level's local frame. That
    // breaks after the L2 rotation: the group is turned, so local no longer maps
    // to screen axes, and a local-space clamp pins the view to a spot the player
    // is no longer at -- the camera snaps to the corner of the room and the
    // player leaves the frame. Transforming the level's four corners and taking
    // their bounds keeps the clamp correct at any rotation angle.
    const targetX = p.mesh.position.x + p.facing * CAM.lookAhead;
    const targetY = p.mesh.position.y - LOW_RES_H * 0.52;

    if (snap) {
      this.cam.x = targetX - LOW_RES_W * 0.5;
      this.cam.y = targetY;
    } else {
      this.cam.x = damp(this.cam.x, targetX - LOW_RES_W * 0.5, CAM.lerp, dt);
      this.cam.y = damp(this.cam.y, targetY, CAM.lerp, dt);
    }

    const b = this._levelWorldBounds();
    // Horizontally the view is clamped hard to the level: no overhang at all.
    // The old 25% slack let the camera sit up to 260px outside a 190-tile level,
    // which is what put a bare void along the start of L1 -- there is nothing
    // out there but the clear colour.
    // Vertically it still gets a little overhang, so a room taller than the
    // viewport is not pinned to its edge; a level barely taller than the
    // viewport gets almost none.
    const slack = (span, view) => Math.max(0, (span - view) * 0.25);
    this.cam.x = clamp(this.cam.x, b.minX, b.maxX - LOW_RES_W);
    this.cam.y = clamp(this.cam.y,
      b.minY - slack(b.maxY - b.minY, LOW_RES_H),
      b.maxY - LOW_RES_H + slack(b.maxY - b.minY, LOW_RES_H));

    this.cam.shake = Math.max(0, this.cam.shake - dt * CAM.shakeDecay * 3);
    if (this.cam.shake > 0.01) {
      this.cam.shakeX = (Math.random() - 0.5) * this.cam.shake;
      this.cam.shakeY = (Math.random() - 0.5) * this.cam.shake;
    } else { this.cam.shakeX = 0; this.cam.shakeY = 0; }

    this.pipeline.setView(this.cam.x + this.cam.shakeX, this.cam.y + this.cam.shakeY);
  }

  // World-space AABB of the level, recomputed only when the rotation angle
  // actually changes.
  _levelWorldBounds() {
    const w = this.level.worldWidth, h = this.level.worldHeight;
    const rot = this.level.rot;
    if (this._bounds && this._boundsRot === rot && this._boundsW === w && this._boundsH === h) {
      return this._bounds;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const v = this.level.localToWorld(new THREE.Vector3(cx, cy, 0));
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    this._bounds = { minX, maxX, minY, maxY };
    this._boundsRot = rot; this._boundsW = w; this._boundsH = h;
    return this._bounds;
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
