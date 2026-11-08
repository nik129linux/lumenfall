import * as THREE from '../vendor/three.module.js';
import { TILE, SOLID, PLATFORM, SPIKE, tileAt } from './physics.js';
import { LEVELS } from '../core/config.js';
import { paintGroup } from '../render/tilepaint.js';

// The level lives inside a THREE.Group that shares the world's axes. Nothing
// ever rotates it any more.
//
// A level is TWO maps of the same room, and `levelData.layer` says which one a
// tile belongs to: 0 in both, 1 only in world A, 2 only in world B. `grid` is
// the base map -- world A's -- and a cell it leaves empty but marks with a layer
// is a solid block of the world that layer names (the bridges over the holes).
// `levelData.world` picks the map the physics is reading; tileAt is the only
// place that decision is made, so every reader gets the same answer.

const BOSS_ARENA_W = 40;   // tiles

const RUNE_COLOR = 0x9be34a;  // the rune on the ground says toxic, like world B

const SHIFT_CD = 0.5;         // seconds between two player shifts
const SHIFT_LIFT_STEPS = 64;  // safety bound on the forced shift's lift-out

function blankLevel(id, width, height) {
  return {
    id,
    width,
    height,
    grid: new Uint8Array(width * height),
    layer: new Uint8Array(width * height),
    world: 0,                  // 0 = world A, 1 = world B
    entities: [],
    decor: [],
    groundY: (height - 4) * TILE,
  };
}

const set = (lv, tx, ty, v = SOLID) => {
  if (tx < 0 || tx >= lv.width || ty < 0 || ty >= lv.height) return;
  lv.grid[ty * lv.width + tx] = v;
};
const fill = (lv, tx, ty, tw, th, v = SOLID) => {
  for (let y = ty; y < ty + th; y++) for (let x = tx; x < tx + tw; x++) set(lv, x, y, v);
};
// Marks a rectangle as belonging to one world only, without touching the base
// map: `v` is the type the cell has in that world, and leaving it out means a
// solid block.
const markLayer = (lv, tx, ty, tw, th, layer, v) => {
  for (let y = ty; y < ty + th; y++) {
    for (let x = tx; x < tx + tw; x++) {
      if (x < 0 || x >= lv.width || y < 0 || y >= lv.height) continue;
      lv.layer[y * lv.width + x] = layer;
      if (v !== undefined) lv.grid[y * lv.width + x] = v;
    }
  }
};
// Layer-only tag: sets the world membership without touching the grid type.
// Bridges (grid 0 + layer 2) and one-world platforms (grid PLATFORM + layer)
// both need this, so the grid keeps the type `fill` already wrote.


// +y is up, so the ground occupies the *lowest* rows (ty 0..3) and the level's
// height is mostly headroom. GROUND is the surface the player stands on.
const GROUND = 3;

// Ground with a hole punched in it. The holes are the shift puzzle: they are
// deliberately wider than a jump (~9 tiles) and empty in world A, and world B
// lays a bridge across each of them.
function ground(lv, holes = []) {
  fill(lv, 0, 0, lv.width, GROUND + 1);
  // Kept on the level so the bottomless void can be drawn under each hole.
  lv.holes = holes;
  // Per-column flag so the physics knows which columns have no floor under
  // them. Without it a body falls into a hole, lands on the phantom solid that
  // tileAt reports below row 0, and stands there at y=0 -- which is exactly the
  // "Kael just stands in the pit" this stage is about.
  lv.holeCol = new Uint8Array(lv.width);
  for (const [hx, hw] of holes) {
    fill(lv, hx, 0, hw, 8, 0);
    for (let x = hx; x < hx + hw; x++) lv.holeCol[x] = 1;
  }
}

