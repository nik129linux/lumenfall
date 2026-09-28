// Every tunable that is really a global lives here, so the look of the game can
// be retuned from one file instead of hunted across the codebase.

// The low-res render buffer. Everything is authored against this pixel grid and
// then upscaled in the post pass, so this constant is the single knob that
// decides how chunky the game looks. Changing it rescales the whole world
// because the orthographic camera derives its frustum from it.
export const LOW_RES_W = 480;
export const LOW_RES_H = 270;

// World units are low-res pixels: 1 unit == 1 buffer pixel. Keeps sprite cells,
// tilemaps, physics and the camera all on the same grid with no conversion.
export const PX = 1;

// Kael's collision box, in pixels. Narrower than the sprite so he slips through
// gaps he visually clears.
export const PLAYER_W = 14;
export const PLAYER_H = 30;

export const DASH_TIME = 0.20;      // seconds of dash
export const DASH_SPEED = 260;      // px/s
export const DASH_COOLDOWN = 1.0;   // seconds, per the design
// Coordinate convention: +y is UP, matching the orthographic camera, so
// gravity is negative. Getting this backwards once is how the whole level ends
// up rendered upside down with the player standing on the ceiling.
export const JUMP_VEL = 250;        // px/s, positive is up
export const JUMP_CUT = 0.45;       // fraction of jump kept when the key is released
export const GRAVITY = 720;         // px/s^2
export const MAX_FALL = 300;        // px/s, applied as a negative floor on vy
// Derived from the two numbers above, and load-bearing for level design:
// apex is JUMP_VEL^2 / 2*GRAVITY ~= 43px ~= 5.4 tiles, and a full jump covers
// ~9 tiles horizontally. No platform may sit more than ~5 tiles above whatever it
// is jumped from.
export const RUN_SPEED = 105;       // px/s
export const GROUND_ACCEL = 900;
export const AIR_ACCEL = 520;
export const GROUND_FRICTION = 1100;
export const AIR_FRICTION = 220;

export const ATTACK_TIME = 0.26;   // seconds
export const ATTACK_ACTIVE = 0.10; // seconds where the blade is live
export const ATTACK_REACH = 26;
export const ATTACK_DMG = 1;
export const IFRAMES_ON_HIT = 0.9;  // seconds

export const ROTATE_TIME = 0.6;     // seconds for the L2 level rotation

// Per-level look. Palettes sampled from the reference art:
//   1.png emerald shrine, 2.jpg purple/toxic, 3.jpg burnt-orange/black
export const LEVELS = [
  {
    id: 1,
    nameKey: 'level1',
    // L1 Shrine of Ember
    sky: [0x08130d, 0x0f2b1d, 0x164a30],
    fog: 0x16382a,
    accent: 0x54f0a8,
    light: 0x9fffc8,
    // Tile, platform, lip. These are what the player actually stands on, so they
    // are the values that decide whether the level is readable.
    tile: 0x2c4136,
    platform: 0x44654f,
    lip: 0x8fd9a0,
    // parallax layer tint + scroll multiplier
    layers: [
      { mult: 0.10, tint: 0x0c2018, y: 0.10 },
      { mult: 0.28, tint: 0x123024, y: 0.02 },
      { mult: 0.55, tint: 0x1a4430, y: 0.00 },
    ],
  },
  {
    id: 2,
    nameKey: 'level2',
    // L2 Rotting Reliquary
    sky: [0x120a1e, 0x241141, 0x3a1f5c],
    fog: 0x2a1a44,
    accent: 0xa86cf0,
    light: 0xd8a8ff,
    tile: 0x352a4c,
    platform: 0x503d6b,
    lip: 0xc9a6f0,
    layers: [
      { mult: 0.10, tint: 0x1a0f2b, y: 0.10 },
      { mult: 0.28, tint: 0x26163c, y: 0.02 },
      { mult: 0.55, tint: 0x331f52, y: 0.00 },
    ],
  },
  {
    id: 3,
    nameKey: 'level3',
    // L3 Lantern Wood
    sky: [0x170c04, 0x351905, 0x5a2d09],
    fog: 0x2e1a0a,
    accent: 0xff9a3c,
    light: 0xffb060,
    // Almost no ambient: the sword halo is the only light in L3.
    tile: 0x4a2c14,
    platform: 0x7a4a1e,
    lip: 0xffb060,
    layers: [
      { mult: 0.10, tint: 0x1d0f05, y: 0.10 },
      { mult: 0.28, tint: 0x2e180a, y: 0.02 },
      { mult: 0.55, tint: 0x42230c, y: 0.00 },
    ],
  },
];

// Difficulty scalar and the fairness caps. The adaptive model is allowed to move
// inside [1 - band, 1 + band] and is hard-clamped to never exceed 1.0, so a boss
// can read the player and get sharper without ever becoming unfair or harder
// than the difficulty the player actually chose.
export const DIFFICULTY = {
  easy:   { scalar: 0.78, band: 0.10, reaction: 0.34, nameKey: 'diffEasy' },
  normal: { scalar: 1.00, band: 0.16, reaction: 0.22, nameKey: 'diffNormal' },
  hard:   { scalar: 1.22, band: 0.20, reaction: 0.12, nameKey: 'diffHard' },
};

export const AI = {
  tickHz: 10,               // sense/decide/act cadence
  memory: 20,               // rolling window of player actions
  maxConcurrentAttackers: 1,
  minAttackGap: 0.8,        // seconds between committed attacks
  noAttackDuringIframes: true,
  // The Patient One: how far ahead it extrapolates the lantern-light path.
  predictHorizon: 0.45,
  predictMaxError: 0.22,    // caps how confident the prediction is allowed to be
};

export const CAM = {
  lookAhead: 26,
  lerp: 6.5,
  shakeDecay: 5.0,
};
