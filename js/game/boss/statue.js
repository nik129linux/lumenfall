import { Boss } from './base.js';
import { audio } from '../../core/audio.js';

// L1 boss: the Marble Mummy. One phase, deliberately.
//
// It is the tutorial boss, so it teaches the three things the rest of the game
// asks for -- that attacks have a wind-up, that the dash goes through them, and
// that standing still loses. The adaptive model is active on it, but its weight
// table is flat enough that adaptation sharpens its timing rather than
// unlocking anything new.

const WEIGHTS = {
  chase: 1.0,
  swing: 1.0,
  slam: 0.7,
  idle: 0.6,
  swing_hold: 0.75,
  slam_hold: 0.9,
};

export class Statue extends Boss {
  constructor(opts) {
    super({
      ...opts,
      nameKey: 'bossStatue',
      w: 26, h: 46,
      hp: 12,
      phases: 1,
      contactDmg: 1,
    });
    this.body.x = opts.x;
    this.body.y = opts.y;
    this.homeX = opts.x;
    this.swingTimer = 0;
  }

  wake() {
    if (this.state !== 'sleep') return;
    this.state = 'idle';
    audio.sfxBoss();
  }

  update(dt, player, level) {
    if (this.state === 'sleep') { this.updateCommon(dt, player, level); return; }
    this.updateCommon(dt, player, level);
    if (this.dead) return;

    const action = this.think(dt, player, level, WEIGHTS);
    const dx = player.cx - this.cx;
    this.facing = dx >= 0 ? 1 : -1;
    this.swingTimer -= dt;

    if (this.state === 'phase') {
      this.body.vx = 0;
    } else {
      this._act(dt, action, player, dx);
    }

    this.integrate(dt, level);
    this._animate(dt, action);
  }

  _act(dt, action, player, dx) {
    const speed = 26 + this.phase * 4;
    switch (action) {
      case 'chase':
        this.body.vx = Math.sign(dx) * speed;
        break;
      case 'swing':
        // The lunge is the damage. The fairness gate already guaranteed the
        // player is not invulnerable and that enough time has passed.
        this.body.vx = this.facing * speed * 1.9;
        if (this.swingTimer <= 0) {
          this.swingTimer = 0.9;
          this._swing(player);
        }
        break;
      case 'slam':
        this.body.vx = 0;
        if (this.swingTimer <= 0) {
          this.swingTimer = 1.3;
          this._slam();
        }
        break;
      default:
        this.body.vx *= 0.9;
    }
  }

  _swing(player) {
    audio.sfxSlash();
    this.fx.slashArc(this.cx + this.facing * 12, this.body.bottom + 24, this.facing, 0xbfe8d0);
    const r = this.hurtRect();
    if (!player.dead && !player.isInvulnerable &&
        player.body.left < r.right && player.body.right > r.left &&
        player.body.bottom < r.top && player.body.top > r.bottom) {
      player.hurt();
    }
  }

  _slam() {
    audio.sfxHit();
    this.fx.burst(this.cx, this.body.bottom, 0x8fbfa0, 14, 90);
    this.fx.dust(this.cx, this.body.bottom);
  }

  _animate(dt, action) {
    if (this.dead) { this.sprite.update(dt); return; }
    this.sprite.setFacing(this.facing);
    if (this.state === 'phase') this.sprite.play('roots', { speed: 6 });
    else if (action === 'swing' || action === 'slam') this.sprite.play('sweep', { speed: 6 });
    else if (Math.abs(this.body.vx) > 4) this.sprite.play('walk', { speed: 5 });
    else this.sprite.play('idle', { speed: 3 });
    this.sprite.update(dt);
  }
}
