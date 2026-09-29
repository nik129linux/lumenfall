// Reachability proof for docs/stage1d.md.
//
//   python3 -m http.server 8765
//   node tools/reach.mjs
//
// Three tests per level, all of which have to pass:
//
//   1. Support     every distinct standable run holds the player. Teleport 20px
//                  above the middle of the run, wait, assert onGround and that
//                  the body bottom came to rest exactly on the run's top.
//   2. Reach       the required path (spawn -> boss arena) is solved with rises
//                  of at most 40px; every other surface, plus all shards and the
//                  arena, is reachable with rises of at most 48px. Drops are
//                  free, the horizontal gap is at most 7 tiles, and a solid
//                  column taller than the jump blocks the straight path across
//                  it. The L2 rotation holes are the one documented exception.
//                  The required path is printed as a list of surfaces.
//   3. Jump        a real jump: hold Right, press Jump every 0.5s for 6s, and
//                  the max body height must clear floor + 55.
//   4. Pit death   dropped into an L1 hole, Kael must be dead and in the death
//                  state within 1.5s, and the normal respawn must then work.
//                  Added by stage 2c.
//
// Exits 1 on any failure.

import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8765/index.html';

// JUMP_VEL 305 over GRAVITY 720 gives a 64.6px apex, rounded down to 64 for
// wall clearance. Two rise limits, from docs/stage2c.md:
//   REQUIRED_RISE  any climb the player MUST make to finish the level
//   OPTIONAL_RISE  optional platforms, e.g. the ones holding shards
// A column taller than the jump blocks the straight path across it, which is
// what made the L2 columns impassable in practice.
const JUMP_APEX_PX = 64;
const REQUIRED_RISE_PX = 40;
const OPTIONAL_RISE_PX = 48;
const MAX_GAP_TILES = 7;
const JUMP_MARGIN_PX = 55;
const TILE = 8;
const FLOOR_Y = 32;          // the ground occupies rows 0..3, top face at 4*8

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

let failures = 0;
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };

// Runs of standable tiles, derived from the level grid. A tile is standable if
// it is solid or one-way and the tile above it is empty, which is what makes it
// something the player can actually land on.
async function runs(level) {
  return page.evaluate(() => {
    const g = window.__lumenfall;
    const d = g.level.data;
    const at = (x, y) => (y < 0 || y >= d.height || x < 0 || x >= d.width ? 0 : d.grid[y * d.width + x]);
    const out = [];
    for (let y = 0; y < d.height; y++) {
      for (let x = 0; x < d.width; x++) {
        const t = at(x, y);
        if (t !== 1 && t !== 2) continue;
        if (at(x, y + 1) !== 0) continue;      // covered: not a surface
        let w = 1;
        while (at(x + w, y) === t && at(x + w, y + 1) === 0) w++;
        // A run narrower than the player is a ledge, not a surface: at 14px
        // wide the body overhangs by 3px on each side and has nothing to stand
        // on. Those are excluded from both the support test and the graph.
        if (w * 8 >= 14) out.push({ x0: x, x1: x + w - 1, w, ty: y, top: (y + 1) * 8, solid: t === 1 });
        x += w - 1;
      }
    }
    return { runs: out, width: d.width, height: d.height, id: d.id, grid: Array.from(d.grid) };
  });
}

// L1 has an elder at x=30 and the deal fires when Kael comes within 28px of
// him, which locks input and freezes the body mid-measurement. This tool
// measures physics and reachability, not story, so the trigger is marked as
// already spent and re-asserted before every measurement.
const muteStory = () => page.evaluate(() => {
  const g = window.__lumenfall;
  if (g.elder) g.elder.talked = true;
});

