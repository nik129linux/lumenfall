// Input with a short buffer.
//
// Buffering matters more than it looks: the dash has a 1s cooldown and the
// rotate has a 0.6s tween, so a player who presses jump slightly early during a
// landing would otherwise eat the input and feel the game dropped it. A 120ms
// buffer turns that into "the jump happened on the frame it became legal".

const BUFFER_TIME = 0.12;

const MAP = {
  left:   ['KeyA', 'ArrowLeft'],
  right:  ['KeyD', 'ArrowRight'],
  up:     ['KeyW', 'ArrowUp'],
  down:   ['KeyS', 'ArrowDown'],
  jump:   ['Space', 'KeyW', 'ArrowUp'],
  attack: ['KeyJ', 'KeyZ'],
  dash:   ['KeyK', 'KeyX', 'ShiftLeft', 'ShiftRight'],
  rotate: ['KeyE'],
  pause:  ['Escape', 'KeyP'],
  lang:   ['KeyL'],
  confirm:['Enter', 'Space', 'KeyJ', 'KeyZ'],
};

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set();
    this.buffer = new Map();
    this.anyKey = false;
    this._justPressedAny = false;

    this._onKeyDown = (e) => {
      // Let the browser keep its own shortcuts (devtools, reload, tab switch).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (this._shouldSwallow(e.code)) e.preventDefault();
      this._justPressedAny = true;
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      for (const [action, codes] of Object.entries(MAP)) {
        if (codes.includes(e.code)) this.buffer.set(action, BUFFER_TIME);
      }
    };

    this._onKeyUp = (e) => { this.down.delete(e.code); };
    this._onBlur = () => { this.down.clear(); };

    target.addEventListener('keydown', this._onKeyDown, { passive: false });
    target.addEventListener('keyup', this._onKeyUp);
    target.addEventListener('blur', this._onBlur);
  }

  _shouldSwallow(code) {
    if (code === 'Space' || code === 'Tab') return true;
    return Object.values(MAP).some((codes) => codes.includes(code));
  }

  isDown(action) {
    const codes = MAP[action];
    if (!codes) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  // True on the frame the action was pressed, consuming the buffer.
  consume(action) {
    if (this.buffer.has(action)) {
      this.buffer.delete(action);
      return true;
    }
    return false;
  }

  // True if pressed within the buffer window, without consuming. Used by menus,
  // which need to peek rather than steal from gameplay.
  buffered(action) { return this.buffer.has(action); }

  clearBuffer() { this.buffer.clear(); }

  // Called once at the end of every frame, after gameplay has had its look.
  endFrame(dt) {
    this.pressed.clear();
    this._justPressedAny = false;
    for (const [action, t] of this.buffer) {
      const nt = t - dt;
      if (nt <= 0) this.buffer.delete(action);
      else this.buffer.set(action, nt);
    }
  }

  tookAnyKey() { return this._justPressedAny; }
}
