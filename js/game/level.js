import * as THREE from '../vendor/three.module.js';
import { TILE, SOLID, PLATFORM, SPIKE, tileAt } from './physics.js';
import { ROTATE_TIME, LEVELS } from '../core/config.js';
import { clamp } from '../core/rng.js';

// The level lives inside a THREE.Group that starts axis-aligned. Physics always
// runs in that group's local space, which means "down" is the group's local -Y
// and the tile grid is always axis-aligned -- at any rotation.
//
// That is the whole trick behind the L2 mechanic. Rotating the group by 90
// degrees needs no rotated-box maths, because the simulation never leaves the
// group's frame. Gravity follows the room, a wall becomes a floor, and a gap
// that could not be jumped becomes a ledge that can be walked.

const BOSS_ARENA_W = 40;   // tiles

function blankLevel(id, width, height) {
  return {
    id,
    width,
    height,
    grid: new Uint8Array(width * height),
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


// +y is up, so the ground occupies the *lowest* rows (ty 0..3) and the level's
// height is mostly headroom. GROUND is the surface the player stands on.
const GROUND = 3;

// Ground with a hole punched in it. The holes are the rotation puzzle: they are
// deliberately wider than a jump (~9 tiles), and only become crossable once the
// room turns.
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

const FLOOR_Y = (GROUND + 1) * TILE;   // standing surface, in pixels
const VOID_H = 240;                   // depth of the black under a pit
const RUNE_LEAD = 3;                   // tiles before a hole the rune is drawn
const at = (ty) => ty * TILE + TILE;   // top face of a platform row, in pixels

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
    return lv;
  },

  // ------------------------------------------------------------------ L2
  () => {
    const W = 170, H = 36;
    const lv = blankLevel(2, W, H);
    // Gaps far wider than a jump, and standing walls that are only floors once
    // the room turns. This is the level the mechanic is for.
    ground(lv, [[40, 14], [68, 16], [102, 15]]);

    plat(lv, 10, 8, 5);
    plat(lv, 20, 10, 5);
    // A standing wall: harmless seen from above, a bridge seen from the side.
    // A step in front of the column at 30: ground 32 -> 72 -> the top at 112.
    plat(lv, 26, 8, 3);
    block(lv, 30, 4, 3, 10);
    plat(lv, 36, 8, 4);

    plat(lv, 58, 7, 5);
    block(lv, 62, 4, 3, 9);
    // Two steps for the column at 82: 72, then 88, then its top at 128. Each
    // rise is 40, 16 and 40 -- the direct 80 -> 128 was 48, over the rule.
    plat(lv, 72, 8, 6);
    plat(lv, 78, 10, 4);
    block(lv, 82, 5, 4, 11);

    plat(lv, 96, 8, 6);
    plat(lv, 118, 8, 3);
    block(lv, 122, 4, 3, 10);
    plat(lv, 126, 9, 5);
    plat(lv, 136, 11, 6);
    // 72 then 88 then the top at 120; 72 -> 120 alone is 48.
    plat(lv, 142, 8, 2);
    plat(lv, 144, 10, 2);
    block(lv, 146, 5, 3, 10);

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
      { type: 'crawler', x: 104 * TILE, y: FLOOR_Y, patrol: [100, 114] },
      { type: 'spitter', x: 146 * TILE, y: FLOOR_Y, patrol: [142, 162] },
      { type: 'spitter', x: 172 * TILE, y: FLOOR_Y, patrol: [166, 176] },
      { type: 'boss', boss: 'patientone', x: (W - 20) * TILE, y: FLOOR_Y },
    );
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
    this.rot = 0;             // current rotation, always a multiple of PI/2
    this.rotFrom = 0;
    this.rotTo = 0;
    this.rotT = 0;
    this.rotating = false;
    this.rotCount = 0;
  }

  load(index) {
    this.dispose();
    this.data = LEVEL_DEFS[index]();
    this.rot = 0; this.rotFrom = 0; this.rotTo = 0; this.rotT = 0;
    this.rotating = false; this.rotCount = 0;
    this.group.rotation.z = 0;
    this.group.position.set(0, 0, 0);
    this.group.updateMatrixWorld(true);
    this._buildTiles();
    return this.data;
  }

  get canRotate() { return this.data && this.data.id === 2; }

  // Read by _buildRunes while the tiles are being built, before canRotate can be
  // trusted on a fresh load.
  get levelCanRotate() { return !!this.data && this.data.id === 2; }
  get isRotating() { return this.rotating; }

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

  // Called when the player is pinned in world space for the duration of a turn.
  pinWorld() {
    const world = this.localToWorld(this.pinnedLocal.clone());
    return world;
  }

  // `localPos` may be a live object owned by the caller (the player's body) or
  // a throwaway Vector3, so copy rather than retain: keeping the reference meant
  // the "pinned" position tracked the body while the body kept integrating.
  beginRotate(localPos) {
    if (this.rotating || !this.canRotate) return false;
    this.pinnedLocal = new THREE.Vector3(localPos.x, localPos.y, 0);
    this.pinnedWorld = this.localToWorld(this.pinnedLocal.clone());
    this.rotFrom = this.rot;
    this.rotTo = this.rot + Math.PI / 2;
    this.rotT = 0;
    this.rotating = true;
    return true;
  }

  // Eased so the turn has weight: it starts slow, whips, and settles.
  static ease(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  updateRotation(dt) {
    if (!this.rotating) return null;
    this.rotT += dt;
    const k = clamp(this.rotT / ROTATE_TIME, 0, 1);
    this.rot = this.rotFrom + (this.rotTo - this.rotFrom) * Level.ease(k);
    this.group.rotation.z = this.rot;
    this.group.updateMatrixWorld(true);
    if (k >= 1) {
      this.rotating = false;
      this.rotCount++;
      this.rot = this.rotTo;
      this.group.rotation.z = this.rot;
      this.group.updateMatrixWorld(true);
      return this.pinnedWorld.clone();   // caller re-derives the local position
    }
    return null;
  }

  // ---- geometry
  _buildTiles() {
    const d = this.data;
    const geo = new THREE.BoxGeometry(TILE, TILE, TILE);
    // One InstancedMesh for the whole grid: a 190x34 tile map is 6460 boxes,
    // which is fine as instances and painful as individual meshes.
    const positions = [];
    for (let ty = 0; ty < d.height; ty++) {
      for (let tx = 0; tx < d.width; tx++) {
        const v = d.grid[ty * d.width + tx];
        if (v === 0) continue;
        positions.push([tx, ty, v]);
      }
    }
    const solids = positions.filter((p) => p[2] === SOLID);
    const plats = positions.filter((p) => p[2] === PLATFORM);
    const spikes = positions.filter((p) => p[2] === SPIKE);

    const pal = (LEVELS[d.id - 1] || LEVELS[0]);
    this._inst(geo, solids, pal.tile, 1.0);
    this._inst(geo, plats, pal.platform, 1.0);
    this._inst(geo, spikes, 0x8a4a3a, 1.0);

    // A lip along the top of every floor tile reads as a highlight edge and
    // makes the platform tops findable in a dark level without any lighting.
    // Platforms too, not just solids -- they were built as PLATFORM tiles and
    // never appeared in `solids`, so every floating platform had no accent
    // edge and read as a plain black bar.
    // .concat, not +. `+` on two arrays coerces both to strings, so
    // `solids + plats` yielded "0,0,1,1,..." and every platform lost its lip.
    this._buildLips(solids.concat(plats), pal.lip);
    this._buildVoid();
    this._buildRunes(pal);
  }

  // A rune on the ground three tiles before each rotation hole, in the level's
  // accent colour. The holes are the one thing in the game with no visual tell
  // that they are meant to be crossed by turning the room, so something has to
  // say so at the player's feet. Pulses in updateRunes.
  _buildRunes(pal) {
    this.runes = [];
    const holes = this.data.holes || [];
    if (!this.levelCanRotate || !holes.length) return;
    const mat = new THREE.MeshBasicMaterial({
      color: pal.accent, transparent: true, opacity: 0.85,
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

  _inst(geo, list, color, opacity, lip = false) {
    if (!list.length) return null;
    // transparent:true on purpose, even at full opacity. Three renders the
    // opaque pass before the transparent pass, and the parallax layers are
    // transparent -- so opaque tiles drew FIRST and the backdrop painted over
    // the playfield. In the transparent pass these sort by z and land between
    // the far backdrop (z=-40) and the foreground band (z=+6), which is the
    // order they need to be in.
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    // Explicit render order. Everything shares z=0, so the sort falls through to
    // object ids and the 2px accent lip lost the tie-break against the tile
    // boxes and never showed. Ordering by hand is the only reliable way here.
    mesh.renderOrder = lip ? 2 : 1;
    const m = new THREE.Matrix4();
    list.forEach(([tx, ty], i) => {
      m.makeTranslation(tx * TILE + TILE / 2, ty * TILE + TILE / 2, 0);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.tilesGroup.add(mesh);
    return mesh;
  }

  _buildLips(solids, color) {
    const set = new Set(solids.map(([x, y]) => `${x},${y}`));
    const tops = solids.filter(([x, y]) => !set.has(`${x},${y + 1}`));
    if (!tops.length) return;
    const geo = new THREE.PlaneGeometry(TILE, 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    const mesh = new THREE.InstancedMesh(geo, mat, tops.length);
    mesh.renderOrder = 2;
    const m = new THREE.Matrix4();
    tops.forEach(([tx, ty], i) => {
      m.makeTranslation(tx * TILE + TILE / 2, ty * TILE + TILE - 1, 0);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    this.tilesGroup.add(mesh);
  }

  dispose() {
    for (let i = this.tilesGroup.children.length - 1; i >= 0; i--) {
      const c = this.tilesGroup.children[i];
      c.geometry?.dispose();
      c.material?.dispose();
      this.tilesGroup.remove(c);
    }
  }

  get worldWidth() { return this.data ? this.data.width * TILE : 0; }
  get worldHeight() { return this.data ? this.data.height * TILE : 0; }
}

export { LEVELS, BOSS_ARENA_W };