const plat = (lv, tx, ty, tw) => fill(lv, tx, ty, tw, 1, PLATFORM);
const block = (lv, tx, ty, tw, th) => fill(lv, tx, ty, tw, th);
// A standing wall that only exists in world A: solid in A, gone in B, so the
// way through is clear in the world the player is not standing in.
const wallA = (lv, tx, ty, tw, th) => { fill(lv, tx, ty, tw, th); markLayer(lv, tx, ty, tw, th, 1); };
// A ledge that only exists in world B. It is a PLATFORM tile in the base map
// marked with layer 2, so the map never has a hole where a world-A player would
// otherwise be standing on thin air.
const platB = (lv, tx, ty, tw) => { fill(lv, tx, ty, tw, 1, PLATFORM); markLayer(lv, tx, ty, tw, 1, 2); };
const platA = (lv, tx, ty, tw) => { fill(lv, tx, ty, tw, 1, PLATFORM); markLayer(lv, tx, ty, tw, 1, 1); };
// A world-B ledge with the world-A cap one tile above it. The pair reads as one
// slab that drops a tile when the world shifts, and it keeps the B ledge exactly
// one tile under the A one, so each world has a surface of its own at the same
// spot.
const ledgePair = (lv, tx, tyB, tw) => { platB(lv, tx, tyB, tw); platA(lv, tx, tyB + 1, tw); };

const FLOOR_Y = (GROUND + 1) * TILE;   // standing surface, in pixels
const VOID_H = 240;                   // depth of the black under a pit
const RUNE_LEAD = 3;                   // tiles before a hole the rune is drawn
const at = (ty) => ty * TILE + TILE;   // top face of a platform row, in pixels

// Background colonnades (js/render/tilepaint's sibling, Level._buildProps). Each one is
// COLONNADE_TILES wide and stands on the floor behind everything; they never collide.
// They go wherever the floor is unbroken for their whole width, with a margin around the
// holes, every COLONNADE_GAP tiles, and never in the boss arena (the telegraphs must read
// against a plain backdrop). Deterministic: the same level always gets the same ones.
const COLONNADE_TILES = 19;   // 152 px, from tools/build-tiles.py
const COLONNADE_GAP = 30;
function placeColonnades(lv) {
  const arenaStart = lv.width - BOSS_ARENA_W - 2;
  let last = -1e9;
  for (let tx = 6; tx + COLONNADE_TILES < arenaStart; tx++) {
    if (tx - last < COLONNADE_GAP) continue;
    let clear = true;
    for (let x = tx - 2; x < tx + COLONNADE_TILES + 2 && clear; x++) if (lv.holeCol && lv.holeCol[x]) clear = false;
    if (!clear) continue;
    lv.decor.push({ kind: 'colonnade', x: tx * TILE });
    last = tx;
  }
}

// The elder waits at x=30. Stage 2 wants that spot to be a safe place to stop
// and talk, so the requirements are asserted here rather than eyeballed: this
// is a level-layout contract, and a later platform dropped over his head would
// silently break the opening.
const ELDER_TX = 30;
const ELDER_CLEAR_TILES = 8;      // flat ground each side
const ELDER_MIN_HEADROOM = 6;     // no platform lower than 6 tiles over him
const ELDER_NO_ENEMY_TILES = 20;   // no spawn or patrol inside this radius

// Returns the reason the elder's spot is unusable, or null if it is fine.
function elderSpotProblem(lv) {
  const solid = (tx, ty) => {
    if (tx < 0 || tx >= lv.width || ty < 0 || ty >= lv.height) return SOLID;
    return lv.grid[ty * lv.width + tx];
  };
  const occupied = (tx, ty) => solid(tx, ty) === SOLID || solid(tx, ty) === PLATFORM;

  // Flat ground for at least 8 tiles each way.
  for (let d = 0; d <= ELDER_CLEAR_TILES; d++) {
    for (const tx of [ELDER_TX - d, ELDER_TX + d]) {
      if (occupied(tx, GROUND + 1)) return `ground blocked at x=${tx}`;
    }
  }
  // Nothing low enough overhead to clip his head or read as a step over him.
  for (let ty = GROUND + 1; ty <= GROUND + ELDER_MIN_HEADROOM; ty++) {
    if (occupied(ELDER_TX, ty)) return `tile at x=${ELDER_TX} ty=${ty} is within ${ELDER_MIN_HEADROOM} tiles overhead`;
  }
  // No enemy spawn or patrol range nearby. `patrol` is in tiles, and it is the
  // whole stretch it can wander, not a radius around the spawn.
  for (const e of lv.entities) {
    if (e.type !== 'wisp' && e.type !== 'crawler' && e.type !== 'spitter') continue;
    const tx = Math.floor(e.x / TILE);
    const lo = e.patrol ? Math.min(...e.patrol) : tx;
    const hi = e.patrol ? Math.max(...e.patrol) : tx;
    const near = hi >= ELDER_TX - ELDER_NO_ENEMY_TILES && lo <= ELDER_TX + ELDER_NO_ENEMY_TILES;
    if (near) return `${e.type} roaming tiles ${lo}..${hi} is within ${ELDER_NO_ENEMY_TILES} tiles of x=${ELDER_TX}`;
  }
  return null;
}

