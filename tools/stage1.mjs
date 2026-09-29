// Stage 1 acceptance checks.
//
//   python3 -m http.server 8765
//   node tools/stage1.mjs
//
// Captures the six required screenshots into .scratch/stage1/ and asserts the
// two things that are not visible in a screenshot: zero console errors, and that
// the facing flip is actually happening (two flips used to cancel, so Kael could
// never turn around).

import { chromium } from 'playwright';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://localhost:8765/index.html';
const OUT = '.scratch/stage1';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${name}${detail ? '  :: ' + detail : ''}`);
};

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

console.log(`\nLUMENFALL stage 1 acceptance -> ${URL}\n`);

// ---------------------------------------------------------------- 1. menu.png
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__lumenfall?.machine?.state === 'menu', null, { timeout: 20000 });

// The boot overlay fades over 400ms and is then removed; screenshotting inside
// that window catches its title ghosting across the menu.
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 5000 });
await page.waitForTimeout(250);
const focused = await page.evaluate(() => document.activeElement?.id);
check('menu opens with focus on "Nueva partida"', focused === 'menu-new', `focus=${focused}`);
await shot('menu');

// Enter alone must start the game -- no click.
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__lumenfall.machine.state === 'cutscene', null, { timeout: 6000 })
  .then(() => check('Enter starts the game without clicking', true))
  .catch(() => check('Enter starts the game without clicking', false, 'stayed on menu'));

// ------------------------------------------------- 2/3. l1-right / l1-left
await page.evaluate(async () => {
  const g = window.__lumenfall;
  g.cutscene.active = false; g.cutscene.onDone = null;
  g._loadLevel(0, { silent: true });
  g.machine.state = 'play';
  g.ui.showHud();
  g.player.body.x = 120; g.player.body.y = 40;
  await new Promise((r) => setTimeout(r, 500));
});
await page.waitForTimeout(600);
await shot('l1-right');
const faceRight = await page.evaluate(() => ({
  facing: window.__lumenfall.player.facing,
  scaleX: window.__lumenfall.player.sprite.mesh.scale.x,
  flipped: window.__lumenfall.player.sprite.flipped,
  native: window.__lumenfall.characters.kael.nativeFacing,
}));

await page.keyboard.down('KeyA');
await page.waitForTimeout(500);
await page.keyboard.up('KeyA');
await page.waitForTimeout(250);
await shot('l1-left');
const faceLeft = await page.evaluate(() => ({
  facing: window.__lumenfall.player.facing,
  scaleX: window.__lumenfall.player.sprite.mesh.scale.x,
  flipped: window.__lumenfall.player.sprite.flipped,
}));

// The one mechanism: scale sign, relative to the sheet's native facing.
check('Kael faces right by default',
  faceRight.facing === 1 && faceRight.scaleX > 0,
  `facing=${faceRight.facing} scaleX=${faceRight.scaleX} native=${faceRight.native}`);
check('Kael turns to face LEFT after holding A',
  faceLeft.facing === -1 && faceLeft.scaleX < 0,
  `facing=${faceLeft.facing} scaleX=${faceLeft.scaleX}`);

// The pixel data must actually differ, or the flip is a no-op.
const diff = await page.evaluate(async () => {
  // sample the sprite's own pixels in the low-res buffer, facing each way
  const g = window.__lumenfall;
  const W = 480, H = 270;
  const grab = () => {
    g.pipeline.render();
    const bf = new Uint8Array(W * H * 4);
    g.renderer.readRenderTargetPixels(g.pipeline.target, 0, 0, W, H, bf);
    return bf;
  };
  const cell = g.player.sprite.cell;
  // Mean brightness CANNOT detect a mirror: the sprite covers the same pixels
  // either way, so the average is identical. Use the x-moment instead -- ink
  // weighted by horizontal offset -- which is what a horizontal flip negates.
  const region = (bf) => {
    // The buffer is in CAMERA space; mesh.position is world space. The quad's
    // origin is at the feet and the mirror is about that origin, so a flipped
    // sprite extends LEFT of the position. Sample the union.
    const px = Math.round(g.player.mesh.position.x - g.cam.x - cell[0] / 2);
    const py = Math.round(g.player.mesh.position.y - g.cam.y);
    let moment = 0, ink = 0;
    for (let y = py; y < py + cell[1]; y++) {
      for (let x = px; x < px + cell[0] * 2; x++) {
        const i = (y * W + x) * 4;
        const v = bf[i] + bf[i + 1] + bf[i + 2];
        moment += v * (x - px);
        ink += v;
      }
    }
    return ink > 0 ? moment / ink : 0;
  };
  g.player.facing = 1; g.player.sprite.setFacing(1);
  const r = region(grab());
  g.player.facing = -1; g.player.sprite.setFacing(-1);
  const l = region(grab());
  g.player.facing = 1; g.player.sprite.setFacing(1);
  return { r: +r.toFixed(2), l: +l.toFixed(2) };
});
check('flipped frames are horizontally mirrored on screen', diff.r !== diff.l,
  `x-moment right=${diff.r} left=${diff.l}`);

// --------------------------------------------------------- 4. l1-enemies.png
await page.evaluate(async () => {
  const g = window.__lumenfall;
  g.player.body.x = 700; g.player.body.y = 40;
  await new Promise((r) => setTimeout(r, 500));
});
await page.waitForTimeout(400);
const minions = await page.evaluate(() => {
  const g = window.__lumenfall;
  return g.enemies.map((e) => ({
    type: e.type,
    kind: e.sprite.kind,
    isMinion: !!e.sprite.kind,
    cell: e.sprite.cell,
    visible: e.mesh.visible,
  }));
});
await shot('l1-enemies');
const allMinions = minions.length > 0 && minions.every((m) => m.isMinion);
check('common enemies are procedural silhouettes, not boss sprites', allMinions,
  minions.map((m) => `${m.type}:${m.kind}`).join(' '));
check('a minion is on screen', minions.some((m) => m.visible), `${minions.length} spawned`);

// ---------------------------------------------------------- 5. level shots
for (const [n, q] of [[1, '?level=1&boss=1'], [2, '?level=2'], [3, '?level=3']]) {
  await page.goto(URL + q, { waitUntil: 'load' });
  // ?boss=1 lands in the `boss` state, not `play`.
  await page.waitForFunction(
    () => ['play', 'boss'].includes(window.__lumenfall?.machine?.state),
    null, { timeout: 20000 });
  await page.waitForTimeout(1400);
  const name = n === 1 ? 'l1-boss' : `l${n}-start`;
  await shot(name);
  const info = await page.evaluate(() => {
    const g = window.__lumenfall;
    return {
      level: g.level.data.id,
      boss: g.boss ? g.boss.nameKey : null,
      layers: g.parallax.layers.length,
      farIsArt: !!g.parallax.layers[0]?.mesh.material.map?.image,
    };
  });
  check(`${name} renders`, info.level === n && info.layers === 3,
    `level=${info.level} boss=${info.boss} layers=${info.layers} farArt=${info.farIsArt}`);
}

// ------------------------------------------------------- post-process clean
const post = await page.evaluate(() => {
  const u = window.__lumenfall.pipeline.postUniforms;
  return {
    grain: u.grainAmount ? u.grainAmount.value : 0,
    scanline: u.scanline ? u.scanline.value : 0,
    aberration: u.aberration ? u.aberration.value : 0,
    vignette: u.vignette.value,
  };
});
check('no grain / scanlines / aberration left in the post pass',
  post.grain === 0 && post.scanline === 0 && post.aberration === 0, JSON.stringify(post));

const spriteUniforms = await page.evaluate(() => {
  const u = window.__lumenfall.player.sprite.material.uniforms;
  return Object.keys(u);
});
check('sprite material does no colour processing',
  !spriteUniforms.includes('levels') && !spriteUniforms.includes('grade')
  && !spriteUniforms.includes('dither'),
  spriteUniforms.join(','));

await browser.close();

// ------------------------------------------------------------------- report
console.log('');
if (errors.length) {
  console.log('--- console errors ---');
  [...new Set(errors)].forEach((e) => console.log('  ' + e));
}
check('zero console errors', errors.length === 0, `${errors.length}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'}  ${results.length - failed.length}/${results.length}`);
console.log(`screenshots in ${OUT}/\n`);
process.exit(failed.length === 0 ? 0 : 1);
