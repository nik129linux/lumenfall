// Procedural audio.
//
// The project ships no audio files and stays static, so every sound is
// synthesised on demand. That is a feature, not a workaround: it means the
// whole game is a handful of text files plus the atlases.
//
// Everything is built from oscillators and a noise buffer, and the context is
// only created after a user gesture, which is what browsers require.

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._noise = null;
    this._ambient = null;
  }

  // Must be called from inside a user gesture handler.
  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this._noise = this._makeNoise();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 1.0;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _env(node, t0, a, d, peak) {
    const g = node.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + a);
    g.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  tone({ freq = 440, to = null, type = 'square', dur = 0.15, attack = 0.005, gain = 0.2, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    this._env(amp, t0, attack, dur, gain);
    osc.connect(amp); amp.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + attack + 0.02);
  }

  noise({ dur = 0.15, gain = 0.2, freq = 1200, q = 1, type = 'bandpass', delay = 0, sweepTo = null }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t0);
    if (sweepTo !== null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    filt.Q.value = q;
    const amp = this.ctx.createGain();
    this._env(amp, t0, 0.004, dur, gain);
    src.connect(filt); filt.connect(amp); amp.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  // ---- game events
  sfxSlash()  { this.noise({ dur: 0.11, gain: 0.16, freq: 3200, sweepTo: 900, q: 1.2 });
                this.tone({ freq: 880, to: 320, type: 'triangle', dur: 0.09, gain: 0.07 }); }
  sfxHit()    { this.noise({ dur: 0.13, gain: 0.2, freq: 700, q: 0.8, type: 'lowpass' });
                this.tone({ freq: 200, to: 70, type: 'square', dur: 0.11, gain: 0.12 }); }
  sfxDash()   { this.noise({ dur: 0.16, gain: 0.14, freq: 500, sweepTo: 2600, q: 2 }); }
  sfxJump()   { this.tone({ freq: 300, to: 620, type: 'square', dur: 0.1, gain: 0.08 }); }
  sfxLand()   { this.noise({ dur: 0.07, gain: 0.1, freq: 320, type: 'lowpass' }); }
  sfxRotate() { this.tone({ freq: 120, to: 420, type: 'sawtooth', dur: 0.55, gain: 0.09 });
                this.noise({ dur: 0.5, gain: 0.06, freq: 260, sweepTo: 1800, q: 3 }); }
  sfxHurt()   { this.tone({ freq: 420, to: 110, type: 'sawtooth', dur: 0.22, gain: 0.14 }); }
  sfxEmber()  { [660, 880, 1320].forEach((f, i) =>
                  this.tone({ freq: f, type: 'triangle', dur: 0.16, gain: 0.08, delay: i * 0.06 })); }
  sfxDie()    { this.tone({ freq: 300, to: 60, type: 'square', dur: 0.7, gain: 0.14 }); }
  sfxUi()     { this.tone({ freq: 700, type: 'square', dur: 0.05, gain: 0.06 }); }
  sfxType()   { this.tone({ freq: 1500 + Math.random() * 300, type: 'square', dur: 0.02, gain: 0.025 }); }
  sfxBoss()   { this.tone({ freq: 90, to: 55, type: 'sawtooth', dur: 1.1, gain: 0.16 });
                this.noise({ dur: 0.9, gain: 0.08, freq: 200, type: 'lowpass' }); }
  sfxPhase()  { this.tone({ freq: 140, to: 500, type: 'sawtooth', dur: 0.7, gain: 0.14 }); }

  // A slow two-oscillator drone per level. Retuned between levels rather than
  // crossfaded, which is jarring; the old one is faded out first.
  ambient(levelIndex) {
    if (!this.ctx) return;
    if (this._ambient) {
      const old = this._ambient;
      old.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
      setTimeout(() => { try { old.osc.forEach((o) => o.stop()); } catch (e) {} }, 1600);
    }
    const base = [55, 62, 49][levelIndex] ?? 55;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.05, this.ctx.currentTime, 1.2);
    gain.connect(this.master);
    const osc = [base, base * 1.5].map((f, i) => {
      const o = this.ctx.createOscillator();
      o.type = i ? 'sine' : 'triangle';
      o.frequency.value = f;
      o.connect(gain);
      o.start();
      return o;
    });
    this._ambient = { osc, gain };
  }
}

export const audio = new Audio();
