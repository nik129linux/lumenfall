import { t } from './i18n.js';
import { audio } from '../core/audio.js';

// Cutscenes: a fullscreen panel, letterbox bars that tween in, and a typewriter.
//
// The typewriter skips instantly rather than fast-forwarding when the player
// presses again, and the panel advances on a further press. Getting that order
// wrong is the classic cutscene annoyance: you tap once to skip the typing and
// the whole scene blows past the part you had not read yet.

const TYPE_CHARS_PER_SEC = 46;

export class Cutscene {
  constructor(ui) {
    this.ui = ui;
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
    this.ui.show('cutscene');
    this._paint();
  }

  get current() { return this.lines[this.index] || null; }

  _paint() {
    const line = this.current;
    if (!line) return;
    this.ui.cutTitle.textContent = line.title || '';
    this.ui.panelArt.dataset.art = line.art || '';
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

  _finish() {
    this.active = false;
    this.finished = true;
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
  intro: [
    { art: 'elder', titleKey: 'cs1Title', textKey: 'cs1a' },
    { art: 'kael', titleKey: 'cs1Title', textKey: 'cs1b' },
    { art: 'elder', titleKey: 'cs1Title', textKey: 'cs1c' },
  ],
  theft: [
    { art: 'ember', titleKey: 'cs2Title', textKey: 'cs2a' },
    { art: 'ember', titleKey: 'cs2Title', textKey: 'cs2b' },
    { art: 'kael', titleKey: 'cs2Title', textKey: 'cs2c' },
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

export function buildScript(key) {
  return (CUTSCENES[key] || []).map((l) => ({
    art: l.art,
    title: t(l.titleKey),
    text: t(l.textKey),
  }));
}
