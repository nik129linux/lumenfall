// Stage 6 gate: the reveal, waking and return cutscenes use the painted panels 11-19.
import { chromium } from 'playwright';
const URL = process.env.GATE_URL || 'http://localhost:8765/index.html';
const EXPECT = {
  reveal: ['11', '12', '13'],
  waking: ['14', '14', '15'],
  return: ['16', '17', '18', '19', '19'],
};
const results = [], errors = [], requested = new Set();
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', (r) => { const m = r.url().match(/assets\/cutscenes\/(\d+)\.png/); if (m) requested.add(m[1]); });
  await page.goto(`${URL}?level=1`);
  await page.waitForTimeout(3500);
  const seqs = await page.evaluate(async () => {
    const g = window.__lumenfall, out = {};
    for (const key of ['reveal', 'waking', 'return']) {
      let done = false;
      g.playCutscene(key, () => { done = true; });
      const seen = []; let last = -1;
      for (let k = 0; k < 120 && g.cutscene.active; k++) {
        const i = g.cutscene.index;
        if (i !== last) { seen.push(g.cutscene.current ? g.cutscene.current.art : null); last = i; }
        g.cutscene.advance();
        await new Promise((r) => setTimeout(r, 70));
      }
      out[key] = seen;
    }
    return out;
  });
  for (const [key, want] of Object.entries(EXPECT)) {
    check(`G1 ${key} uses panels ${want.join(',')}`, JSON.stringify(seqs[key]) === JSON.stringify(want), `got=${JSON.stringify(seqs[key])}`);
  }
  await page.waitForTimeout(1500);
  const missing = ['11', '12', '13', '14', '15', '16', '17', '18', '19'].filter((id) => !requested.has(id));
  check('G2 panels 11-19 are requested (preloaded)', missing.length === 0, `never requested: ${missing.join(',') || 'none'}`);
  const statuses = await page.evaluate(async () => {
    const out = {};
    for (let n = 11; n <= 19; n++) { const r = await fetch(`assets/cutscenes/${n}.png`); out[n] = r.status; }
    return out;
  });
  const bad = Object.entries(statuses).filter(([, s]) => s !== 200);
  check('G3 all nine files load (HTTP 200)', bad.length === 0, bad.map(([n, s]) => `${n}:${s}`).join(',') || 'ok');
} catch (e) {
  console.log('GATE-INTERNAL-ERROR ' + e.message); await browser.close(); process.exit(2);
}
await browser.close();
check('G4 no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
let failed = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); if (!r.ok) failed++; }
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
