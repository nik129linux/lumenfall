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
  for (const [hx, hw] of holes) {
    fill(lv, hx, 0, hw, 8, 0);
  }
}

const plat = (lv, tx, ty, tw) => fill(lv, tx, ty, tw, 1, PLATFORM);
const block = (lv, tx, ty, tw, th) => fill(lv, tx, ty, tw, th);

const FLOOR_Y = (GROUND + 1) * TILE;   // standing surface, in pixels
const at = (ty) => ty * TILE + TILE;   // top face of a platform row, in pixels

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
    block(lv, 74, 12, 4, 4);

    // Mid shrine: stepped terraces.
    plat(lv, 84, 8, 7);
    plat(lv, 92, 10, 5);
    plat(lv, 98, 12, 5);

    // Second gap.
    plat(lv, 108, 9, 6);
    block(lv, 118, 12, 5, 5);
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
      { type: 'shard', x: 120 * TILE, y: at(12) + 5 * TILE },
      { type: 'shard', x: 140 * TILE, y: at(10) },
      { type: 'shard', x: 156 * TILE, y: at(9) },
      { type: 'elder', x: 48 * TILE, y: FLOOR_Y },
      { type: 'wisp', x: 64 * TILE, y: FLOOR_Y + 40, patrol: [60, 78] },
      { type: 'wisp', x: 100 * TILE, y: FLOOR_Y + 40, patrol: [96, 112] },
      { type: 'crawler', x: 132 * TILE, y: FLOOR_Y, patrol: [126, 152] },
      { type: 'crawler', x: 152 * TILE, y: FLOOR_Y, patrol: [146, 164] },
      { type: 'boss', boss: 'statue', x: (W - 20) * TILE, y: FLOOR_Y },
    );
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
    block(lv, 30, 4, 3, 10);
    plat(lv, 36, 8, 4);

    plat(lv, 58, 7, 5);
    block(lv, 62, 4, 3, 9);
    plat(lv, 72, 9, 6);
    block(lv, 82, 5, 4, 11);

    plat(lv, 96, 8, 6);
    block(lv, 118, 4, 3, 10);
    plat(lv, 126, 9, 5);
    plat(lv, 136, 11, 6);
    block(lv, 146, 5, 3, 10);

    lv.entities.push(
      { type: 'shard', x: 12 * TILE, y: at(8) },
      { type: 'shard', x: 22 * TILE, y: at(10) },
      { type: 'shard', x: 60 * TILE, y: at(7) },
      { type: 'shard', x: 74 * TILE, y: at(9) },
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

    plat(lv, 66, 8, 5);
    plat(lv, 74, 11, 4);
    plat(lv, 82, 14, 5);
    block(lv, 92, 4, 3, 16);

    plat(lv, 114, 8, 6);
    plat(lv, 124, 11, 5);
    plat(lv, 132, 14, 4);
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