export const LEVEL_DEFS = [
  // ------------------------------------------------------------------ L1
  () => {
    const W = 190, H = 34;
    const lv = blankLevel(1, W, H);
    ground(lv, [[62, 12], [104, 13]]);

    // Opening: flat and forgiving, so the controls can be learned before the
    // level asks for anything.
    plat(lv, 12, 8, 6);
    plat(lv, 24, 9, 5);
    plat(lv, 34, 8, 5);
    plat(lv, 44, 9, 6);

    // Approach to the first gap. The high route skips most of it.
    plat(lv, 54, 10, 6);
    plat(lv, 66, 11, 6);
    plat(lv, 74, 15, 4);

    // Mid shrine: stepped terraces.
    plat(lv, 84, 8, 7);
    plat(lv, 92, 10, 5);
    plat(lv, 98, 12, 5);

    // Second gap.
    plat(lv, 108, 9, 6);
    plat(lv, 118, 9, 6);
    plat(lv, 128, 8, 6);

    // Terraces up to the arena.
    plat(lv, 138, 10, 6);
    plat(lv, 146, 12, 5);
    plat(lv, 154, 9, 6);

    lv.entities.push(
      { type: 'shard', x: 14 * TILE, y: at(8) },
      { type: 'shard', x: 26 * TILE, y: at(9) },
      { type: 'shard', x: 68 * TILE, y: at(11) },
      { type: 'shard', x: 86 * TILE, y: at(8) },
      { type: 'shard', x: 100 * TILE, y: at(12) },
      { type: 'shard', x: 120 * TILE, y: at(9) + 2 * TILE },
      { type: 'shard', x: 140 * TILE, y: at(10) },
      { type: 'shard', x: 156 * TILE, y: at(9) },
      { type: 'elder', x: ELDER_TX * TILE, y: FLOOR_Y, face: -1 },
      { type: 'wisp', x: 64 * TILE, y: FLOOR_Y + 40, patrol: [60, 78] },
      { type: 'wisp', x: 100 * TILE, y: FLOOR_Y + 40, patrol: [96, 112] },
      { type: 'crawler', x: 132 * TILE, y: FLOOR_Y, patrol: [126, 152] },
      { type: 'crawler', x: 152 * TILE, y: FLOOR_Y, patrol: [146, 164] },
      { type: 'boss', boss: 'statue', x: (W - 20) * TILE, y: FLOOR_Y },
    );

    // The whole opening depends on the elder being approachable, so a layout
    // change that walls him in, drops a platform on his head or parks an enemy
    // next to him fails here instead of shipping.
    const problem = elderSpotProblem(lv);
    if (problem) throw new Error(`L1 elder spot at x=${ELDER_TX} unusable: ${problem}`);
    placeColonnades(lv);
    return lv;
  },

  // ------------------------------------------------------------------ L2
  () => {
    const W = 170, H = 36;
    const lv = blankLevel(2, W, H);
    // Three bottomless gaps, far wider than a jump, and standing walls. This is
    // the level the mechanic is for: in world A the gaps are pits and the walls
    // are in the way, in world B every gap has a bridge and every wall is gone.
    const HOLES = [[40, 14], [68, 16], [102, 15]];
    ground(lv, HOLES);

    // The bridges. A whole tile row of world B across each hole, marked in the
    // layer array and left out of the base map, so world A still sees straight
    // down the hole and world B walks over it. Standing on a bridge and shifting
    // back drops you in: the shift is only refused when the body would end up
    // inside solid, and a hole is not solid in either world.
    for (const [hx, hw] of HOLES) markLayer(lv, hx, GROUND, hw, 1, 2);

    plat(lv, 10, 8, 5);
    plat(lv, 20, 10, 5);
    // World-A ledges near the shards, and the world-B ledge under each of them.
    // The pair at 16 is the same slab in both worlds, one tile apart.
    ledgePair(lv, 16, 7, 3);
    platA(lv, 25, 7, 2);
    // A standing wall, world A only: harmless seen from above in A, and simply
    // not there in B. The step in front of the column at 30 stays in both worlds,
    // which is what keeps the column climbable: ground 32 -> 72 -> top at 112.
    plat(lv, 26, 8, 3);
    wallA(lv, 30, 4, 3, 10);
    plat(lv, 36, 8, 4);

    plat(lv, 58, 7, 5);
    wallA(lv, 62, 4, 3, 9);
    // Two steps for the column at 82: 72, then 88, then its top at 128. Each
    // rise is 40, 16 and 40 -- the direct 80 -> 128 was 48, over the rule.
    plat(lv, 72, 8, 6);
    plat(lv, 78, 10, 4);
    wallA(lv, 82, 5, 4, 11);
    ledgePair(lv, 65, 7, 3);
    ledgePair(lv, 87, 7, 3);
    platA(lv, 92, 7, 3);

    plat(lv, 96, 8, 6);
    plat(lv, 118, 8, 3);
    wallA(lv, 122, 4, 3, 10);
    plat(lv, 126, 9, 5);
    plat(lv, 136, 11, 6);
    // 72 then 88 then the top at 120; 72 -> 120 alone is 48.
    plat(lv, 142, 8, 2);
    plat(lv, 144, 10, 2);
    wallA(lv, 146, 5, 3, 10);

    // ---- the boss arena (the last 40 tiles). Its floor row is left as layer 0,
    // so a forced shift never drops Ul Burjo's victim off the edge: only the
    // ledges above change, which is enough to move the fight around.
    ledgePair(lv, 132, 7, 3);
    ledgePair(lv, 155, 7, 3);
    ledgePair(lv, 163, 7, 3);
    platA(lv, 150, 8, 3);
    platA(lv, 160, 9, 3);

    lv.entities.push(
      { type: 'shard', x: 12 * TILE, y: at(8) },
      { type: 'shard', x: 22 * TILE, y: at(10) },
      { type: 'shard', x: 60 * TILE, y: at(7) },
      { type: 'shard', x: 74 * TILE, y: at(8) },
      { type: 'shard', x: 98 * TILE, y: at(8) },
      { type: 'shard', x: 128 * TILE, y: at(9) },
      { type: 'shard', x: 138 * TILE, y: at(11) },
      { type: 'wisp', x: 52 * TILE, y: FLOOR_Y + 40, patrol: [48, 62] },
      { type: 'spitter', x: 92 * TILE, y: FLOOR_Y, patrol: [88, 100] },
      { type: 'spitter', x: 130 * TILE, y: FLOOR_Y, patrol: [124, 144] },
      { type: 'crawler', x: 156 * TILE, y: FLOOR_Y, patrol: [150, 164] },
      { type: 'boss', boss: 'ulburjo', x: (W - 20) * TILE, y: FLOOR_Y },
    );
    placeColonnades(lv);
    return lv;
  },

  // ------------------------------------------------------------------ L3
  () => {
    const W = 180, H = 38;
    const lv = blankLevel(3, W, H);
    ground(lv, [[52, 13], [98, 14]]);

    // Mostly vertical: the halo's radius is small, so this is a ladder of
    // landings rather than a corridor. Steps stay within the ~5 tile jump arc.
    plat(lv, 10, 8, 5);
    plat(lv, 18, 11, 5);
    plat(lv, 26, 14, 4);
    plat(lv, 34, 17, 5);
    block(lv, 44, 4, 3, 18);

    // Bridges the hole at 52..64. Without a landing inside the gap, the far side
    // is 13 tiles from the last ground you can stand on.
    plat(lv, 54, 8, 6);
    plat(lv, 66, 8, 5);
    plat(lv, 74, 11, 4);
    plat(lv, 82, 14, 5);
    block(lv, 92, 4, 3, 16);

    // And this one bridges the hole at 98..111.
    plat(lv, 100, 8, 6);
    plat(lv, 114, 8, 6);
    plat(lv, 124, 11, 5);
    plat(lv, 132, 14, 4);
    // The block's top is 176, which is 56px above the landing below it -- over
    // the 48px rule. This is the step that makes it reachable.
    plat(lv, 136, 17, 3);
    block(lv, 140, 4, 3, 18);
    plat(lv, 150, 11, 5);
    plat(lv, 160, 8, 6);

    lv.entities.push(
      { type: 'shard', x: 12 * TILE, y: at(8) },
      { type: 'shard', x: 20 * TILE, y: at(11) },
      { type: 'shard', x: 36 * TILE, y: at(17) },
      { type: 'shard', x: 68 * TILE, y: at(8) },
      { type: 'shard', x: 84 * TILE, y: at(14) },
      { type: 'shard', x: 116 * TILE, y: at(8) },
      { type: 'shard', x: 134 * TILE, y: at(14) },
      { type: 'shard', x: 152 * TILE, y: at(11) },
      { type: 'wisp', x: 60 * TILE, y: FLOOR_Y + 40, patrol: [56, 72] },
      // On the floor just past the hole at 98..111, guarding the landing. It used
      // to spawn at tile 104, inside the hole, and fell out on its first frame.
      { type: 'crawler', x: 122 * TILE, y: FLOOR_Y, patrol: [114, 136] },
      { type: 'spitter', x: 146 * TILE, y: FLOOR_Y, patrol: [142, 162] },
      { type: 'spitter', x: 172 * TILE, y: FLOOR_Y, patrol: [166, 176] },
      { type: 'boss', boss: 'patientone', x: (W - 20) * TILE, y: FLOOR_Y },
    );
    placeColonnades(lv);
    return lv;
  },
];

