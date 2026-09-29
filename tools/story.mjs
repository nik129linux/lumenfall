// Stage 2 acceptance: menu -> Nueva partida -> prologue -> walk to the elder ->
// the deal -> the theft -> control back.
//
//   python3 -m http.server 8765
//   node tools/story.mjs
//
// Screenshots land in .scratch/stage2/. Nine checks, all of which must pass:
//
//   1  prologue-01.png    panel 01 still, its text, letterbox bars
//   2  elder-waiting.png  elder on the ground at x=30 tiles, facing left, no enemy
//   3  deal-portraits.png both portraits and a speaker name
//   4  deal-panel-04.png  panel 04 over the level on a Kael line
//   5  theft-06.png       panel 06 with Kael's line
//   6  after.png          control back, elder gone, green puff visible
//   7  deal-portraits-en.png  the same beat in English
//   8  Esc during the prologue skips straight to L1 play
//   9  zero console errors
//
// Exits 1 on any failure.

import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:8765/index.html';
const OUT = '.scratch/stage2';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

function watch(page, errors) {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
}

// waitForFunction takes (fn, arg, options) -- arg first.
const waitState = (page, want, timeout = 25000) =>
  page.waitForFunction((s) => window.__lumenfall?.machine?.state === s, want, { timeout });

const state = (page) => page.evaluate(() => window.__lumenfall?.machine?.state);

// What the DOM is actually showing right now.
const dom = (page) => page.evaluate(() => {
  const g = window.__lumenfall;
  const on = (sel) => document.querySelector(sel);
  const layer = document.querySelector('#panel-art .panel-layer.on')
    || document.querySelector('#story-panel .panel-layer.on');
  return {
    cutArt: document.getElementById('panel-art').dataset.art || '',
    cutLine: document.getElementById('type-line').textContent,
    cutTitle: document.getElementById('cut-title').textContent,
    storyOn: !!document.querySelector('#story.on'),
    storySpeaker: document.getElementById('story-speaker').textContent,
    storyLine: document.getElementById('story-line').textContent,
    storyPanelArt: document.getElementById('story-panel')?.dataset.art || '',
    // Portraits are CSS background crops of the cutscene paintings, so what
    // matters is the resolved background image and the frame's real size.
    portrait: ['portrait-kael', 'portrait-elder'].map((id) => {
      const n = document.getElementById(id);
      if (!n) return null;
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      return { img: cs.backgroundImage.split('/').pop().replace('")', ''), w: Math.round(r.width), h: Math.round(r.height) };
    }),
    barH: on('#cutscene.on .bar.top') ? on('#cutscene.on .bar.top').getBoundingClientRect().height : 0,
    storyBarH: on('#story.on .bar.top') ? on('#story.on .bar.top').getBoundingClientRect().height : 0,
    panelImg: layer ? (layer.querySelector('.panel-img')?.getAttribute('src') || '') : '',
    state: g?.machine?.state,
    cutActive: !!g?.cutscene?.active,
    storyActive: !!g?.story,
    elder: g?.elder ? {
      x: Math.round(g.elder.x), tile: Math.round(g.elder.x / 8),
      facing: g.elder.sprite.facing, y: Math.round(g.elder.y),
    } : null,
    nearEnemy: g ? g.enemies.filter((e) => Math.abs(e.x - (g.elder?.x ?? -999)) < 20 * 8).length : -1,
  };
});

// ---------------------------------------------------------------- run 1: ES
const errors = [];
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
watch(page, errors);
await page.goto(URL, { waitUntil: 'load' });
await waitState(page, 'menu');
await page.click('#menu-new');

// ---- 1. prologue, panel 01
await waitState(page, 'cutscene');
await new Promise((r) => setTimeout(r, 1400));
let d = await dom(page);
await page.screenshot({ path: `${OUT}/prologue-01.png` });
check('1 prologue shows panel 01 still with its text and letterbox bars',
  d.state === 'cutscene' && d.cutActive && d.cutArt === '01'
  && d.panelImg.endsWith('cutscenes/01.png') && d.barH > 10 && d.cutLine.length > 20,
  `art=${d.cutArt} img=${d.panelImg} bar=${Math.round(d.barH)}px line="${d.cutLine.slice(0, 34)}..."`);

