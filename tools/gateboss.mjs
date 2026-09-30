// Generic boss gate (windup/active/recover contract from docs/stage3b.md).
// Usage: node tools/gateboss.mjs '<json config>'  config: {level, p1:[names], p2:'name', p2min:0.7, rotate:bool}   (GATE_URL overrides http://localhost:8765/index.html)
import { chromium } from 'playwright';

const URL = process.env.GATE_URL || 'http://localhost:8765/index.html';
const CFG = JSON.parse(process.argv[2] || '{}');
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle'] });

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${URL}?level=${CFG.level}&boss=1`);
  await page.waitForTimeout(3500);

  const r = await page.evaluate(async () => {
    const g = window.__lumenfall, p = g.player, b = g.boss;
    if (!b) return { noBoss: true };
    b.wake && b.wake();
    const frame = () => new Promise((res) => requestAnimationFrame(res));
    const overlap = () => p.body.left < b.body.right && p.body.right > b.body.left &&
                          p.body.bottom < b.body.top && p.body.top > b.body.bottom;
    const st = { winFrames: 0, winTele: 0, badHits: [], hasAtk: typeof b.atk !== 'undefined' && Array.isArray(b.atkLog) };
    if (!st.hasAtk) return { st, noContract: true };
    let lastHp = g.hp;
    const watch = async (ms, until) => {
      const t0 = performance.now();
      while (performance.now() - t0 < ms && !until()) {
        g.hp = 5;                                   // keep Kael alive; only drops are recorded
        if (b.atk && b.atk.stage === 'windup') { st.winFrames++; if (g.fx.telegraphs && g.fx.telegraphs.length > 0) st.winTele++; }
        await frame();
        if (g.hp < lastHp) {                        // a hit landed this frame
          const stage = b.atk ? b.atk.stage : null;
          if ((stage === 'windup' || stage === 'recover') && !overlap()) st.badHits.push(stage);
        }
        lastHp = g.hp;
      }
    };
    // phase 1: stand next to the boss and let it work
    p.body.x = b.cx - 60; p.body.y = 32;
    await watch(60000, () => b.atkLog.filter((e) => e.stage === 'recover').length >= 4);
    const phase1 = b.atkLog.slice();
    // phase 2
    b.hurt(Math.ceil(b.maxHp * 0.5));
    p.body.x = b.cx - 90; p.body.y = 32;
    await watch(70000, () => b.atkLog.some((e) => e.name === CFG.p2 && e.phase >= 2 && e.stage === 'active'));
    const all = b.atkLog.slice();
    // death cleans up
    b.hurt(9999);
    await watch(2500, () => false);
    return { st, phase1, all, rot: g.level.rotCount || 0, atkAfterDeath: b.atk, teleAfterDeath: g.fx.telegraphs.length, dead: b.dead };
  });

  if (r.noBoss) check('E0 ?boss=1 spawns the boss', false, 'g.boss is null');
  else if (r.noContract) check('E0 boss exposes atk and atkLog', false, 'the boss class must define this.atk (null|object) and this.atkLog (array), see js/game/boss/statue.js');
  else {
    const seqOk = (log) => {
      const by = [];
      let cur = null;
      for (const e of log) { if (e.stage === 'windup') { cur = { name: e.name, stages: ['windup'], dur: e.dur, phase: e.phase }; by.push(cur); } else if (cur) cur.stages.push(e.stage); }
      return by;
    };
    const attacks = seqOk(r.phase1);
    const complete = attacks.filter((a) => a.stages.join() === 'windup,active,recover');
    check('E1 at least 3 complete attacks in phase 1', complete.length >= 3, `complete=${complete.length} of ${attacks.length}`);
    check('E2 stages always in order windup,active,recover', attacks.every((a) => ['windup', 'windup,active', 'windup,active,recover'].includes(a.stages.join())), attacks.map((a) => a.stages.join('>')).join(' | '));
    const p1 = attacks.filter((a) => a.phase === 1);
    check('E3 every phase-1 windup lasts >= 0.5 s', p1.length > 0 && p1.every((a) => a.dur >= 0.5), `durs=${p1.map((a) => a.dur.toFixed(2)).join(',')}`);
    check('E4 no damage during windup or recover (unless touching the body)', r.st.badHits.length === 0, `bad=${r.st.badHits.join(',')}`);
    check('E5 a telegraph marker is up during >= 90% of windup frames', r.st.winFrames > 0 && r.st.winTele / r.st.winFrames >= 0.9, `${r.st.winTele}/${r.st.winFrames}`);
    const p2 = r.all.filter((e) => e.name === CFG.p2 && e.stage === 'windup');
    check(`E6 phase 2 uses '${CFG.p2}' (phase>=2) with windup >= ${CFG.p2min} s`, p2.some((e) => e.phase >= 2 && e.dur >= CFG.p2min), `windups=${p2.map((e) => e.phase + ':' + e.dur.toFixed(2)).join(',') || 'none'}`);
    check('E7 phase-1 attacks only use the names ' + CFG.p1.join('/'), attacks.filter((a) => a.phase === 1).every((a) => CFG.p1.includes(a.name)), `seen=${[...new Set(attacks.map((a) => a.name))].join(',')}`);
    if (CFG.rotate) check('E7b the rotate attack really rotates the room (level.rotCount >= 1)', r.rot >= 1, `rotCount=${r.rot}`);
    check('E8 boss died', r.dead, `dead=${r.dead}`);
    check('E9 after death atk is null and no markers remain', r.atkAfterDeath === null && r.teleAfterDeath === 0, `atk=${JSON.stringify(r.atkAfterDeath)} markers=${r.teleAfterDeath}`);
  }
} catch (e) {
  console.log('GATE-INTERNAL-ERROR ' + e.message);
  await browser.close();
  process.exit(2);
}
await browser.close();
check('F1 no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

let failed = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); if (!r.ok) failed++; }
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
