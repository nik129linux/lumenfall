// Stage 3a gate: damage is real, and hits have weight (hitstop, shake, stagger).
// Run: node tools/gate3a.mjs   (game served on GATE_URL, default http://localhost:8765)
// Every check is independent and reports its own numbers; exit code 1 on any failure.
import { chromium } from 'playwright';

const URL = process.env.GATE_URL || 'http://localhost:8765/index.html';
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); };
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const errors = [];

async function open(query) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${URL}${query}`);
  await page.waitForTimeout(3500);
  return page;
}

try {
  // ---- A. Kael takes real damage, once per hit
  {
    const page = await open('?level=1');
    const start = await page.evaluate(() => window.__lumenfall.hp);
    check('A1 starts with 5 hp', start === 5, `hp=${start}`);

    const r = await page.evaluate(async () => {
      const g = window.__lumenfall, p = g.player;
      p.hurtTimer = 0; p.hurt();
      let maxHit = 0, maxOv = 0, maxSh = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 700) {
        maxHit = Math.max(maxHit, g.hitstop || 0);
        maxOv = Math.max(maxOv, g.hurtOverlay || 0);
        maxSh = Math.max(maxSh, g.cam.shake || 0);
        await new Promise((res) => requestAnimationFrame(res));
      }
      return { hp: g.hp, maxHit, maxOv, maxSh, ev: p.hurtEvent };
    });
    check('A2 one hit costs exactly 1 hp (not 1 per frame)', r.hp === 4, `hp=${r.hp}`);
    check('A3 hurt gives hitstop >= 0.09 s', r.maxHit >= 0.09, `max hitstop=${r.maxHit.toFixed(3)}`);
    check('A4 hurt gives a red overlay >= 0.5', r.maxOv >= 0.5, `max hurtOverlay=${r.maxOv.toFixed(2)}`);
    check('A5 hurt shakes the camera >= 4', r.maxSh >= 4, `max shake=${r.maxSh.toFixed(2)}`);
    check('A6 hurtEvent is consumed', r.ev === false, `hurtEvent=${r.ev}`);

    const dead = await page.evaluate(async () => {
      const g = window.__lumenfall, p = g.player;
      let sawDead = false;
      for (let i = 0; i < 4; i++) {
        p.hurtTimer = 0; p.hurt();
        const t0 = performance.now();
        while (performance.now() - t0 < 450) {
          if (p.dead || g.hp === 0) sawDead = true;
          await new Promise((res) => requestAnimationFrame(res));
        }
      }
      const t1 = performance.now();
      while (performance.now() - t1 < 800) {
        if (p.dead || g.hp === 0) sawDead = true;
        await new Promise((res) => requestAnimationFrame(res));
      }
      return { sawDead, hp: g.hp };
    });
    check('A7 five hits kill Kael', dead.sawDead, `sawDead=${dead.sawDead} hp=${dead.hp}`);
    await page.close();
  }

  // ---- B. hitting an enemy has weight
  {
    const page = await open('?level=1');
    const r = await page.evaluate(async () => {
      const g = window.__lumenfall, p = g.player;
      const e = g.enemies.find((x) => !x.dead && x.mesh);
      if (!e) return { noEnemy: true };
      p.facing = 1;
      const ar = p.attackRect();
      e.body.x = ar.left + 2; e.body.y = ar.bottom;
      e.staggerTimer = 0;
      const hp0 = e.hp, vx0 = e.body.vx;
      g.hitstop = 0; g.cam.shake = 0;
      g._resolvePlayerHit();
      const out = { dhp: hp0 - e.hp, hit: g.hitstop, shake: g.cam.shake, stagger: e.staggerTimer, dvx: e.body.vx - vx0 };

      // freeze: with hitstop owed the player must not move; after it, must move.
      g.hitstop = 5; p.body.vx = 100;
      const x0 = p.body.x;
      await new Promise((res) => setTimeout(res, 400));
      const x1 = p.body.x;
      g.hitstop = 0;
      await new Promise((res) => setTimeout(res, 250));
      const x2 = p.body.x;
      return { ...out, frozenMove: Math.abs(x1 - x0), resumedMove: Math.abs(x2 - x1) };
    });
    if (r.noEnemy) {
      check('B0 level 1 has an enemy to test', false, 'g.enemies has no live enemy');
    } else {
      check('B1 a hit costs the enemy 1 hp', r.dhp === 1, `dhp=${r.dhp}`);
      check('B2 enemy hit gives hitstop >= 0.045 s', r.hit >= 0.045, `hitstop=${r.hit.toFixed(3)}`);
      check('B3 enemy hit shakes the camera >= 1.8', r.shake >= 1.8, `shake=${r.shake.toFixed(2)}`);
      check('B4 enemy is staggered >= 0.15 s', r.stagger >= 0.15, `staggerTimer=${r.stagger}`);
      check('B5 enemy is knocked back >= 80 px/s', r.dvx >= 80, `dvx=${r.dvx.toFixed(1)}`);
      check('B6 the world is frozen while hitstop is owed', r.frozenMove < 0.01, `moved ${r.frozenMove.toFixed(3)} px`);
      check('B7 the world resumes after hitstop', r.resumedMove > 1, `moved ${r.resumedMove.toFixed(2)} px`);
    }
    await page.close();
  }

  // ---- C. hitting the boss has more weight, the killing blow the most
  {
    const page = await open('?level=1&boss=1');
    const r = await page.evaluate(async () => {
      const g = window.__lumenfall, p = g.player, b = g.boss;
      if (!b) return { noBoss: true };
      b.wake && b.wake();
      const place = () => {
        p.facing = 1;
        const ar = p.attackRect();
        b.body.x = ar.left + 2; b.body.y = ar.bottom;
      };
      b.hp = 12; place(); g.hitstop = 0; g.cam.shake = 0;
      g._resolvePlayerHit();
      const normal = { hit: g.hitstop, shake: g.cam.shake, hp: b.hp };
      b.hp = 1; place(); g.hitstop = 0; g.cam.shake = 0;
      g._resolvePlayerHit();
      const kill = { hit: g.hitstop, shake: g.cam.shake, dead: b.dead };
      return { normal, kill };
    });
    if (r.noBoss) {
      check('C0 ?boss=1 spawns a boss', false, 'g.boss is null');
    } else {
      check('C1 boss hit: hitstop in [0.065, 0.1)', r.normal.hit >= 0.065 && r.normal.hit < 0.1, `hitstop=${r.normal.hit.toFixed(3)}`);
      check('C2 boss hit shakes >= 3.2', r.normal.shake >= 3.2, `shake=${r.normal.shake.toFixed(2)}`);
      check('C3 boss hit costs 1 hp', r.normal.hp === 11, `hp=${r.normal.hp}`);
      check('C4 killing blow: boss dies and hitstop >= 0.15', r.kill.dead && r.kill.hit >= 0.15, `dead=${r.kill.dead} hitstop=${r.kill.hit.toFixed(3)}`);
      check('C5 killing blow shakes >= 5.5', r.kill.shake >= 5.5, `shake=${r.kill.shake.toFixed(2)}`);
    }
    await page.close();
  }
} catch (e) {
  console.log('GATE-INTERNAL-ERROR ' + e.message);
  await browser.close();
  process.exit(2);
}
await browser.close();

check('D1 no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
  if (!r.ok) failed++;
}
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