// ---- 8. Esc skips the prologue straight into play
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 900));
const afterEsc = await state(page);
const cutOff = await page.evaluate(() => !window.__lumenfall.cutscene.active);
check('8 Esc during the prologue skips straight to L1 play',
  afterEsc === 'play' && cutOff, `state=${afterEsc} cutsceneActive=${!cutOff}`);
console.log('     (logged: Esc -> ' + afterEsc + ', cutscene ' + (cutOff ? 'ended' : 'still active') + ')');

// ---- 2. the elder, before the trigger
d = await dom(page);
await page.screenshot({ path: `${OUT}/elder-waiting.png` });
check('2 elder waits on the ground at x=30 tiles, facing left, no enemy near',
  d.elder && d.elder.tile === 30 && d.elder.facing === -1 && d.elder.y === 32
  && d.nearEnemy === 0 && !d.storyActive,
  `x=${d.elder?.x} tile=${d.elder?.tile} facing=${d.elder?.facing} y=${d.elder?.y} enemiesWithin20t=${d.nearEnemy}`);

// ---- walk right until the deal triggers
await page.keyboard.down('ArrowRight');
await page.waitForFunction(() => window.__lumenfall?.machine?.state === 'story', { timeout: 20000 })
  .then(() => true, () => false);
const reached = await state(page);
await page.keyboard.up('ArrowRight');
check('   (deal triggers on proximity within 28px)', reached === 'story', `state=${reached}`);

// ---- 3. the deal: both portraits and a speaker name
await new Promise((r) => setTimeout(r, 1500));   // camera ease + typing
d = await dom(page);
await page.screenshot({ path: `${OUT}/deal-portraits.png` });
const portraitsOk = d.portrait.length === 2
  && d.portrait.every((p) => p && /0[34]\.png/.test(p.img) && p.w === 96 && p.h === 96);
check('3 in-game deal shows both painted portraits at 96x96, a speaker name and letterbox bars',
  d.state === 'story' && d.storyOn && d.storyBarH > 10 && portraitsOk
  && d.storySpeaker.length > 0 && d.storyLine.length > 10,
  `speaker="${d.storySpeaker}" line="${d.storyLine.slice(0, 30)}..." portraits=${d.portrait.map((p) => p && `${p.img.replace('")','')}@${p.w}x${p.h}`).join(' ')} bar=${Math.round(d.storyBarH)}px`);

// ---- 4. panel 04 over the level, on a Kael line
// Walk the deal forward until a panel-04 line is showing.
let sawPanel04 = null;
for (let i = 0; i < 8; i++) {
  await page.keyboard.press('KeyZ');            // completes the typed line
  await new Promise((r) => setTimeout(r, 260));
  await page.keyboard.press('KeyZ');            // advances
  await new Promise((r) => setTimeout(r, 520));
  d = await dom(page);
  if (d.storyPanelArt === '04' && d.storySpeaker === 'Kael') { sawPanel04 = d; break; }
}
await page.screenshot({ path: `${OUT}/deal-panel-04.png` });
check('4 deal shows panel 04 over the level on a Kael line',
  !!sawPanel04 && sawPanel04.storyPanelArt === '04' && sawPanel04.storyActive,
  sawPanel04
    ? `panel=${sawPanel04.storyPanelArt} speaker="${sawPanel04.storySpeaker}" line="${sawPanel04.storyLine.slice(0, 26)}..."`
    : 'never reached a panel-04 Kael line');

// ---- 5. the theft, panel 06 with Kael's line
for (let i = 0; i < 8; i++) {                     // finish the deal
  if ((await state(page)) !== 'story') break;
  await page.keyboard.press('KeyZ');
  await new Promise((r) => setTimeout(r, 240));
  await page.keyboard.press('KeyZ');
  await new Promise((r) => setTimeout(r, 420));
}
await page.waitForFunction(() => window.__lumenfall?.cutscene?.active, { timeout: 15000 })
  .then(() => true, () => false);
