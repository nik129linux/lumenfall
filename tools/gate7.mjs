// Stage 7 gate: metrics (see docs/stage7.md). Run: node tools/gate7.mjs
import { chromium } from 'playwright';
const URL = process.env.GATE_URL || 'http://localhost:8765/index.html';
const results = [], errors = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const browser = await chromium.launch({ args: ['--use-gl=angle'] });
const KEY = 'lumenfall.metrics.v1';
async function open(query, { init, ctx } = {}) {
  const context = ctx || await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (init) await page.addInitScript(init);
  await page.goto(`${URL}${query}`);
  await page.waitForTimeout(3500);
  return { page, context };
}
try {
  // A. API, summary maths, gtag forwarding, persistence
  {
    const { page, context } = await open('?level=1', { init: 'window.gtag = function(){ (window.__gt = window.__gt || []).push([].slice.call(arguments)); };' });
    const r = await page.evaluate(() => {
      const m = window.__lumenfall.metrics;
      if (!m || typeof m.track !== 'function' || typeof m.summary !== 'function' || typeof m.reset !== 'function') return { noApi: true };
      m.reset();
      m.track('level_start', { level: 1 }); m.track('level_start', { level: 1 });
      m.track('level_complete', { level: 1, seconds: 60, deaths: 2 });
      m.track('player_death', { level: 1, zone: 3, cause: 'hp' }); m.track('player_death', { level: 1, zone: 3, cause: 'pit' });
      m.track('boss_defeated', { boss: 'statue', seconds: 60, deaths: 2 });
      return { s: m.summary(), gt: (window.__gt || []).map((a) => a[1]) };
    });
    if (r.noApi) check('A0 window.__lumenfall.metrics has track, summary, reset', false, 'missing');
    else {
      const s = r.s;
      check('A1 levelStarts[1] = 2 and levelCompletes[1] = 1', s.levelStarts[1] === 2 && s.levelCompletes[1] === 1, JSON.stringify([s.levelStarts, s.levelCompletes]));
      check('A2 completionRate[1] = 0.5', s.completionRate[1] === 0.5, `rate=${s.completionRate[1]}`);
      check('A3 deathsByLevel[1] = 2 and deathsByZone["1:3"] = 2', s.deathsByLevel[1] === 2 && s.deathsByZone['1:3'] === 2, JSON.stringify([s.deathsByLevel, s.deathsByZone]));
      check('A4 avgSecondsByLevel[1] = 60', s.avgSecondsByLevel[1] === 60, `avg=${s.avgSecondsByLevel[1]}`);
      check('A5 bossesDefeated.statue = 1 and all keys exist', s.bossesDefeated.statue === 1 && s.bossesDefeated.ulburjo === 0 && s.bossesDefeated.patientone === 0 && s.levelStarts[3] === 0 && s.gamesCompleted === 0, JSON.stringify(s.bossesDefeated));
      check('A6 events are forwarded to window.gtag', r.gt.includes('player_death') && r.gt.includes('level_start'), `forwarded=${r.gt.join(',')}`);
    }
    await page.reload(); await page.waitForTimeout(3500);
    const after = await page.evaluate(() => (window.__lumenfall.metrics?.summary().deathsByLevel[1] ?? -1));
    check('A7 metrics survive a reload (localStorage)', after >= 2, `deathsByLevel[1]=${after}`);
    await context.close();
  }
  // B. wiring: session, level start, death (once), boss defeated (once)
  {
    const { page, context } = await open('?level=2');
    const ev = await page.evaluate(() => (window.__lumenfall.metrics?.events ?? []).map((e) => ({ name: e.name, level: e.level })));
    check('B1 session_start is tracked', ev.some((e) => e.name === 'session_start'), JSON.stringify(ev.slice(0, 4)));
    check('B2 level_start {level:2} is tracked on ?level=2', ev.some((e) => e.name === 'level_start' && e.level === 2), JSON.stringify(ev.slice(0, 4)));
    await page.evaluate(() => window.__lumenfall.player.kill());
    await page.waitForTimeout(1800);
    const deaths = await page.evaluate(() => (window.__lumenfall.metrics?.events ?? []).filter((e) => e.name === 'player_death'));
    check('B3 one death = exactly one player_death with level, zone, cause', deaths.length === 1 && deaths[0].level === 2 && typeof deaths[0].zone === 'number' && ['hp', 'pit'].includes(deaths[0].cause), JSON.stringify(deaths));
    await context.close();
    const b = await open('?level=1&boss=1');
    await b.page.evaluate(() => { const g = window.__lumenfall; g.boss.wake && g.boss.wake(); g.boss.hurt(9999); });
    await b.page.waitForTimeout(3500);
    const bd = await b.page.evaluate(() => (window.__lumenfall.metrics?.events ?? []).filter((e) => e.name === 'boss_defeated'));
    check('B4 killing the boss tracks boss_defeated once with boss="statue"', bd.length === 1 && bd[0].boss === 'statue' && typeof bd[0].seconds === 'number', JSON.stringify(bd));
    await b.context.close();
  }
  // C. the screen, seeded from localStorage; and no Google request when the id is empty
  {
    const seed = `localStorage.setItem('${KEY}', JSON.stringify({events:[
      {name:'session_start',t:1},{name:'level_start',t:2,level:1},{name:'level_start',t:3,level:1},
      {name:'level_complete',t:4,level:1,seconds:75,deaths:2},{name:'player_death',t:5,level:1,zone:3,cause:'hp'}]}));`;
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const googleReqs = [];
    ctx.on('request', (r) => { if (/googletagmanager|google-analytics/.test(r.url())) googleReqs.push(r.url()); });
    const { page } = await open('', { init: seed, ctx });
    const visibleBefore = await page.evaluate(() => { const p = document.getElementById('metrics-panel'); return !!p && getComputedStyle(p).display !== 'none'; });
    check('C1 the panel exists and is hidden at first', visibleBefore === false && await page.evaluate(() => !!document.getElementById('metrics-panel')), `visible=${visibleBefore}`);
    const btn = await page.$('#menu-metrics');
    check('C2 the menu has a #menu-metrics button', !!btn, '');
    if (btn) {
      await btn.click(); await page.waitForTimeout(400);
      const txt = await page.evaluate(() => { const p = document.getElementById('metrics-panel'); return p && getComputedStyle(p).display !== 'none' ? p.innerText : null; });
      check('C3 clicking it shows the panel with "50%"', txt !== null && txt.includes('50%'), txt === null ? 'panel not visible' : txt.replace(/\s+/g, ' ').slice(0, 160));
      check('C4 the panel shows the average time 1:15 and zone 1:3', txt !== null && txt.includes('1:15') && txt.includes('1:3'), '');
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      const after = await page.evaluate(() => { const p = document.getElementById('metrics-panel'); return p && getComputedStyle(p).display !== 'none'; });
      check('C5 Escape closes the panel', after === false, `visible=${after}`);
    }
    check('C6 no request to Google while the measurement id is empty', googleReqs.length === 0, googleReqs.join(','));
    await ctx.close();
  }
} catch (e) {
  console.log('GATE-INTERNAL-ERROR ' + e.message); await browser.close(); process.exit(2);
}
await browser.close();
check('D1 no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
let failed = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); if (!r.ok) failed++; }
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
