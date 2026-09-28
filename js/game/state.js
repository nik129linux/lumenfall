// The game's state machine.
//
//   menu -> cutscene -> play -> boss -> cutscene -> ... -> ending
//
// Kept as a tiny explicit FSM rather than a bag of booleans, because the
// interesting transitions here are the ones that must NOT happen: you cannot
// jump from `menu` straight into `boss`, and a death during a rotation has to
// unwind cleanly rather than leaving the level turned.

export const S = {
  BOOT: 'boot',
  MENU: 'menu',
  CUTSCENE: 'cutscene',
  PLAY: 'play',
  BOSS: 'boss',
  DEAD: 'dead',
  PAUSED: 'paused',
  ENDING: 'ending',
};

// Which states each one may go to. Anything absent here is rejected.
const ALLOWED = {
  [S.BOOT]:     [S.MENU],
  [S.MENU]:     [S.CUTSCENE, S.PLAY],
  [S.CUTSCENE]: [S.PLAY, S.MENU, S.ENDING],
  [S.PLAY]:     [S.BOSS, S.CUTSCENE, S.DEAD, S.PAUSED, S.ENDING, S.MENU],
  [S.BOSS]:     [S.CUTSCENE, S.DEAD, S.PAUSED, S.ENDING, S.PLAY, S.MENU],
  [S.DEAD]:     [S.PLAY, S.MENU],
  [S.PAUSED]:   [S.PLAY, S.BOSS, S.MENU],
  [S.ENDING]:   [S.MENU],
};

export class Machine {
  constructor(initial = S.BOOT) {
    this.state = initial;
    this.prev = null;
    this.time = 0;
    this.onChange = null;
  }

  can(next) { return (ALLOWED[this.state] || []).includes(next); }

  to(next) {
    if (next === this.state) return true;
    if (!this.can(next)) {
      console.warn(`[state] refused ${this.state} -> ${next}`);
      return false;
    }
    this.prev = this.state;
    this.state = next;
    this.time = 0;
    this.onChange?.(this.prev, next);
    return true;
  }

  is(...states) { return states.includes(this.state); }

  tick(dt) { this.time += dt; }
}
