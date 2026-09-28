import { t, getLang, setLang, toggleLang } from './i18n.js';
import { audio } from '../core/audio.js';

// DOM overlays rather than in-canvas text.
//
// Two reasons: crisp type at any window size without shipping a bitmap font, and
// the letterbox/cutscene panels need to sit above the upscaled buffer anyway.
// Every string here comes from the strings table -- there is no literal
// player-facing text in this file.

const el = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.root = el('ui');
    this.hud = el('hud');
    this.menu = el('menu');
    this.cutscene = el('cutscene');
    this.pause = el('pause');
    this.ending = el('ending');
    this.toast = el('toast');
    this.bossbar = el('bossbar');

    this.hpPips = el('hp-pips');
    this.dashPip = el('dash-pip');
    this.dashLabel = el('dash-label');
    this.emberCount = el('ember-count');
    this.zoneLabel = el('zone-label');
    this.bossName = el('boss-name');
    this.bossFill = el('boss-fill');
    this.bossPhase = el('boss-phase');

    this.typeLine = el('type-line');
    this.cutTitle = el('cut-title');
    this.panelArt = el('panel-art');
    this.cutHint = el('cut-hint');

    this.menuList = el('menu-list');
    this.pauseList = el('pause-list');
    this.controlsPanel = el('controls-panel');
    this.controlsBody = el('controls-body');
    this.titleEl = el('title-text');
    this.subtitleEl = el('subtitle-text');
    this.difficultyRow = el('difficulty-row');
    this.langRow = el('lang-row');

    this._toastTimer = 0;
    this._buildControls();
  }

  // ---- language
  refreshStrings() {
    this.titleEl.textContent = t('title');
    this.subtitleEl.textContent = t('subtitle');
    this.zoneLabel.textContent = '';
    el('menu-new').textContent = t('newGame');
    el('menu-continue').textContent = t('continueGame');
    el('difficulty-label').textContent = t('difficulty');
    el('lang-label').textContent = t('language');
    el('menu-controls').textContent = t('controls');
    el('menu-back').textContent = t('back');
    el('ember-label').textContent = t('ember');
    el('hp-label').textContent = t('hp');
    el('pause-title').textContent = t('paused');
    el('pause-resume').textContent = t('resume');
    el('pause-retry').textContent = t('retry');
    el('pause-title-btn').textContent = t('toTitle');
    el('ending-title').textContent = t('endingTitle');
    el('ending-sub').textContent = t('endingSub');
    el('ending-restart').textContent = t('endingRestart');
    el('ending-menu').textContent = t('endingTitle2');
    el('cut-hint').textContent = `${t('pressAny')} · ${t('skip')}`;
    this._buildControls();
    this._renderMenu();
  }

  _buildControls() {
    if (!this.controlsBody) return;
    const rows = [
      ['ctlMove', 'ctlKeysMove'],
      ['ctlJump', 'ctlKeysJump'],
      ['ctlAttack', 'ctlKeysAttack'],
      ['ctlDash', 'ctlKeysDash'],
      ['ctlRotate', 'ctlKeysRotate'],
      ['ctlPause', 'ctlKeysPause'],
      ['ctlLang', 'ctlKeysLang'],
    ];
    this.controlsBody.innerHTML = rows
      .map(([k, keys]) => `<div class="ctl-row"><span>${t(k)}</span><kbd>${t(keys)}</kbd></div>`)
      .join('') + `<p class="ctl-note">${t('ctlRotNote')}</p>`;
  }

  _renderMenu() {
    if (!this.menuList) return;
    this._buildDifficulty();
    this._buildLang();
  }

  _buildDifficulty() {
    if (!this.difficultyRow) return;
    const keys = ['diffEasy', 'diffNormal', 'diffHard'];
    this.difficultyRow.innerHTML = keys
      .map((k, i) => `<button class="opt${this.difficulty === i ? ' on' : ''}" data-diff="${i}">${t(k)}</button>`)
      .join('');
    this.difficultyRow.querySelectorAll('[data-diff]').forEach((b) => {
      b.addEventListener('click', () => {
        this.difficulty = Number(b.dataset.diff);
        audio.sfxUi();
        this._buildDifficulty();
        this.onDifficultyChange?.(this.difficultyKey());
      });
    });
  }

  _buildLang() {
    if (!this.langRow) return;
    const opts = [['es', 'Español'], ['en', 'English']];
    this.langRow.innerHTML = opts
      .map(([k, label]) => `<button class="opt${getLang() === k ? ' on' : ''}" data-lang="${k}">${label}</button>`)
      .join('');
    this.langRow.querySelectorAll('[data-lang]').forEach((b) => {
      b.addEventListener('click', () => {
        setLang(b.dataset.lang);
        audio.sfxUi();
        this.refreshStrings();
        this.onLangChange?.();
      });
    });
  }

  difficultyKey() { return ['easy', 'normal', 'hard'][this.difficulty ?? 1]; }

  // ---- screens
  show(name) {
    for (const [k, node] of Object.entries({
      menu: this.menu, cutscene: this.cutscene, pause: this.pause, ending: this.ending,
    })) {
      if (!node) continue;
      node.classList.toggle('on', k === name);
    }
    this.hud?.classList.toggle('on', name === 'hud' || name === 'pause');
    this.root?.classList.toggle('playing', name === 'hud' || name === 'pause');
  }

  showHud() {
    this.menu?.classList.remove('on');
    this.cutscene?.classList.remove('on');
    this.ending?.classList.remove('on');
    this.pause?.classList.remove('on');
    this.hud?.classList.add('on');
    this.root?.classList.add('playing');
  }

  hideAll() {
    this.root?.classList.remove('playing');
    for (const node of [this.menu, this.cutscene, this.pause, this.ending, this.hud]) {
      node?.classList.remove('on');
    }
  }

  // ---- HUD
  setHealth(hp, max) {
    if (!this.hpPips) return;
    if (this.hpPips.childElementCount !== max) {
      this.hpPips.innerHTML = Array.from({ length: max }, () => '<i class="pip"></i>').join('');
    }
    [...this.hpPips.children].forEach((n, i) => n.classList.toggle('out', i >= hp));
  }

  setDash(ready, frac) {
    if (!this.dashPip) return;
    this.dashPip.classList.toggle('ready', ready);
    this.dashPip.style.setProperty('--fill', `${Math.round(frac * 100)}%`);
    if (this.dashLabel) this.dashLabel.textContent = ready ? t('dashReady') : t('dashCharging');
  }

  setEmber(n) { if (this.emberCount) this.emberCount.textContent = String(n); }

  setZone(key) { if (this.zoneLabel) this.zoneLabel.textContent = t(key); }

  setBoss(nameKey, hpFrac, phase, total) {
    if (!this.bossbar) return;
    if (nameKey === null) { this.bossbar.classList.remove('on'); return; }
    this.bossbar.classList.add('on');
    this.bossName.textContent = t(nameKey);
    this.bossFill.style.width = `${Math.max(0, Math.min(1, hpFrac)) * 100}%`;
    this.bossPhase.textContent = total > 1 ? `${t('phase')} ${phase}/${total}` : '';
  }

  showToast(text, secs = 1.8) {
    if (!this.toast) return;
    this.toast.textContent = text;
    this.toast.classList.add('on');
    this._toastTimer = secs;
  }

  update(dt) {
    if (this._toastTimer > 0) {
      this._toastTimer -= dt;
      if (this._toastTimer <= 0) this.toast?.classList.remove('on');
    }
  }
}