export class Level {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tilesGroup = new THREE.Group();
    this.group.add(this.tilesGroup);
    this.data = null;
    this.world = 0;            // 0 = world A, 1 = world B
    this.shiftCount = 0;       // shifts so far, this level
    this.shiftCd = 0;          // seconds of cooldown left
    this.shiftRefused = false; // the last player shift was refused by the map
    this.layerMeshes = [];     // meshes per layer group, toggled on a shift
    this.art = null;           // the level tilesheets, set by main.js before the first load
    // The player, set by main.js. shiftWorld reads its body to decide whether a
    // shift is legal, so the level owns no copy of the player state.
    this.player = null;
  }

  load(index) {
    this.dispose();
    this.data = LEVEL_DEFS[index]();
    this.world = 0;
    this.data.world = 0;
    this.shiftCount = 0;
    this.shiftCd = 0;
    this.shiftRefused = false;
    this.group.rotation.z = 0;
    this.group.position.set(0, 0, 0);
    this.group.updateMatrixWorld(true);
    this._buildTiles();
    return this.data;
  }

  // Only the Reliquary has two maps. L1 and L3 have an all-zero layer array, so
  // they would shift to a map identical to the one they are in: there is nothing
  // to toggle and nothing to learn.
  get canShift() { return !!this.data && this.data.id === 2; }

  // Ticked from the game loop; `shiftCd` is the only timed state the level has.
  update(dt) { this.shiftCd = Math.max(0, this.shiftCd - dt); }

  // ---- the shift
  //
  // Returns true when the world actually changed. The player's own press is
  // refused when the cooldown is still running or when the body would end up
  // inside a solid tile of the destination world; the boss's shift is forced,
  // because an attack cannot be cancelled by the map, and resolves the overlap
  // by lifting the body instead.
  shiftWorld(opts = {}) {
    const d = this.data;
    if (!d || !this.canShift) return false;
    const force = opts.force === true;
    this.shiftRefused = false;
    if (!force && this.shiftCd > 0) return false;

    const next = this.world ^ 1;
    const blocked = force ? false : this._bodyInSolid(next);
    if (blocked) {
      this.shiftRefused = true;
      return false;
    }

    this.world = next;
    d.world = next;
    this.shiftCount++;
    this.shiftCd = SHIFT_CD;
    this._applyWorld();
    if (force) this._liftBodyOut();
    return true;
  }

  // Would this body be inside a solid tile of `world`? Only solid counts: a
  // one-way platform the body is passing through is not something to refuse a
  // shift over.
  _bodyInSolid(world) {
    const body = this.player?.body;
    if (!body) return false;
    const d = this.data;
    const x0 = Math.floor(body.left / TILE);
    const x1 = Math.floor((body.right - 0.001) / TILE);
    const y0 = Math.floor(body.bottom / TILE);
    const y1 = Math.floor((body.top - 0.001) / TILE);
    if (y0 < 0 || y1 >= d.height) return false;
    const was = d.world;
    d.world = world;
    let hit = false;
    for (let ty = y0; ty <= y1 && !hit; ty++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(d.width - 1, x1); tx++) {
        if (tileAt(d, tx, ty) === SOLID) { hit = true; break; }
      }
    }
    d.world = was;
    return hit;
  }

  // A forced shift that lands inside the new map lifts the player a tile at a
  // time until they fit. The arena floor is common to both worlds, so this
  // always terminates; the bound is there so a bad layout cannot hang the game.
  _liftBodyOut() {
    const body = this.player?.body;
    if (!body) return;
    for (let i = 0; i < SHIFT_LIFT_STEPS && this._bodyInSolid(this.world); i++) {
      body.y += TILE;
      if (body.vy < 0) body.vy = 0;
    }
    body.vx = 0;
  }

  // ---- coordinate conversion
  localToWorld(v, out) {
    const target = out || new THREE.Vector3();
    target.set(v.x, v.y, 0);
    return this.group.localToWorld(target);
  }

  worldToLocal(v, out) {
    const target = out || new THREE.Vector3();
    target.copy(v);
    return this.group.worldToLocal(target);
  }

  // ---- geometry
  _buildTiles() {
    const d = this.data;
    if (!this.art) throw new Error('level art not loaded');
    // Three groups of tiles: the ones in both worlds, the ones only in world A and
    // the ones only in world B. Each is painted once onto its own canvas and shown
    // as one textured plane, so a world change just toggles two planes.
    const groups = [
      { solids: [], plats: [], spikes: [] }, { solids: [], plats: [], spikes: [] }, { solids: [], plats: [], spikes: [] },
    ];
    for (let ty = 0; ty < d.height; ty++) {
      for (let tx = 0; tx < d.width; tx++) {
        const i = ty * d.width + tx;
        const layer = d.layer[i];
        const v = d.grid[i] || (layer ? SOLID : 0);   // a world-only cell the base map leaves empty is solid there
        if (!v) continue;
        const g = groups[layer] || groups[0];
        if (v === SOLID) g.solids.push([tx, ty]);
        else if (v === PLATFORM) g.plats.push([tx, ty]);
        else if (v === SPIKE) g.spikes.push([tx, ty]);
      }
    }
    const key = ([x, y]) => `${x},${y}`;
    const commonCells = new Set([...groups[0].solids, ...groups[0].plats].map(key));   // spikes are not footing

    this.layerMeshes = [];
    const W = d.width * TILE, H = d.height * TILE;
    for (let g = 0; g < 3; g++) {
      const list = groups[g];
      // What is solid in the world this group lives in: itself plus the common tiles.
      const occupied = g === 0 ? commonCells
        : new Set([...commonCells, ...list.solids.map(key), ...list.plats.map(key)]);
      const made = [];
      if (list.solids.length || list.plats.length || list.spikes.length) {
        const canvas = paintGroup({
          art: this.art, level: d.id, width: d.width, height: d.height,
          solids: list.solids, plats: list.plats, spikes: list.spikes,
          occupied, group: g,
        });
        made.push(this._plane(canvas, W, H, 1));
      }
      this.layerMeshes.push(made);
    }
    this._buildProps();
    this._buildVoid();
    this._buildRunes();
    this._applyWorld();
  }

  // The background colonnades of data.decor, drawn behind the tiles. Dimmed a little so
  // they sit further back than anything you can stand on.
  _buildProps() {
    const art = this.art;
    for (const def of this.data.decor) {
      const prop = art.props[`${def.kind}_l${this.data.id}`];
      if (!prop) continue;
      const tex = new THREE.Texture(prop.img);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(prop.w, prop.h),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, color: 0xb4b4bc }));
      // The image carries one transparent row under the plinth: the plinth rests on the floor.
      mesh.position.set(def.x + prop.w / 2, FLOOR_Y - 1 + prop.h / 2, -1);
      mesh.renderOrder = -5;
      mesh.frustumCulled = false;
      this.tilesGroup.add(mesh);
    }
  }

  // A canvas shown 1:1 as a textured plane covering the whole level. Nearest
  // filtering and no mipmaps: the canvas is already at buffer resolution.
  _plane(canvas, w, h, order) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    mesh.position.set(w / 2, h / 2, 0);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    this.tilesGroup.add(mesh);
    return mesh;
  }

  // Only the two world-only groups change visibility; the common tiles and the
  // geometry behind them never move.
  _applyWorld() {
    for (const m of this.layerMeshes[1] || []) m.visible = this.world === 0;
    for (const m of this.layerMeshes[2] || []) m.visible = this.world === 1;
  }

  // A rune on the ground three tiles before each shift hole, toxic green.
  // The holes are the one thing in the game with no visual tell that they are
  // meant to be crossed by shifting worlds, so something has to say so at the
  // player's feet. Pulses in updateRunes.
  _buildRunes() {
    this.runes = [];
    const holes = this.data.holes || [];
    if (!this.canShift || !holes.length) return;
    const mat = new THREE.MeshBasicMaterial({
      color: RUNE_COLOR, transparent: true, opacity: 0.85,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.runeMat = mat;
    for (const [hx] of holes) {
      const tx = hx - RUNE_LEAD;
      if (tx < 0) continue;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(TILE * 1.6, TILE * 1.6), mat);
      mesh.position.set(tx * TILE + TILE / 2, FLOOR_Y + 1, 1);
      mesh.renderOrder = 3;
      mesh.frustumCulled = false;
      this.tilesGroup.add(mesh);
      this.runes.push(mesh);
    }
  }

  // Sine pulse, so the runes breathe rather than blink. One shared material, so
  // they beat together.
  updateRunes(t) {
    if (!this.runeMat) return;
    this.runeMat.opacity = 0.25 + 0.6 * (0.55 + 0.45 * Math.sin(t * 3.4));
  }

  // The bottom of a pit. Nothing is drawn below the floor line inside a hole,
  // so without this the parallax backdrop shows through and the pit reads as a
  // painted floor you could land on -- which is exactly what it must not do.
  // renderOrder 0 puts it after the mid trunks (-10) and before the tiles (1),
  // and transparent so it lands in the same pass as everything else that sorts
  // by hand.
  _buildVoid() {
    const holes = this.data.holes || [];
    if (!holes.length) return;
    const mat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 1, depthTest: false, depthWrite: false,
    });
    for (const [hx, hw] of holes) {
      const w = hw * TILE;
      const geo = new THREE.PlaneGeometry(w, VOID_H);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(hx * TILE + w / 2, FLOOR_Y - VOID_H / 2, -1);
      mesh.renderOrder = 0;
      mesh.frustumCulled = false;
      this.tilesGroup.add(mesh);
    }
  }

  dispose() {
    for (let i = this.tilesGroup.children.length - 1; i >= 0; i--) {
      const c = this.tilesGroup.children[i];
      c.geometry?.dispose();
      c.material?.map?.dispose();
      c.material?.dispose();
      this.tilesGroup.remove(c);
    }
  }

  get worldWidth() { return this.data ? this.data.width * TILE : 0; }
  get worldHeight() { return this.data ? this.data.height * TILE : 0; }
}

export { LEVELS, BOSS_ARENA_W };
