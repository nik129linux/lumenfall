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
export const JUMP_VEL = 305;        // px/s, positive is up
export const JUMP_CUT = 0.45;       // fraction of jump kept when the key is released
export const GRAVITY = 720;         // px/s^2
export const MAX_FALL = 300;        // px/s, applied as a negative floor on vy
// Derived from the two numbers above, and load-bearing for level design:
// apex is JUMP_VEL^2 / 2*GRAVITY ~= 64.6px ~= 8 tiles, and a full jump covers
// ~9 tiles horizontally. Level layouts are held to a stricter rule than the
// apex: no surface more than 48px (6 tiles) above the one it is jumped from, and
// no horizontal gap over 7 tiles. tools/reach.mjs proves both on every level.
// At JUMP_VEL 250 the apex was 43px, which was under the 48px rule, so the rule
// was unsatisfiable and platforms were decoration.
export const RUN_SPEED = 105;       // px/s
export const GROUND_ACCEL = 900;
export const AIR_ACCEL = 520;
export const GROUND_FRICTION = 1100;
export const AIR_FRICTION = 220;

export const ATTACK_TIME = 0.26;   // seconds
// The attack clip is 3 frames at 11 fps: frame 0 (0 - 0.09 s) is the wind-up
// pose with the blade still at Kael's side, frames 1 and 2 (0.09 - 0.27 s) are
// the swing. The live window starts when frame 1 does and covers the frame that
// shows the blade fully out, so damage lands while the blade is visibly there.
export const ATTACK_WINDUP = 0.09; // seconds before the blade is live
export const ATTACK_ACTIVE = 0.11; // seconds where the blade is live
// Measured from assets/atlases/kael.png: the drawn blade tip reaches 10.5, 16.5
// and 17.5 px from the sprite centre in the three attack frames. 22 covers the
// tip with a few pixels of tolerance; it used to be 26 from 5 px off-centre
// (31 px out), which hit things the blade visibly did not reach.
export const ATTACK_REACH = 22;
export const ATTACK_DMG = 1;
export const IFRAMES_ON_HIT = 0.9;  // seconds

// Impact feel. Hitstop freezes the simulation for a few frames on a hit, and the
// screen shakes: together they are what makes a blade read as heavy.
export const HITSTOP = { enemy: 0.05, boss: 0.07, bossKill: 0.16, playerHurt: 0.10 };  // seconds
export const SHAKE = { enemy: 2, boss: 3.5, bossKill: 6, playerHurt: 6 };            // px amplitude
export const ENEMY_STAGGER = 0.18;   // seconds an enemy loses control after a hit
export const ENEMY_KNOCKBACK = 90;   // px/s pushed away from the blade

// The standing surface, in world pixels. The ground occupies the lowest tile
// rows, so its top face is (GROUND + 1) * TILE = 4 * 8. Lives here because the
// pit-death test needs it in the player's update, not just in the level builder.
export const FLOOR_Y = 32;

// Below this, a body is entirely under the floor line and has fallen out of the
// world. Eight pixels of grace so a body brushing the lip does not count.
export const PIT_DEATH_Y = FLOOR_Y - 8;

export const ROTATE_TIME = 0.6;     // seconds for the L2 level rotation

// Per-level look. Palettes sampled from the reference art:
//   1.png emerald shrine, 2.jpg purple/toxic, 3.jpg burnt-orange/black
export const LEVELS = [
  {
    id: 1,
    nameKey: 'level1',
    // Level width in tiles. Read by the parallax layer to turn cameraX into a
    // 0..1 scroll progress without main.js having to pass it through.
    width: 190,
    // L1 Shrine of Ember
    sky: [0x030806, 0x061209, 0x08190f],
    accent: 0x54f0a8,
    light: 0x9fffc8,
    // Platforms are near-black with a 1-2px accent top edge. The previous
    // mid-green body read as a grey slab and fought the background for attention.
    tile: 0x0b0f0e,
    platform: 0x0b0f0e,
    lip: 0x4fd18b,
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
    width: 170,
    // L2 Rotting Reliquary
    sky: [0x070512, 0x0d0718, 0x140c22],
    accent: 0xa86cf0,
    light: 0xd8a8ff,
    // Same rule as L1/L3: near-black body, accent only on the 1-2px top lip.
    // The solid #7a3fa0 this replaced was a bright slab that outshone Kael and
    // read as a foreground object rather than something to stand on.
    tile: 0x1a0f22,
    platform: 0x1a0f22,
    lip: 0x9be34a,
    layers: [
      { mult: 0.10, tint: 0x1a0f2b, y: 0.10 },
      { mult: 0.28, tint: 0x26163c, y: 0.02 },
      { mult: 0.55, tint: 0x331f52, y: 0.00 },
    ],
  },
  {
    id: 3,
    nameKey: 'level3',
    width: 180,
    // L3 Lantern Wood
    sky: [0x0a0502, 0x140a04, 0x1e1006],
    accent: 0xff9a3c,
    light: 0xffb060,
    // Almost no ambient: the sword halo is the only light in L3.
    tile: 0x1a0f06,
    platform: 0x1a0f06,
    lip: 0xe0772e,
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

// Google Analytics measurement id, e.g. 'G-XXXXXXXXXX'. Empty on purpose: the
// team drops the real id in here, and until then nothing is sent anywhere.
export const GA_MEASUREMENT_ID = '';
