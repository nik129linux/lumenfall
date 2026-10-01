// Stage 12 gate: the world shift replaces the rotation. Run: node tools/gate12.mjs
import { chromium } from 'playwright';
import { STRINGS } from '../js/ui/strings.js';
import fs from 'node:fs';
const URL = process.env.GATE_URL || 'http://localhost:8765/index.html';
const results = [], errors = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
async function open(query) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${URL}${query}`); await page.waitForTimeout(3500);
  return page;
}
try {
  // ---- source hygiene
  const main = fs.readFileSync('js/main.js', 'utf8'), lvl = fs.readFileSync('js/game/level.js', 'utf8');
  check('W1 no rotation left in the code (beginRotate, updateRotation) and no test hack window.CFG', !/beginRotate|updateRotation/.test(main + lvl) && !/window\.CFG/.test(main), '');
  const es = Object.values(STRINGS.es).join('\n'), en = Object.values(STRINGS.en).join('\n');
  check('W2 texts say shift worlds in both languages and nothing says rotate/girar', /cambiar de mundo/i.test(es) && /shift worlds/i.test(en) && !/girar/i.test(es) && !/turn the world|rotate/i.test(en), `es girar=${/girar/i.test(es)} en rotate=${/turn the world|rotate/i.test(en)}`);

  // ---- level 2 data model and layout
  const page = await open('?level=2');
  const r = await page.evaluate(async () => {
    const g = window.__lumenfall, L = g.level, d = L.data;
    const { tileAt, SOLID, PLATFORM } = await import('/js/game/physics.js');
    const out = { api: typeof L.shiftWorld === 'function' && typeof L.shiftCount === 'number' && L.canShift === true && d.layer instanceof Uint8Array && d.layer.length === d.grid.length && L.world === 0 && d.world === 0 };
    if (!out.api) return out;
    const W = d.width, H = d.height;
    const holes = []; let run = null;
    for (let x = 0; x < W; x++) { const empty = d.grid[3 * W + x] === 0; if (empty && !run) run = [x, x]; else if (empty) run[1] = x; else if (run) { holes.push(run); run = null; } }
    if (run) holes.push(run);
    const big = holes.filter(([a, b]) => b - a + 1 >= 10);
    out.holes = big.length;
    out.pitsInA = big.every(([a, b]) => { for (let x = a; x <= b; x++) if (tileAt(d, x, 3) !== 0) return false; return true; });
    // world B bridges: temporarily flip the world flag and read the tiles
    d.world = 1;
    out.bridgesInB = big.every(([a, b]) => { for (let x = a; x <= b; x++) if (tileAt(d, x, 3) !== SOLID) return false; return true; });
    const arenaFrom = W - 40; let arenaFloor = true, platA = 0, platB = 0;
    for (let x = arenaFrom; x < W; x++) { if (d.layer[3 * W + x] !== 0 || d.grid[3 * W + x] !== SOLID) arenaFloor = false; }
    for (let y = 4; y < H; y++) for (let x = arenaFrom; x < W; x++) { const i = y * W + x; if (d.grid[i] === PLATFORM) { if (d.layer[i] === 1) platA++; if (d.layer[i] === 2) platB++; } }
    d.world = 0;
    out.arenaFloor = arenaFloor; out.platA = platA; out.platB = platB;
    out.wallsInA = 0; for (let i = 0; i < d.grid.length; i++) if (d.grid[i] === SOLID && d.layer[i] === 1) out.wallsInA++;
    return out;
  });
  check('W3 data model: layer array, world, shiftWorld, shiftCount, canShift in L2 (world starts at A)', r.api, JSON.stringify(r));
  if (r.api) {
    check('W4 L2 has at least 3 big holes: pits in world A', r.holes >= 3 && r.pitsInA, `holes=${r.holes} pitsInA=${r.pitsInA}`);
    check('W5 every big hole has a solid bridge in world B', r.bridgesInB, '');
    check('W6 boss arena: common floor, >= 8 platform tiles in each world', r.arenaFloor && r.platA >= 8 && r.platB >= 8, `floor=${r.arenaFloor} platA=${r.platA} platB=${r.platB}`);
    check('W7 some tall walls exist only in world A', r.wallsInA >= 6, `A-only solid tiles=${r.wallsInA}`);

    // ---- behaviour: shift, refuse, cooldown, force
    const b = await page.evaluate(async () => {
      const g = window.__lumenfall, L = g.level, p = g.player, d = L.data;
      const out = {};
      const W = d.width;
      let a = -1, z = -1; for (let x = 0; x < W; x++) { if (d.grid[3 * W + x] === 0) { if (a < 0) a = x; z = x; if (d.grid[3 * W + x + 1] !== 0) break; } }
      out.hole = [a, z];
      // refuse inside a B-only solid
      p.body.x = (a + 2) * 8; p.body.y = 25; p.body.vx = 0; p.body.vy = 0;
      L.shiftCd = 0;
      out.refused = L.shiftWorld() === false && L.world === 0;
      // cooldown
      p.body.y = 60; L.shiftCd = 0;
      const first = L.shiftWorld(), second = L.shiftWorld();
      out.cooldown = first === true && second === false && L.world === 1 && L.shiftCount >= 1;
      // force resolves overlap by moving up
      L.shiftWorld({ force: true });                 // back to A
      p.body.x = (a + 2) * 8; p.body.y = 25; L.shiftCd = 0;
      const forced = L.shiftWorld({ force: true });  // into B with the body inside the bridge row
      const { tileAt } = await import('/js/game/physics.js');
      let overlap = false;
      for (let ty = Math.floor(p.body.bottom / 8); ty <= Math.floor((p.body.top - 0.01) / 8); ty++) for (let tx = Math.floor(p.body.left / 8); tx <= Math.floor((p.body.right - 0.01) / 8); tx++) if (tileAt(d, tx, ty) === 1) overlap = true;
      out.forced = forced === true && !overlap && !p.dead;
      out.rotZ = L.group.rotation.z;
      return out;
    });
    check('W8 a shift into solid is refused (world unchanged)', b.refused, '');
    check('W9 the shift has a cooldown (second immediate call refused)', b.cooldown, '');
    check('W10 force:true never refuses and leaves the body out of solid ground', b.forced, '');
    check('W11 the level group never rotates', b.rotZ === 0, `rotation.z=${b.rotZ}`);

    // ---- behaviour: walking across a hole
    const walk = async (shiftFirst) => {
      const pg = await open('?level=2');
      const info = await pg.evaluate(({ shiftFirst }) => {
        const g = window.__lumenfall, d = g.level.data, p = g.player, W = d.width;
        let a = -1, z = -1; for (let x = 0; x < W; x++) { if (d.grid[3 * W + x] === 0) { if (a < 0) a = x; z = x; if (d.grid[3 * W + x + 1] !== 0) break; } }
        p.body.x = (a - 3) * 8; p.body.y = 33; p.body.vx = 0; p.body.vy = 0; p.hurtTimer = 999;
        g.level.shiftCd = 0;
        return { a, z, shifted: shiftFirst ? g.level.shiftWorld() : false };
      }, { shiftFirst });
      await pg.waitForTimeout(500);
      await pg.keyboard.down('ArrowRight');
      let end = null;
      for (let i = 0; i < 40; i++) { await pg.waitForTimeout(150); end = await pg.evaluate(() => ({ x: window.__lumenfall.player.body.x / 8, dead: window.__lumenfall.player.dead })); if (end.dead || end.x > info.z + 3) break; }
      await pg.keyboard.up('ArrowRight'); await pg.close();
      return { info, end };
    };
    const inB = await walk(true), inA = await walk(false);
    check('W12 in world B you can walk across the first hole', inB.info.shifted === true && !inB.end.dead && inB.end.x > inB.info.z, JSON.stringify(inB));
    check('W13 in world A the same walk falls into the pit', inA.end.dead === true, JSON.stringify(inA));

    // ---- keyboard E shifts in L2 but not in L1
    const k = await open('?level=2');
    await k.evaluate(() => { const g = window.__lumenfall; g.level.shiftCd = 0; g.player.body.x = 20 * 8; g.player.body.y = 33; });
    await k.waitForTimeout(500); await k.keyboard.press('e'); await k.waitForTimeout(400);
    const w2 = await k.evaluate(() => window.__lumenfall.level.world);
    await k.screenshot({ path: '.scratch/shift-B.png' });
    await k.close();
    const k1 = await open('?level=1');
    await k1.keyboard.press('e'); await k1.waitForTimeout(400);
    const w1 = await k1.evaluate(() => ({ w: window.__lumenfall.level.world, c: window.__lumenfall.level.shiftCount }));
    await k1.close();
    check('W14 pressing E shifts the world in L2', w2 === 1, `world=${w2}`);
    check('W15 pressing E does nothing in L1', w1.w === 0 && w1.c === 0, JSON.stringify(w1));
  }
  await page.close();
} catch (e) {
  console.log('GATE-INTERNAL-ERROR ' + e.message); await browser.close(); process.exit(2);
}
await browser.close();
check('W16 no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
let failed = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); if (!r.ok) failed++; }
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
