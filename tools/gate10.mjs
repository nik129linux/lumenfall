// Stage 10 gate: the cutscene after each boss is the right one. Run: node tools/gate10.mjs
import { chromium } from 'playwright';
const URL = process.env.GATE_URL || 'http://localhost:8765/index.html';
const results = [], errors = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${URL}?level=1&boss=1`);
  await page.waitForTimeout(3500);
  const r = await page.evaluate(async () => {
    const g = window.__lumenfall, out = [];
    for (let i = 0; i < 3; i++) {
      g.cutscene.active = false;
      g._onBossDefeated();
      await new Promise((res) => setTimeout(res, 1200));
      out.push({ arts: (g.cutscene.lines || []).map((l) => l.art), levelId: g.levelDef.id, levelIndex: g.levelIndex });
    }
    const src = await (await fetch('js/main.js')).text();
    const cs = await (await fetch('js/ui/cutscene.js')).text();
    return { out, hasTheftFallback: /\|\|\s*'theft'/.test(src), hasOldIntro: /intro:\s*\[/.test(cs), starts: (g.metrics?.events ?? []).filter((e) => e.name === 'level_complete').length };
  });
  const want = [['11', '12', '13'], ['14', '14', '15'], ['16', '17', '18', '19', '19']];
  want.forEach((w, i) => check(`H${i + 1} after boss ${i + 1} the cutscene uses panels ${w.join(',')}`, JSON.stringify(r.out[i].arts) === JSON.stringify(w), `got=${JSON.stringify(r.out[i].arts)}`));
  check('H4 after boss 1 level 2 is loaded, after boss 2 level 3 is loaded', r.out[0].levelId === 2 && r.out[1].levelId === 3, `levels=${r.out.map((o) => o.levelId).join(',')}`);
  check('H5 no silent fallback to the theft cutscene', !r.hasTheftFallback, '');
  check('H6 the old gradient intro script is gone', !r.hasOldIntro, '');
  check('H7 level_complete is still tracked for every boss', r.starts >= 3, `level_complete events=${r.starts}`);
} catch (e) {
  console.log('GATE-INTERNAL-ERROR ' + e.message); await browser.close(); process.exit(2);
}
await browser.close();
check('H8 no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
let failed = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); if (!r.ok) failed++; }
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
