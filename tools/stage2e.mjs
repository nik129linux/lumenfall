// Acceptance for docs/stage2e.md -- the cut minion sprites in a running game.
//
//   python3 -m http.server 8765
//   node tools/stage2e.mjs
//
// Produces the screenshots the brief asks for in .scratch/stage2e/ and asserts
// the things that can be asserted: that every clip the animation map names
// exists in the manifest, that the spitter really does put a projectile in the
// world on cast frame 3, that a death animation plays instead of the old scale
// squash, and that nothing logged an error on the way.
//
// The viewport is 480x270 so a screenshot is exactly the low-res buffer -- one
// screenshot pixel is one buffer pixel, which is the only way to judge a fringe
// or a 1px halo.

import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8765/index.html';
const OUT = '.scratch/stage2e';

const errors = [];
const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log(`  FAIL  ${msg}`); } else console.log(`  ok    ${msg}`); };

const enter = async (lv) => {
  await page.goto(`${URL}?level=${lv}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () => ['play', 'boss'].includes(window.__lumenfall?.machine?.state), { timeout: 20000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => { if (window.__lumenfall.elder) window.__lumenfall.elder.talked = true; });
};

// Parks the player next to a minion and keeps them there, alive, for `frames`.
//
// This has to re-assert every frame rather than set the position once. Parking
// a defenceless player next to a hostile minion gets them killed in about two
// seconds, and the death state freezes the whole game -- which then reads as
// "the spitter never casts" and "the dead clip never plays". The player is also
// left attackable (hurtTimer 0) on purpose: the AI refuses to attack a player in
// i-frames, so making them invulnerable to photograph them would stop the very
// behaviour the spitter test is looking for.
const park = ({ type, dx = 46, dy = 0, frames = 60, until = null }) =>
  page.evaluate(async ({ type, dx, dy, frames, untilSrc }) => {
    const g = window.__lumenfall;
    const en = g.enemies.find((e) => e.type === type);
    if (!en) return null;
    const test = untilSrc ? new Function('g', 'en', `return (${untilSrc})(g, en);`) : null;
    for (let i = 0; i < frames; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      const p = g.player;
      if (g.machine.state === 'dead') g.machine.to('play');
      p.dead = false;
      p.hp = 10;
      p.hurtTimer = 0;
      p.body.x = en.cx + dx;
      p.body.y = en.body.bottom + dy;
      p.body.vx = 0; p.body.vy = 0;
      if (test && test(g, en)) return { ok: true, frames: i };
    }
    return { ok: false, dist: Math.round(en.agent.sense.dist), clip: en.sprite.clip };
  }, { type, dx, dy, frames, untilSrc: until });

console.log(`\nSTAGE 2e acceptance -> ${URL}\n`);

// ------------------------------------------------------------------ manifest
await enter(1);
{
  const info = await page.evaluate(() => {
    const c = window.__lumenfall.minionArt.characters;
    return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, {
      cell: v.cell, display: v.display, clips: Object.keys(v.frames),
      nativeFacing: v.nativeFacing,
    }]));
  });
  console.log('  atlases:', JSON.stringify(info));

  // The clip names _animate asks for by hand, so a rename in the manifest or in
  // enemy.js shows up here instead of as a frozen sprite in a screenshot.
  const want = {
    wisp: ['float', 'dash', 'hurt', 'dead'],
    crawler: ['walk', 'lunge', 'hurt', 'dead'],
    spitter: ['idle', 'walk', 'cast', 'hurt', 'dead'],
    spitterShot: ['shot'],
  };
  for (const [k, clips] of Object.entries(want)) {
    check(info[k] && clips.every((c) => info[k].clips.includes(c)),
      `${k} has every clip the animation map names (${clips.join(',')})`);
  }
  check(info.wisp.display[1] === 22, `wisp draws 22px tall (got ${info.wisp.display})`);
  check(info.crawler.display[1] === 20 && info.crawler.display[0] === 36,
    `crawler draws 20 tall / 36 long (got ${info.crawler.display})`);
  check(info.spitter.display[1] === 40, `spitter draws 40px tall (got ${info.spitter.display})`);
  for (const k of Object.keys(want)) check(info[k].nativeFacing === 1, `${k} faces right natively`);
}

// ---------------------------------------------------------------- hitbox fit
{
  const boxes = await page.evaluate(() => window.__lumenfall.enemies.map((e) => ({
    type: e.type, w: e.stats.w, h: e.stats.h, cell: e.sprite.cell,
  })));
  for (const e of boxes) {
    check(e.w <= e.cell[0] && e.h <= e.cell[1],
      `${e.type} hitbox ${e.w}x${e.h} fits inside its ${e.cell[0]}x${e.cell[1]} drawn cell`);
  }
}

// ------------------------------------------------------------- L1 wisp, crawler
{
  const w = await park({ type: 'wisp', dx: 30, dy: 4, frames: 90 });
  check(!!w, 'L1 has a wisp');
  if (w) {
    const clip = await page.evaluate(() =>
      window.__lumenfall.enemies.find((e) => e.type === 'wisp').sprite.clip);
    check(clip === 'float', `wisp plays float while idle (got ${clip})`);
    await page.screenshot({ path: `${OUT}/l1-wisp.png` });
  }

  const c = await park({ type: 'crawler', dx: 40, frames: 90 });
  check(!!c, 'L1 has a crawler');
  if (c) {
    const clip = await page.evaluate(() =>
      window.__lumenfall.enemies.find((e) => e.type === 'crawler').sprite.clip);
    check(clip === 'walk', `crawler plays walk while idle (got ${clip})`);
    await page.screenshot({ path: `${OUT}/l1-crawler.png` });
  }
}

// ------------------------------------------------------------------- L1 death
{
  // Park on a live wisp first, so the screenshot is actually framed on the death
  // rather than on whatever the crawler shot left in the middle of the screen.
  await park({ type: 'wisp', dx: 26, dy: 4, frames: 60 });

  // Kill one and catch it mid-dissolve. The old code squashed scale.y to zero
  // here; if that is still happening the mesh is at zero height when sampled.
  const before = await page.evaluate(() => {
    const g = window.__lumenfall;
    // Pick a live one: hurt() is a no-op on a corpse, and a minion that walked
    // into a pit earlier would otherwise make this pass without testing
    // anything. The handle is kept because re-finding by type picks the *other*
    // wisp, which is happily playing float.
    const live = g.enemies.filter((e) => e.type === 'wisp' && !e.dead);
    // The nearest one is the one in shot.
    const en = live.sort((a, b) =>
      Math.abs(a.cx - g.player.cx) - Math.abs(b.cx - g.player.cx))[0];
    if (!en) return null;
    en.hurt(99);
    window.__killed = en;
    return { dead: en.dead, hp: en.hp };
  });
  check(before?.dead === true, 'a minion dies when its hp is gone');
  await page.waitForTimeout(220);
  const mid = await page.evaluate(() => {
    const en = window.__killed;
    if (!en || !en.mesh) return null;
    return {
      state: window.__lumenfall.machine.state,
      clip: en.sprite.clip, frame: en.sprite.frame,
      scaleY: en.mesh.scale.y, cellH: en.sprite.cell[1],
    };
  });
  check(mid?.clip === 'dead', `the death plays the cut dead clip (got ${mid?.clip})`);
  check(mid && mid.scaleY > mid.cellH * 0.5,
    `death is not the old scale.y squash (scaleY ${mid?.scaleY} vs cell ${mid?.cellH})`);
  await page.screenshot({ path: `${OUT}/death.png` });
}

// -------------------------------------------------------------- L2 spitter cast
await enter(2);
{
  const s = await park({
    type: 'spitter', dx: 110, frames: 1800,
    // Out of melee at 110px: standing on top of the spitter would keep the
    // player in i-frames, and the AI will not attack an invulnerable player.
    until: '(g, en) => en.sprite.clip === "cast" && g.fx.projectiles.length > 0',
  });
  check(!!s, 'L2 has a spitter');
  check(!!s && s.ok === true, 'the spitter plays cast and puts a fireball in the world');
  if (s && s.ok !== true) console.log('       ', JSON.stringify(s));

  if (s && s.ok === true) {
    const shot = await page.evaluate(() => {
      const g = window.__lumenfall;
      const pr = g.fx.projectiles[g.fx.projectiles.length - 1];
      const en = g.enemies.find((e) => e.type === 'spitter');
      return {
        textured: !!pr.sprite, flicker: !!pr.flicker,
        size: pr.mesh.geometry.parameters,
        speed: Math.abs(pr.vx),
        clip: en.sprite.clip,
      };
    });
    check(shot.clip === 'cast', `the spitter is mid-cast (got ${shot.clip})`);
    check(shot.textured, 'the projectile draws the cut spitterShot sprite, not a square');
    check(shot.flicker, 'the projectile flickers between two scales');
    check(shot.size.width === 12 && shot.size.height === 8,
      `the fireball draws at 12x8 (got ${shot.size.width}x${shot.size.height})`);
    check(shot.speed > 0, `the fireball travels (vx ${shot.speed})`);
  }
  await page.screenshot({ path: `${OUT}/l2-spitter-cast.png` });
}

console.log(`\n--- console errors: ${errors.length} ---`);
for (const e of [...new Set(errors)].slice(0, 10)) console.log(`   ${e}`);
check(errors.length === 0, 'no console errors');

console.log(failures ? `\nFAIL (${failures})` : '\nPASS');
await browser.close();
process.exit(failures ? 1 : 0);
