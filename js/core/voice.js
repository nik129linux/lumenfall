// Voice-over for dialogue and narration.
//
// The rest of the game's sound is synthesised, but a voice cannot be, so this is
// the one place that plays real audio files. One file per line of text, named
// after the line's key in strings.js:
//
//   assets/voices/es/deal1a.mp3     (or .wav)
//   assets/voices/en/deal1a.mp3
//
// A missing file is not an error: the line is simply read in silence, exactly
// as before. That means voices can be added one at a time, and the game never
// breaks because a recording has not been made yet.
//
// docs/voces.md lists every key with its speaker and text.

import { getLang } from '../ui/i18n.js';
import { audio } from './audio.js';

const DIR = 'assets/voices/';
const EXTS = ['wav', 'mp3'];   // Gemini's download is .wav, so try it first
const VOLUME = 1.0;

class Voice {
  constructor() {
    this.el = null;
    this.token = 0;       // bumps on every play/stop so a late-loading clip is dropped
    this.missing = new Set();
  }

  play(key) {
    this.stop();
    if (!key || audio.muted) return;
    const token = this.token;
    this._try(key, 0, token);
  }

  _try(key, extIdx, token) {
    const lang = getLang();
    const id = `${lang}/${key}`;
    if (extIdx >= EXTS.length || this.missing.has(id)) return;
    const el = new window.Audio(`${DIR}${id}.${EXTS[extIdx]}`);
    el.volume = VOLUME;
    el.addEventListener('error', () => {
      // This extension is not there; try the next, and remember a full miss.
      if (extIdx + 1 >= EXTS.length) this.missing.add(id);
      else if (token === this.token) this._try(key, extIdx + 1, token);
    }, { once: true });
    el.addEventListener('canplaythrough', () => {
      if (token !== this.token) return;          // the player already moved on
      this.el = el;
      el.play().catch(() => { /* autoplay refused: stay silent */ });
    }, { once: true });
    el.load();
  }

  stop() {
    this.token++;
    if (this.el) {
      this.el.pause();
      this.el = null;
    }
  }
}

export const voice = new Voice();
