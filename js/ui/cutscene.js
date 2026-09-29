import { t } from './i18n.js';
import { audio } from '../core/audio.js';

// Cutscenes: a fullscreen panel, letterbox bars that tween in, and a typewriter.
//
// The typewriter skips instantly rather than fast-forwarding when the player
// presses again, and the panel advances on a further press. Getting that order
// wrong is the classic cutscene annoyance: you tap once to skip the typing and
// the whole scene blows past the part you had not read yet.

const TYPE_CHARS_PER_SEC = 46;

const PANEL_DIR = 'assets/cutscenes/';
const PANEL_IDS = ['01', '02', '03', '04', '05', '06'];
// An art id of two digits is a real still; anything else is one of the legacy
// colour fields further down, which later stages still use.
const isPanelId = (art) => /^[0-9]{2}$/.test(art || '');

const preloaded = new Set();

// All six stills are requested the moment a new game starts, so the first panel
// is never a pop-in after the typing has already begun.
export function preloadPanels() {
  for (const id of PANEL_IDS) {
    if (preloaded.has(id)) continue;
    preloaded.add(id);
    const img = new Image();
    img.src = `${PANEL_DIR}${id}.png`;
  }
  return preloaded.size;
}

// The still behind a panel: `contain` in the strip between the bars, with the
// same image again as a blurred `cover` so square panels have no black bars.
// Two layers crossfade, and each pushes in slowly from alternating sides.
export class PanelStage {
  constructor(root) {
    this.root = root;
    this.layers = [...root.querySelectorAll('.panel-layer')];
    this.front = 0;
    this.parity = 0;
  }

  set(art) {
    this.root.dataset.art = art || '';
    if (!isPanelId(art)) { this.hide(); return; }

    const back = 1 - this.front;
    const layer = this.layers[back];
    const [bg, img] = layer.querySelectorAll('img');
    const src = `${PANEL_DIR}${art}.png`;
    if (img.getAttribute('src') !== src) {
      bg.setAttribute('src', src);
      img.setAttribute('src', src);
    }
    layer.classList.toggle('origin-left', this.parity % 2 === 0);
    // Restart the push-in from 1.00: drop the class, force a reflow so the
    // browser registers the reverted transform, then re-add it.
    layer.classList.remove('zoomed');
    void layer.offsetWidth;
    layer.classList.add('on', 'zoomed');
    this.layers[this.front].classList.remove('on');
    this.front = back;
    this.parity++;
  }

  hide() { for (const l of this.layers) l.classList.remove('on'); }
}

export class Cutscene {
  constructor(ui) {
    this.ui = ui;
    this.panel = new PanelStage(ui.panelArt);
    this.lines = [];
    this.index = 0;
    this.chars = 0;
    this.active = false;
    this.finished = false;
    this.typing = false;
    this.onDone = null;
    this._holdFor = 0;
  }

  play(script, onDone) {
    this.lines = script;
    this.index = 0;
    this.chars = 0;
    this.active = true;
    this.finished = false;
    this.typing = true;
    this.onDone = onDone || null;
    preloadPanels();
    this.ui.show('cutscene');
    this._paint();
  }

  get current() { return this.lines[this.index] || null; }

  _paint() {
    const line = this.current;
    if (!line) return;
    this.ui.cutTitle.textContent = line.title || '';
    this.panel.set(line.art);
    this.ui.typeLine.textContent = line.text.slice(0, this.chars);
  }

  advance() {
    if (!this.active) return;
    const line = this.current;
    if (!line) { this._finish(); return; }

    if (this.chars < line.text.length) {
      // First press completes the line instead of skipping to the next one.
      this.chars = line.text.length;
      this.typing = false;
      this._paint();
      return;
    }

    this.index++;
    this.chars = 0;
    this.typing = true;
    this._holdFor = 0;
    if (this.index >= this.lines.length) { this._finish(); return; }
    this._paint();
  }

  // Esc: the whole scene at once, rather than one line per press.
  skip() { if (this.active) this._finish(); }

  _finish() {
    this.active = false;
    this.finished = true;
    this.panel.hide();
    const done = this.onDone;
    this.onDone = null;
    if (done) done();
  }

  update(dt) {
    if (!this.active) return;
    const line = this.current;
    if (!line) return;

    if (this.typing && this.chars < line.text.length) {
      const before = Math.floor(this.chars);
      this.chars += TYPE_CHARS_PER_SEC * dt;
      const after = Math.floor(this.chars);
      // One click per few characters, so a long line does not machine-gun the
      // audio channel.
      if (after > before && after % 3 === 0) audio.sfxType();
      this._paint();
      if (this.chars >= line.text.length) this.typing = false;
    } else if (!this.typing) {
      this._holdFor += dt;
    }
  }

  // True once the player has had a moment to read a completed line.
  get canAdvance() { return !this.typing; }
}

// ---- scripts -----------------------------------------------------------------
// Keys into the strings table, so a cutscene never carries its own text.

export const CUTSCENES = {
  // The opening: narration only, over stills 01 and 02. No speaker name.
  prologue: [
    { art: '01', textKey: 'pr1a' },
    { art: '01', textKey: 'pr1b' },
    { art: '02', textKey: 'pr2a' },
    { art: '02', textKey: 'pr2b' },
  ],
  // Still 03, 04 and 06 are spoken in-game over the level; see DEAL in main.js.
  theft: [
    { art: '05', textKey: 'th1a' },
    { art: '05', speakerKey: 'spkElder', textKey: 'th1b' },
    { art: '06', textKey: 'th2a' },
    { art: '06', speakerKey: 'spkKael', textKey: 'th2b' },
  ],
  // `intro` is the level 2 boss cutscene, kept because BOSS_INTRO still plays
  // it. Its lines predate the deal and are listed in the stage 2 report as
  // contradicting it.
  intro: [
    { art: 'elder', titleKey: 'cs1Title', textKey: 'cs1a' },
    { art: 'kael', titleKey: 'cs1Title', textKey: 'cs1b' },
    { art: 'elder', titleKey: 'cs1Title', textKey: 'cs1c' },
  ],
  reveal: [
    { art: 'ulburjo', titleKey: 'cs3Title', textKey: 'cs3a' },
    { art: 'ulburjo', titleKey: 'cs3Title', textKey: 'cs3b' },
    { art: 'demon', titleKey: 'cs3Title', textKey: 'cs3c' },
  ],
  waking: [
    { art: 'demon', titleKey: 'cs4Title', textKey: 'cs4a' },
    { art: 'demon', titleKey: 'cs4Title', textKey: 'cs4b' },
    { art: 'dark', titleKey: 'cs4Title', textKey: 'cs4c' },
  ],
  return: [
    { art: 'ember', titleKey: 'cs5Title', textKey: 'cs5a' },
    { art: 'kael', titleKey: 'cs5Title', textKey: 'cs5b' },
    { art: 'green', titleKey: 'cs5Title', textKey: 'cs5c' },
    { art: 'green', titleKey: 'cs5Title', textKey: 'cs5d' },
    { art: 'green', titleKey: 'cs5Title', textKey: 'cs5e' },
  ],
};

// Per-line speaker when the script sets one (the theft); otherwise the
// scene-wide title, which is how the older scripts work.
export function buildScript(key) {
  return (CUTSCENES[key] || []).map((l) => ({
    art: l.art,
    title: l.speakerKey ? t(l.speakerKey) : (l.titleKey ? t(l.titleKey) : ''),
    text: t(l.textKey),
  }));
}
