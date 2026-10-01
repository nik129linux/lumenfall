// Stage 11 gate: ?cutscene=KEY plays that cutscene. Run: node tools/gate11.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.GATE_URL || 'http://localhost:8765/index.html';
const WANT = { prologue: ['01', '01', '02', '02'], theft: ['05', '05', '10', '06'], reveal: ['11', '12', '13'], waking: ['14', '14', '15'], return: ['16', '17', '18', '19', '19'] };
const results = [], errors = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
try {
  for (const [key, want] of Object.entries(WANT)) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    page.on('pageerror', (e) => errors.push(`${key} pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${key} console: ${m.text()}`); });
    await page.goto(`${URL}?cutscene=${key}`);
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => { const g = window.__lumenfall; return { active: g.cutscene.active, arts: (g.cutscene.lines || []).map((l) => l.art), state: g.machine.state }; });
    check(`K-${key} plays immediately with panels ${want.join(',')}`, r.active === true && JSON.stringify(r.arts) === JSON.stringify(want), `active=${r.active} arts=${JSON.stringify(r.arts)}`);
    if (key === 'reveal') {
      await page.screenshot({ path: '.scratch/gate11-reveal.png' });
      await page.keyboard.press('Escape'); await page.waitForTimeout(1500);
      const after = await page.evaluate(() => { const g = window.__lumenfall; const b = document.getElementById('menu-new'); return { active: g.cutscene.active, menuVisible: !!b && getComputedStyle(b).display !== 'none' && b.offsetParent !== null }; });
      check('K-esc Esc ends the cutscene and shows the menu (no level starts)', after.active === false && after.menuVisible, JSON.stringify(after));
    }
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => errors.push('bogus pageerror: ' + e.message));
  await page.goto(`${URL}?cutscene=bogus`); await page.waitForTimeout(2500);
  const menu = await page.evaluate(() => { const b = document.getElementById('menu-new'); return !!b && b.offsetParent !== null && !window.__lumenfall.cutscene.active; });
  check('K-bogus an unknown key just opens the menu', menu, '');
} catch (e) {
  console.log('GATE-INTERNAL-ERROR ' + e.message); await browser.close(); process.exit(2);
}
await browser.close();
check('K-err no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
let failed = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); if (!r.ok) failed++; }
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