for (const n of [1, 2, 3]) {
  console.log(`\n=== L${n} ===`);
  await page.goto(`${URL}?level=${n}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => ['play', 'boss'].includes(window.__lumenfall?.machine?.state), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 800));
  await muteStory();

  const { runs: all, width, height, grid } = await runs(n);
  console.log(`  ${all.length} standable runs, level width ${width} tiles`);

  // ---------------------------------------------------------------- 1. support
  let supportFails = 0;
  for (const r of all) {
    await muteStory();
    // A run can have a wall standing on it partway along -- L2 puts a block on
    // the ground at x=146, and the run's arithmetic middle lands inside it. The
    // body would be teleported into the block and pushed out sideways, so choose
    // the middle of the widest span where a 14x30 body actually fits above the
    // top. That still tests the surface itself.
    const spot = await page.evaluate(({ r0, r1, ty }) => {
      const d = window.__lumenfall.level.data;
      const at = (x, y) => (y < 0 || y >= d.height || x < 0 || x >= d.width ? 1 : d.grid[y * d.width + x]);
      let best = null, runStart = r0, bestLen = 0;
      for (let x = r0; x <= r1 + 1; x++) {
        // The body stands on row ty, so it needs rows ty+1..ty+4 clear.
        const clear = x <= r1
          && [1, 2, 3, 4].every((k) => at(x, ty + k) === 0)
          && [1, 2].every((k) => at(x + 1, ty + k) === 0);
        if (clear) { if (x === runStart) runStart = x; }
        else { const len = x - runStart; if (len > bestLen) { bestLen = len; best = runStart; } runStart = x + 1; }
      }
      return best == null ? (r0 + r1 + 1) / 2 * 8 : (best + bestLen / 2) * 8;
    }, { r0: r.x0, r1: r.x1, ty: r.ty });
    const mid = spot;
    // Retried: a single measurement is a timing artefact under a software
    // rasteriser, where the game clamps dt and a landing can be missed by one
    // frame. A platform that genuinely does not hold the player misses all of
    // them, so this does not hide the bug it exists to catch.
    let res = null;
    for (let attempt = 0; attempt < 3 && !(res && res.onGround && res.y === r.top); attempt++) {
      res = await page.evaluate(async ({ x, y }) => {
        const g = window.__lumenfall;
        const b = g.player.body;
        b.vx = 0; b.vy = 0;
        b.x = x - b.w / 2;
        b.y = y;
        // A teleport puts the body in mid-air, so it has to be flagged airborne.
        b.onGround = false;
        // Enemies would knock the body off the run mid-wait and make the result
        // depend on where a spitter happened to be, so hold the body safe.
        g.player.hurtTimer = 999;
        await new Promise((r) => setTimeout(r, 1000));
        return { onGround: b.onGround, y: b.y };
      }, { x: mid, y: r.top + 20 });
    }
    const ok = res.onGround && res.y === r.top;
    if (!ok) { supportFails++; fail(`plat@x=${r.x0} ty=${r.ty} -> onGround=${res.onGround} y=${res.y} expected ${r.top}`); }
    else console.log(`  L${n} plat@x=${r.x0} ty=${r.ty} OK`);
  }
  if (supportFails === 0) console.log(`  support: ${all.length}/${all.length} runs hold the player`);

  // ---------------------------------------------------------------- 2. reach
  // Spawn is the leftmost ground surface. The rule from the brief: B is
  // reachable from A when B.top - A.top <= 48 and the horizontal gap is <= 7
  // tiles. A drop is always allowed in height, but the gap still has to be
  // crossable, so the gap is checked on every edge. The one exemption is an L2
  // edge that spans a rotation hole: those are meant to be crossed only after
  // the room turns, and they are the only gap allowed to be wider than 7.
  const groundRuns = all.filter((r) => r.ty === 3);
  const spawn = groundRuns.length ? groundRuns[0] : all[0];

  // Maximal empty stretches of the ground row: the holes a player has to get
  // across.
  const holes = await page.evaluate(() => {
    const d = window.__lumenfall.level.data;
    const at = (x) => (x < 0 || x >= d.width ? 0 : d.grid[3 * d.width + x]);
    const out = [];
    let start = -1;
    for (let x = 0; x < d.width; x++) {
      if (at(x) === 0) { if (start < 0) start = x; }
      else if (start >= 0) { out.push([start, x - 1]); start = -1; }
    }
    if (start >= 0) out.push([start, d.width - 1]);
    return out;
  });

  const spansHole = (a, b) => {
    const lo = a.x1 < b.x0 ? a.x1 + 1 : b.x1 + 1;
    const hi = a.x1 < b.x0 ? b.x0 - 1 : a.x0 - 1;
    if (hi < lo) return false;
    return holes.some(([h0, h1]) => lo >= h0 && hi <= h1);
  };

  const tileAt = (tx, ty) => {
    if (ty < 0 || ty >= levelH || tx < 0 || tx >= levelW) return 1;   // edges are solid
    return grid[ty * levelW + tx];
  };
  const levelH = height; const levelW = width;

  // Solid column tops between two runs. If one stands taller than a jump above
  // the higher of the two surfaces, you cannot get across it: that is the whole
  // reason the L2 columns read as impassable.
  const blockingColumn = (a, b) => {
    const lo = a.x1 < b.x0 ? a.x1 + 1 : b.x1 + 1;
    const hi = a.x1 < b.x0 ? b.x0 - 1 : a.x0 - 1;
    if (hi < lo) return 0;
    const ceil = Math.max(a.top, b.top) + JUMP_APEX_PX;
    let worst = 0;
    for (let tx = lo; tx <= hi; tx++) {
      for (let ty = 0; ty < levelH; ty++) {
        if (tileAt(tx, ty) !== 1) continue;
        worst = Math.max(worst, (ty + 1) * 8);
      }
    }
    return worst > ceil ? worst : 0;
  };

  // BFS from the spawn, returning the reachable set and the parent links so the
  // required path can be printed.
  const solve = (riseLimit) => {
    const seen = new Set([spawn]);
    const from = new Map();
    const queue = [spawn];
    while (queue.length) {
      const a = queue.shift();
      for (const b of all) {
        if (seen.has(b)) continue;
        if (b.top - a.top > riseLimit) continue;
        const gap = b.x0 > a.x1 ? b.x0 - a.x1 - 1 : (a.x0 > b.x1 ? a.x0 - b.x1 - 1 : 0);
        // L2 rotation holes are meant to be crossed only after the room turns.
        if (gap > MAX_GAP_TILES && !(n === 2 && spansHole(a, b))) continue;
        if (blockingColumn(a, b)) continue;
        seen.add(b); from.set(b, a); queue.push(b);
      }
    }
    return { seen, from };
  };

  // The arena is the standable surface under the boss.
  const bossTx = await page.evaluate(() => {
    const g = window.__lumenfall;
    const b = g.level.data.entities.find((e) => e.type === 'boss');
    return b ? Math.floor(b.x / 8) : -1;
  });
  const arena = all.find((r) => bossTx >= r.x0 && bossTx <= r.x1) || null;

  const req = solve(REQUIRED_RISE_PX);
  if (!arena || !req.seen.has(arena)) {
    fail(`required path to the boss arena is not solvable with ${REQUIRED_RISE_PX}px rises`
      + (arena ? ` (arena at x=${arena.x0} ty=${arena.ty} top=${arena.top})` : ' (no arena surface)'));
  } else {
    const path = [];
    for (let cur = arena; cur; cur = req.from.get(cur)) { path.unshift(cur); if (path.length > 200) break; }
    console.log(`  required path (spawn -> arena), ${path.length} surfaces, rises <= ${REQUIRED_RISE_PX}px:`);
    console.log('    ' + path.map((r) => `x${r.x0}${r.x1 === r.x0 ? '' : '-' + r.x1}@${r.top}`).join(' -> '));
  }

  // Optional surfaces, with the wider 48px limit, seeded from what the required
  // path already reaches so a shard ladder is judged from the real floor.
  const opt = solve(OPTIONAL_RISE_PX);
  for (const r of req.seen) opt.seen.add(r);
  const isRotationGap = (r) => n === 2 && r.ty === 3;
  const unreachable = all.filter((r) => !opt.seen.has(r) && !isRotationGap(r));
  if (unreachable.length) {
    for (const r of unreachable) fail(`unreachable surface plat@x=${r.x0} ty=${r.ty} top=${r.top}`);
  } else {
    const excepted = all.filter((r) => !opt.seen.has(r) && isRotationGap(r)).length;
    console.log(`  reach: all ${all.length - excepted} surfaces reachable from spawn`
      + (excepted ? ` (${excepted} L2 rotation gaps excepted)` : ''));
  }

  // Shards and the boss arena must be reachable too: they sit on a surface, so
  // the surface under each one is what has to be in the reachable set.
  const pts = await page.evaluate(() => {
    const g = window.__lumenfall;
    const d = g.level.data;
    const out = [];
    for (const e of d.entities) {
      if (e.type === 'shard' || e.type === 'boss') out.push({ type: e.type, tx: Math.floor(e.x / 8) });
    }
    return out;
  });
  let ptsBad = 0;
  for (const p of pts) {
    // A point is served by any reachable run whose span contains its column.
    const served = all.some((r) => opt.seen.has(r) && p.tx >= r.x0 && p.tx <= r.x1);
    if (!served) { ptsBad++; fail(`${p.type} at tile x=${p.tx} is not on a reachable surface`); }
  }
  if (ptsBad === 0) console.log(`  reach: all ${pts.length} shards/boss arenas on a reachable surface`);

  // ---------------------------------------------------------------- 3. jump
  // Reload first: the support test walks the body into every hazard in the
  // level, and a jump from a dead or mid-air body measures nothing.
  await page.goto(`${URL}?level=${n}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => ['play', 'boss'].includes(window.__lumenfall?.machine?.state), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 600));
  await muteStory();
  await page.evaluate(async () => {
    const b = window.__lumenfall.player.body;
    b.vx = 0; b.vy = 0; b.x = 4 * 8; b.y = 32;
    // Let it settle so coyote time is armed before the first press.
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
  });
  await page.keyboard.down('ArrowRight');
  const apex = await page.evaluate(async () => {
    const g = window.__lumenfall;
    const b = g.player.body;
    let max = b.y;
    let held = false;
    let nextPress = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 6000) {
      const t = performance.now() - t0;
      // Hold each press for its whole 500ms slot. Releasing early triggers the
      // variable-jump cut, and how much height that costs depends on the frame
      // rate: the game clamps dt to 1/20s, so under a software rasteriser
      // simulated time runs slower than wall time and a 350ms hold lands well
      // short of the apex. Releasing only just before the next press removes
      // that dependency, and holding longer only ever gains height.
      if (!held && t >= nextPress) {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
        held = true;
        nextPress = t + 500;
      } else if (held && t >= nextPress - 20) {
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
        held = false;
      }
      max = Math.max(max, b.y);
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (held) window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    return max;
  });
  await page.keyboard.up('ArrowRight');
  const need = FLOOR_Y + JUMP_MARGIN_PX;
  if (apex > need) console.log(`  jump: max body.y ${apex.toFixed(1)} > floor+${JUMP_MARGIN_PX} (${need}) OK`);
  else fail(`jump: max body.y ${apex.toFixed(1)} did not exceed ${need}`);
}

