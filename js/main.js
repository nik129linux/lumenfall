import * as THREE from './vendor/three.module.js';

import { LOW_RES_W, LOW_RES_H, LEVELS, CAM, DASH_COOLDOWN, PIT_DEATH_Y, HITSTOP, SHAKE, ENEMY_KNOCKBACK, GA_MEASUREMENT_ID } from './core/config.js';
import { loadAssets } from './core/assets.js';
import { voice } from './core/voice.js';
import { loadArt } from './core/art.js';
import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import { clamp, damp, makeRng } from './core/rng.js';
import { Metrics, loadGoogleAnalytics } from './core/metrics.js';

import { Pipeline } from './render/pipeline.js';
import { Parallax, Sky } from './render/parallax.js';
import { HitboxOverlay } from './render/debug.js';
import { Sprite } from './render/sprite.js';
import { loadMinions, MinionArt, MinionSprite } from './render/minions.js';

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
import { Cutscene, CUTSCENES, buildScript, PanelStage, preloadPanels } from './ui/cutscene.js';
import { t, loadStoredLang, toggleLang, getLang } from './ui/i18n.js';

const BOSSES = { statue: Statue, ulburjo: UlBurjo, patientone: PatientOne };
const BOSS_INTRO = { 1: 'reveal', 2: 'waking' };

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
const SHIFT_HINT_TILES = 6;   // how close to a hole before the hint repeats
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
    // ?hitbox=1 draws every hit box over the scene (js/render/debug.js).
    this.hitboxes = new URLSearchParams(location.search).get('hitbox') === '1'
      ? new HitboxOverlay(this.pipeline.scene) : null;
    this.fx.projectiles = [];
    this.fx.scene = this.pipeline.scene;

    this.ui = new UI();
    this.cutscene = new Cutscene(this.ui);
    this.input = new Input(window);
    this.machine = new Machine(S.BOOT);

    // One log for the whole session, read by the metrics panel and forwarded to
    // Analytics. Created before anything can emit an event, including boot.
    this.metrics = new Metrics();
    this.ui.metrics = this.metrics;
    this.metrics.track('session_start', {});

    // Per-attempt clock and death count: reset by level_start, spent by
    // boss_defeated / level_complete.
    this.levelClock = 0;
    this.levelDeaths = 0;
    this.runSeconds = 0;   // sum of the finished levels, for game_complete
    this.runDeaths = 0;    // every death since this run started

    this.cam = { x: 0, y: 0, shake: 0, shakeX: 0, shakeY: 0, look: 0 };
    this.rng = makeRng(4242);
    this.clock = 0;
    this.fade = 1;
    this.fadeTarget = 1;

    this.hp = HP_PER_LEVEL;
    this.hitstop = 0;        // seconds of simulation freeze still owed to a hit
    this.hurtOverlay = 0;    // 0..1 red screen wash after Kael is hurt
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
    this.minionArt = null;
    this.player = null;
    this.deathTimer = 0;
    this.hintTimer = 0;
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    loadStoredLang();
    // Once per page load, and a no-op while the measurement id is empty.
    loadGoogleAnalytics(GA_MEASUREMENT_ID);
    this.ui.difficulty = 1;
    this.governor = new Governor(this.ui.difficultyKey());
    this.ui.onDifficultyChange = (key) => { this.governor = new Governor(key); };
    this.ui.onLangChange = () => this.ui.refreshStrings();
    this.ui.refreshStrings();
    this.wireMenu();

    // ---- loading screen
    // Locally the assets load in well under a second, which made the screen a
    // flash nobody could read. So: the bar eases toward the real progress
    // instead of jumping, the screen stays up for at least BOOT_MIN_MS, and a
    // rotating tip gives the player something to read while they wait.
    const BOOT_MIN_MS = 2600;
    const TIP_EVERY_MS = 1800;
    const fill = document.getElementById('boot-fill');
    const pctEl = document.getElementById('boot-pct');
    const noteEl = document.getElementById('boot-note');
    const bar = fill.parentElement;
    document.getElementById('boot-sub').textContent = t('subtitle');
    document.getElementById('boot-label').textContent = t('loading');
    const tips = [1, 2, 3, 4, 5].map((n) => t('loadTip' + n));
    let tipIdx = Math.floor(Math.random() * tips.length);
    noteEl.textContent = tips[tipIdx];
    const tipTimer = setInterval(() => {
      noteEl.classList.add('swap');
      setTimeout(() => {
        tipIdx = (tipIdx + 1) % tips.length;
        noteEl.textContent = tips[tipIdx];
        noteEl.classList.remove('swap');
      }, 350);
    }, TIP_EVERY_MS);

    const bootStart = performance.now();
    let target = 0, shown = 0, lastTick = bootStart;
    const paintBar = () => {
      // Ease toward the target, and never faster than the minimum time allows,
      // so the bar cannot reach 100% before the screen is allowed to leave.
      // Driven by a timer and real elapsed time, not requestAnimationFrame:
      // rAF stops in a background tab, which would leave the game stuck on
      // this screen until the player came back to it.
      const now = performance.now();
      const dt = (now - lastTick) / 1000;
      lastTick = now;
      const timeCap = Math.min(100, ((now - bootStart) / BOOT_MIN_MS) * 100);
      const goal = Math.min(target, timeCap);
      shown += (goal - shown) * (1 - Math.exp(-dt * 8));
      if (goal - shown < 0.3) shown = goal;
      fill.style.width = `${shown}%`;
      bar.setAttribute('aria-valuenow', String(Math.round(shown)));
      pctEl.textContent = `${Math.round(shown)}%`;
    };
    const barTimer = setInterval(paintBar, 33);
    const stopBar = () => { clearInterval(barTimer); clearInterval(tipTimer); };

    try {
      const loaded = await loadAssets((p) => { target = p * 100 * (5 / 9); });
      this.characters = loaded.characters;
      // The minion atlases share the loading bar: 5 of 9 characters, then 4
      // minion sheets. They are small, but a half-filled bar that then stalls
      // reads as a hang.
      const base = 5 / 9;
      const minions = await loadMinions((p) => { target = (base + p * (1 - base)) * 100; });
      this.minionArt = new MinionArt(minions);
      this.level.art = await loadArt();
      target = 100;
    } catch (err) {
      console.error('asset load failed', err);
      stopBar();
      noteEl.classList.remove('swap');
      noteEl.textContent = 'Error al cargar los recursos';
      return;
    }

    // Hold until the bar has actually filled, then a short beat on 100%.
    while (shown < 99.5) await new Promise((r) => setTimeout(r, 40));
    await new Promise((r) => setTimeout(r, 350));
    stopBar();

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
    on('menu-metrics', () => this.ui.showMetrics());
    on('metrics-close', () => this.ui.hideMetrics());
    on('pause-resume', () => this.setPaused(false));
    on('pause-retry', () => this.retryLevel());
    on('pause-title-btn', () => this.toTitle());
    on('ending-restart', () => { this.machine.to(S.MENU); this.ui.show('menu'); this._loadLevel(0, { silent: true }); this._onMenuOpen(); });
    on('ending-menu', () => { this.machine.to(S.MENU); this.ui.show('menu'); this._loadLevel(0, { silent: true }); this._onMenuOpen(); });

  }

  // ?level=1|2|3 and ?boss=1 drop straight into a level or its boss fight.
  // Stage 1's acceptance checks use these to reach the later levels and the
  // bosses without playing through them.
  //
  // ?cutscene=KEY plays one cutscene on its own, for the team, the demo and the
  // professor: panels 11-19 sit behind three bosses, and nobody should have to
  // grind them just to watch a scene.
  _applyUrlParams() {
    const q = new URLSearchParams(location.search);

    // The deal is not in CUTSCENES because it plays over the level next to the
    // elder, not as a scene of its own. An unknown key falls through to the menu.
    const cut = q.get('cutscene') || '';
    if (CUTSCENES[cut]?.length) {
      this.playCutscene(cut, () => { this.machine.to(S.MENU); this.ui.show('menu'); });
      return;
    }

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
    this._levelStart();
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
    const order = ['menu-new', 'menu-continue', 'menu-controls', 'menu-metrics'];
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
      // Before anything else can swallow it: a sheet open over the menu is
      // dismissed with the same key that pauses the game.
      if (e.code === 'Escape' && this.ui.metricsOpen) {
        e.preventDefault();
        this.ui.hideMetrics();
        return;
      }
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
    this.runSeconds = 0;
    this.runDeaths = 0;
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
    this._levelStart();
    this.hintTimer = 3.0;
    // The level number string and the zone name are the same string, so joining
    // them printed "Santuario de la Brasa — Santuario de la Brasa". One name.
    this.ui.showToast(t(LEVELS[this.levelIndex].nameKey), 2.2);
  }

  // Every path that hands the controls back: the first level after the prologue,
  // the next level after a boss, and a retry. A retry counts as a fresh start
  // because it reloads the level and restarts the clock the player is measured by.
  _levelStart() {
    this.levelClock = 0;
    this.levelDeaths = 0;
    this.metrics.track('level_start', { level: this.levelDef.id });
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
    this._levelStart();
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
    this.fx.clearTelegraphs();
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
    for (const s of this.shards) s.dispose();
    for (const pr of this.fx.projectiles) pr.dispose();
    if (this.elder) this.elder.mesh.parent?.remove(this.elder.mesh);
    // Mirrors the removal on the boss death path below. The boss lives in the
    // level's group, not the scene: L2 turns that group, and a boss outside it
    // would stay put while the arena swung away underneath him.
    if (this.boss) this.level.group.remove(this.boss);

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
        const s = new Shard(def, this.level.art, this.levelDef.id);
        this.shards.push(s);
        this.pipeline.scene.add(s.mesh);
      } else if (def.type === 'wisp' || def.type === 'crawler' || def.type === 'spitter') {
        const en = new Enemy(def, this.model, this.governor, (type) => this._bodySprite(type));
        // The spitter's onFire was optional-chained and never assigned, so it
        // had been holding position and shooting nothing at all.
        if (def.type === 'spitter') en.onFire = this._spitterShot();
        en.fx = this.fx;   // dust on lunges and landings
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
      this.level.player = this.player;
    }

    this.cam.x = 0; this.cam.y = 0; this._bounds = null;
    this._syncPlayerToWorld();
    this._updateCamera(0.016, true);
    this.pipeline.setView(this.cam.x, this.cam.y);
  }

  _charSprite(name, speed) {
    return new Sprite(this.characters[name], { speed, outline: 0x05080a });
  }

  // Minions are drawn from the atlases in sprites/, cut from Nico's sheets by
  // tools/cut_minions.py. They used to be assembled from the cast -- wisps wore
  // the demon, crawlers the statue, spitters Ul Burjo -- which put the level 3
  // boss on screen in level 1.
  _bodySprite(type) {
    if (!this.minionArt) throw new Error('minion art not loaded');
    return new MinionSprite(this.minionArt, type, this.levelDef?.accent ?? 0x54f0a8);
  }

  // The spitter's projectile is the loose green fireball that sat between cast
  // frames 3 and 4 on Nico's sheet, cut out as its own sprite. It flickers
  // between two scales so a single still frame reads as thrown, not stuck.
  _spitterShot() {
    const shot = this.minionArt.character('spitterShot');
    // vy is the spitter's aim (see Enemy._spit); 0 is the old straight shot.
    return (x, y, dir, vy = 0) => {
      this.fx.projectiles.push(new Projectile(
        this.pipeline.scene, x, y, dir * 88, vy, {
          texture: shot.texture,
          size: shot.display,
          r: 4,
          dmg: 1,
          life: 2.4,
          flicker: true,
        }));
    };
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

    // Hitstop: while it is owed, the simulation (and the particles) stand still
    // and only the camera keeps running, so the shake still plays. simDt is what
    // the simulation sees; 0 means "skip the step", never "step by zero".
    let simDt = dt;
    const playing = this.machine.state === S.PLAY || this.machine.state === S.BOSS;
    if (playing && this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      simDt = 0;
    }

    if (playing && simDt === 0) {
      this._updateCamera(dt);
    } else switch (this.machine.state) {
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

    this.fx.update(simDt);
    this.hitboxes?.update(this);
    this.level.updateRunes(this.machine.time);
    this.pipeline.updateSky(this.sky);
    this.input.endFrame(simDt);   // the input buffer must not drain while frozen
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
    // Time on the level, boss fight included: the player is playing the boss too.
    this.levelClock += dt;
    this.level.update(dt);
    this._updateShiftTint(dt);

    // ---- L2 world shift: pressing E toggles between two versions of the same
    // map. Nothing moves; tiles appear and disappear and the palette changes.
    if (this.input.consume('rotate') && this.level.canShift) {
      const ok = this.level.shiftWorld();
      if (ok) {
        audio.sfxRotate();
        this.cam.shake = Math.max(this.cam.shake, 2);
        this._shiftFlash = 0.2;
        this._shiftTintT = 0;
      } else if (this.level.shiftRefused) {
        audio.sfxHurt();
        this.ui.showToast(t('shiftDenied'), 1.2);
      }
    }
    if (this._shiftFlash > 0) this._shiftFlash = Math.max(0, this._shiftFlash - dt);

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
    if (p.justLanded) {
      p.justLanded = false;
      this.fx.dust(p.cx - 4, p.body.bottom);
      this.fx.dust(p.cx + 4, p.body.bottom);
    }
    if (p.justSkidded) {
      p.justSkidded = false;
      this.fx.dust(p.cx - p.facing * 6, p.body.bottom);
    }
    this.fx.ambient(dt, this.levelDef?.id, this.cam.x, this.cam.y, LOW_RES_W, LOW_RES_H);

    // ---- the player model: everything the adaptive AI reads
    this._recordActions(dt);

    // ---- attack
    const swing = p.updateAttackFrame();
    if (swing) {
      if (swing === 'start') {
        audio.sfxSlash();
        // Drawn from the body centre so the arc covers the same stretch as the
        // attack box (4-20 px out), not the blade-tip light position.
        const ar = p.attackRect();
        this.fx.slashArc(p.cx, (ar.bottom + ar.top) / 2, p.facing);
      }
      this._resolvePlayerHit();
    }

    // ---- enemies
    this.governor.update(this.model);
    for (const e of this.enemies) e.update(dt, p, data);
    // Anything that falls into a pit is gone. Same rule as the player, so a
    // crawler walking off a ledge does not stand on the void forever.
    for (const e of this.enemies) {
      if (!e.dead && e.body && e.body.top < PIT_DEATH_Y) { e.body.enabled = false; e.dead = true; e.deathTimer = 0; }
      // Long enough for the longest cut death clip (spitter, 4 frames at 6fps)
      // to finish. Removing at the old 0.45s cut every dissolve short.
      if (e.dead && e.deathTimer > 0.7 && e.mesh.parent) {
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
        this.fx.burst(s.x, s.y, s.color, 12, 55);
        this.fx.burst(s.x, s.y, 0xffffff, 4, 30);
      }
    }

    // ---- shift hint. On entering L2, and again the first time the player
    // gets near one of its holes: the holes are the one mechanic in the game
    // with nothing on screen saying they exist.
    if (this.level.canShift) {
      if (!this._hintOnEntry) { this._hintOnEntry = true; this.ui.showToast(t('rotateWorld'), 4.0); }
      else if (!this._hintNearHole) {
        for (const [hx] of (this.level.data.holes || [])) {
          if (Math.abs(p.cx - hx * TILE) > SHIFT_HINT_TILES * TILE) continue;
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
    // One event per hit (Player.hurt sets hurtEvent). This used to run every frame
    // of the invulnerability window, which replayed the hurt sound 50 times and
    // never took any health.
    if (p.hurtEvent && !p.dead) {
      p.hurtEvent = false;
      this.hp = Math.max(0, this.hp - 1);
      this.ui.setHealth(this.hp, HP_PER_LEVEL);
      audio.sfxHurt();
      this.addHitstop(HITSTOP.playerHurt);
      this.cam.shake = Math.max(this.cam.shake, SHAKE.playerHurt);
      this.hurtOverlay = 0.6;
      if (this.hp <= 0) p.kill();
    }
    this.hurtOverlay = Math.max(0, this.hurtOverlay - dt * 1.5);
    if (!p.pitDeath) this.pipeline.setHurt(this.hurtOverlay);
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
    // Once per target per swing while a swing is on. With no swing (the gates
    // call this directly) every call counts.
    const struck = (t) => p.isAttacking && p.swingHits.has(t);
    for (const e of this.enemies) {
      if (e.dead || e.mesh == null || struck(e)) continue;
      const er = e.struckRect();
      if (r.left < er.right && r.right > er.left && r.bottom < er.top && r.top > er.bottom) {
        if (p.isAttacking) p.swingHits.add(e);
        e.hurt(1);
        this.fx.burst(e.cx, e.cy, 0xffd08a, 6, 60);
        // Knockback away from the blade; the enemy is staggered so it keeps it.
        e.body.vx += Math.sign(p.facing) * ENEMY_KNOCKBACK;
        this.addHitstop(HITSTOP.enemy);
        this.cam.shake = Math.max(this.cam.shake, SHAKE.enemy);
      }
    }
    if (this.boss && !this.boss.dead && this.boss.state !== 'sleep' && !struck(this.boss)) {
      const br = this.boss.struckRect();
      let landed = false;
      if (r.left < br.right && r.right > br.left && r.bottom < br.top && r.top > br.bottom) {
        landed = this.boss.hurt(1);
      } else {
        const hr = this.boss.hurtRect();
        if (r.left < hr.right && r.right > hr.left && r.bottom < hr.top && r.top > hr.bottom) {
          landed = this.boss.hurt(1);
        }
      }
      if (landed) {
        if (p.isAttacking) p.swingHits.add(this.boss);
        const kill = this.boss.dead;
        this.addHitstop(kill ? HITSTOP.bossKill : HITSTOP.boss);
        this.cam.shake = Math.max(this.cam.shake, kill ? SHAKE.bossKill : SHAKE.boss);
      }
    }
  }

  addHitstop(seconds) { this.hitstop = Math.max(this.hitstop, seconds); }

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
      // The Patient One's surge reaches into the post pass, and the post pass is
      // the game's, not the boss's.
      pipeline: this.pipeline,
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
    this.level.group.add(this.boss);

    // A boss arena is a duel. The L1 crawler's patrol runs straight through the
    // arena gate, so it used to keep landing hits with no tell at all for the
    // whole fight -- chip damage the player could not read and could not
    // punish, which is the one thing a boss fight must not contain. Marked dead
    // rather than deleted, so they dissolve on their own death clip.
    for (const e of this.enemies) { e.dead = true; e.deathTimer = 0; }

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
      this.level.group.remove(this.boss);
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
      if (s.ease <= 0) { s.chars = 0; s.typing = true; this._paintStory(); voice.play(this._dealLine()?.textKey); }
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
        voice.play(this._dealLine()?.textKey);
      }
    }
  }

  // The deal hands straight into the theft cutscene, which gives control back
  // with the elder gone and a puff where he stood.
  _endDeal() {
    const gone = this.elder;
    const at = gone ? gone.x : this.player.cx;
    voice.stop();
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
    // The clock and the death count belong to the level that just ended, so
    // both events are emitted before anything reloads the next one.
    this.metrics.track('boss_defeated', {
      boss: this.bossDef.boss,
      seconds: this.levelClock,
      deaths: this.levelDeaths,
    });
    this.runSeconds += this.levelClock;
    this.metrics.track('level_complete', {
      level: this.levelDef.id,
      seconds: this.levelClock,
      deaths: this.levelDeaths,
    });
    this.hp = Math.min(HP_PER_LEVEL, this.hp + 2);
    if (this.levelIndex >= 2) {
      this.machine.to(S.CUTSCENE);
      this.ui.show('cutscene');
      this.cutscene.play(buildScript('return'), () => this._showEnding());
      return;
    }
    const arenaTurns = this.level.shiftCount;
    this.levelIndex++;
    this._loadLevel(this.levelIndex, { silent: true });
    this.level.shiftCount = arenaTurns;
    audio.ambient(this.levelIndex);
    this.machine.to(S.CUTSCENE);
    this.ui.show('cutscene');
    const key = BOSS_INTRO[this.levelIndex];
    if (!key) { this.beginPlay(); return; }
    this.cutscene.play(buildScript(key), () => this.beginPlay());
  }

  _showEnding() {
    this.machine.to(S.ENDING);
    this.ui.show('ending');
    this.metrics.track('game_complete', { seconds: this.runSeconds, deaths: this.runDeaths });
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
      // Read the flag before it is cleared: this is the only moment that says
      // whether the death was a fall or a hit.
      const wasPit = this.player.pitDeath;
      this.player.pitDeath = false;
      this._onDeath(wasPit ? 'pit' : 'hp');
    }
  }

  _resetPitFlash() {
    this._pitTimer = -1;
    this.pipeline.setHurt(0);
    this.pipeline.setFade(1);
  }

  // `cause` is passed in rather than read off the player because the pit path has
  // to clear `pitDeath` before it gets here. The S.DEAD guard is what makes this
  // exactly one event per death and not one per frame.
  _onDeath(cause = 'hp') {
    if (this.machine.state === S.DEAD) return;
    this.machine.to(S.DEAD);
    this.deathTimer = 0;
    this.levelDeaths++;
    this.runDeaths++;
    const tileX = this.player.body.x / TILE;
    this.metrics.track('player_death', {
      level: this.levelDef.id,
      zone: Math.floor(tileX / 20),
      cause,
    });
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
    const w = this.level.localToWorld(new THREE.Vector3(this.player.cx, this.player.body.bottom, 0));
    this.player.mesh.position.set(w.x, w.y, 0);
  }

  // The far backdrop lerps to a green tint in world B and back in world A,
  // over ~0.25 s. Driven from here so the render layers stay dumb.
  _updateShiftTint(dt) {
    const far = this.parallax?.layers?.[0]?.mesh?.material;
    if (!far) return;
    const base = this.levelDef?.id === 3 ? 0x909090 : 0x707070;
    const target = new THREE.Color(this.level.world === 1 ? 0xa8d8a0 : base);
    far.color.lerp(target, Math.min(1, dt / 0.25));
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
    // The look-ahead eases across on a turn instead of jumping 2 * lookAhead
    // in one frame, which made every turnaround a sudden pan.
    this.cam.look = snap ? p.facing * CAM.lookAhead : damp(this.cam.look, p.facing * CAM.lookAhead, 2.5, dt);
    const targetX = p.mesh.position.x + this.cam.look;
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

  // World-space AABB of the level. Nothing moves, so this is just the
  // axis-aligned extent of the map.
  _levelWorldBounds() {
    const w = this.level.worldWidth, h = this.level.worldHeight;
    if (this._bounds && this._boundsW === w && this._boundsH === h) {
      return this._bounds;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const v = this.level.localToWorld(new THREE.Vector3(cx, cy, 0));
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    this._bounds = { minX, maxX, minY, maxY };
    this._boundsW = w; this._boundsH = h;
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