let saw06 = null;
for (let i = 0; i < 10; i++) {
  d = await dom(page);
  if (d.cutArt === '06' && d.cutTitle === 'Kael') { saw06 = d; break; }
  await page.keyboard.press('KeyZ');
  await new Promise((r) => setTimeout(r, 700));
}
await page.screenshot({ path: `${OUT}/theft-06.png` });
check('5 theft shows panel 06 with Kael\'s line',
  !!saw06, saw06 ? `art=${saw06.cutArt} title="${saw06.cutTitle}" line="${saw06.cutLine.slice(0, 30)}..."` : 'never reached panel 06');

// The theft is still on its last line: finish it so control comes back.
for (let i = 0; i < 6; i++) {
  if (!(await page.evaluate(() => window.__lumenfall.cutscene.active))) break;
  await page.keyboard.press('KeyZ');
  await new Promise((r) => setTimeout(r, 350));
}

// ---- 6. control back, elder gone, green puff visible
await page.waitForFunction(() => window.__lumenfall?.machine?.state === 'play'
  && !window.__lumenfall?.cutscene?.active, { timeout: 20000 }).then(() => true, () => false);
await new Promise((r) => setTimeout(r, 200));
const after = await page.evaluate(() => {
  const g = window.__lumenfall;
  // Count live green particles near where the elder stood.
  let green = 0;
  for (const p of g.fx.items) {
    if (p.life <= 0 || !p.mesh.visible) continue;
    const c = p.mesh.material.color;
    if (c.g > c.r && c.g > c.b) green++;
  }
  return { state: g.machine.state, elder: g.elder, green };
});
await page.screenshot({ path: `${OUT}/after.png` });
check('6 control is back, the elder is gone, and the green puff is visible',
  after.state === 'play' && after.elder === null && after.green > 0,
  `state=${after.state} elder=${after.elder} greenParticles=${after.green}`);

await page.close();

// ---------------------------------------------------------------- run 2: EN
const enErrors = [];
const pageEn = await browser.newPage({ viewport: { width: 960, height: 540 } });
watch(pageEn, enErrors);
await pageEn.addInitScript(() => {
  try { localStorage.setItem('lumenfall.lang', 'en'); } catch (e) { /* private mode */ }
});
await pageEn.goto(URL, { waitUntil: 'load' });
await waitState(pageEn, 'menu');
await pageEn.click('#menu-new');
await waitState(pageEn, 'cutscene');
await new Promise((r) => setTimeout(r, 300));
await pageEn.keyboard.press('Escape');            // skip to play
await new Promise((r) => setTimeout(r, 700));
await pageEn.keyboard.down('ArrowRight');
await pageEn.waitForFunction(() => window.__lumenfall?.machine?.state === 'story', { timeout: 20000 })
  .then(() => true, () => false);
await pageEn.keyboard.up('ArrowRight');
await new Promise((r) => setTimeout(r, 1500));
const dEn = await dom(pageEn);
await pageEn.screenshot({ path: `${OUT}/deal-portraits-en.png` });
check('7 the same deal beat in English shows the English line and speaker',
  dEn.state === 'story' && dEn.storyOn && dEn.storyLine.length > 10
  && /[A-Za-z]/.test(dEn.storyLine) && !/[¿¡]/.test(dEn.storyLine),
  `speaker="${dEn.storySpeaker}" line="${dEn.storyLine.slice(0, 40)}..."`);

await pageEn.close();
await browser.close();

// ---------------------------------------------------------------- 9. errors
const allErrors = [...errors, ...enErrors];
check('9 zero console errors across both runs', allErrors.length === 0,
  allErrors.slice(0, 3).join(' | '));

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass === results.length ? 'PASS' : 'FAIL'} story.mjs  (${pass}/${results.length} checks)`);
console.log(`screenshots in ${OUT}/`);
process.exit(pass === results.length ? 0 : 1);