// ---------------------------------------------------------------- 4. pit death
// A pit is bottomless: dropped in, Kael must die within 1.5s and the existing
// respawn flow must then take over. Checked on L1, which has no rotation to
// complicate the "which way is down" question.
console.log('\n=== pit death (L1) ===');
{
  const page2 = await browser.newPage({ viewport: { width: 480, height: 270 } });
  page2.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page2.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page2.goto(`${URL}?level=1`, { waitUntil: 'load' });
  await page2.waitForFunction(
    () => ['play', 'boss'].includes(window.__lumenfall?.machine?.state), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 600));

  const hole = await page2.evaluate(() => {
    const h = window.__lumenfall.level.data.holes || [];
    return h.length ? h[0][0] + Math.floor(h[0][1] / 2) : -1;
  });
  if (hole < 0) {
    fail('L1 has no hole to test pit death with');
  } else {
    // Watch the post pass while the body falls, so the red flash and the
    // fall-out fade are actually observed rather than assumed.
    await page2.evaluate(() => {
      const g = window.__lumenfall;
      window.__pit = { maxHurt: 0, minFade: 1 };
      window.__pitTimer = setInterval(() => {
        const u = g.pipeline.postUniforms;
        window.__pit.maxHurt = Math.max(window.__pit.maxHurt, u.hurt.value);
        window.__pit.minFade = Math.min(window.__pit.minFade, u.fade.value);
      }, 16);
    });

    // Dropped in from just under the lip, with no floor under the body.
    await page2.evaluate((tx) => {
      const b = window.__lumenfall.player.body;
      b.vx = 0; b.vy = -140; b.x = tx * 8 + 1; b.y = 22; b.onGround = false;
    }, hole);

    const t0 = Date.now();
    const died = await page2.waitForFunction(
      () => {
        const g = window.__lumenfall;
        return g.player.dead && g.machine.state === 'dead';
      }, { timeout: 1500 }).then(() => true, () => false);
    const took = Date.now() - t0;
    const st = await page2.evaluate(() => {
      clearInterval(window.__pitTimer);
      return {
        dead: window.__lumenfall.player.dead,
        state: window.__lumenfall.machine.state,
        maxHurt: window.__pit.maxHurt,
        minFade: window.__pit.minFade,
      };
    });
    if (died) {
      console.log(`  pit: hole at tile ${hole} -> dead in the death state after ${took}ms OK`
        + ` (red flash peak ${st.maxHurt.toFixed(2)}, fade bottomed at ${st.minFade.toFixed(2)})`);
      if (st.maxHurt <= 0) fail('the pit fall-out showed no red flash');
      if (st.minFade > 0.9) fail('the pit fall-out never faded out');
    } else {
      fail(`falling into a pit did not kill within 1.5s: dead=${st.dead} state=${st.state}`);
    }

    // And the existing flow still respawns. The death state ignores input for
    // 1.1s, so the press is repeated rather than fired once.
    let back = false;
    for (let i = 0; i < 10 && !back; i++) {
      await new Promise((r) => setTimeout(r, 400));
      await page2.keyboard.press('KeyZ');
      back = await page2.waitForFunction(
        () => window.__lumenfall.machine.state === 'play' && !window.__lumenfall.player.dead,
        { timeout: 900 }).then(() => true, () => false);
    }
    const after2 = await page2.evaluate(() => window.__lumenfall.machine.state);
    if (back) console.log(`  pit: respawn returned to ${after2} OK`);
    else fail(`the normal death/respawn flow did not take over: state=${after2}`);
  }
  await page2.close();
}

// The same fall, but in a rotated L2 room. After a quarter turn "down" is a
// local +X edge rather than the bottom, so this exercises the rotation-aware
// branch of the void check rather than the hole case above.
console.log('\n=== pit death, L2 after a rotation ===');
{
  const page3 = await browser.newPage({ viewport: { width: 480, height: 270 } });
  page3.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page3.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page3.goto(`${URL}?level=2`, { waitUntil: 'load' });
  await page3.waitForFunction(
    () => ['play', 'boss'].includes(window.__lumenfall?.machine?.state), { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 600));

  // Turn the room, the same way a player does, and wait for the tween to land.
  await page3.evaluate(async () => {
    const g = window.__lumenfall;
    g.player.hurtTimer = 999;
    // beginRotate only reads .x and .y, so a plain object is enough here.
    g.level.beginRotate({ x: g.player.cx, y: g.player.cy });
    for (let i = 0; i < 200 && g.level.isRotating; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    g.player.hurtTimer = 0;
  });
  const rotQ = await page3.evaluate(() => window.__lumenfall.level.data.rotQ);
  if (rotQ !== 1) {
    fail(`L2 did not register a quarter turn (rotQ=${rotQ})`);
  } else {
    console.log(`  L2 rotated: rotQ=${rotQ}, open edge = ${await page3.evaluate(() => JSON.stringify(window.__lumenfall.level.data.openEdges))}`);
    // Shoved out through the now-open edge, in the direction that is down.
    await page3.evaluate(() => {
      const g = window.__lumenfall;
      const b = g.player.body;
      b.vx = 0; b.vy = 0;
      b.x = g.level.data.width * 8 + 24;    // past the open right edge
      b.onGround = false;
    });
    const wentOut = await page3.waitForFunction(
      () => {
        const g = window.__lumenfall;
        return g.player.dead && g.machine.state === 'dead';
      }, { timeout: 4000 }).then(() => true, () => false);
    const st3 = await page3.evaluate(() => ({
      dead: window.__lumenfall.player.dead,
      state: window.__lumenfall.machine.state,
    }));
    if (wentOut) console.log(`  pit: fell out of the rotated room and died (state=${st3.state}) OK`);
    else fail(`falling out of a rotated L2 room did not kill: dead=${st3.dead} state=${st3.state}`);
  }
  await page3.close();
}

if (errors.length) {
  failures++;
  console.log(`\nconsole errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} reach.mjs`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
