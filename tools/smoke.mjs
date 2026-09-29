// Headless smoke check.
//
// Loads the game, captures every console message and page error, then drives it
// through a full run: title, cutscene, each level, the L2 rotation, a boss, and
// the ending. Any console error or unhandled rejection fails the run.
//
//   node tools/smoke.mjs [url]

import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:8765/index.html';
const SHOT_DIR = '.scratch/shots';

const errors = [];
const warnings = [];
const logs = [];

const browser = await chromium.launch({
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('console', (m) => {
  const text = `${m.type()}: ${m.text()}`;
  logs.push(text);
  if (m.type() === 'error') errors.push(text);
  if (m.type() === 'warning') warnings.push(text);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

const step = async (name, fn) => {
  const before = errors.length;
  await fn();
  await page.waitForTimeout(220);
  const added = errors.slice(before);
  console.log(`${added.length ? 'FAIL' : ' ok '}  ${name}${added.length ? ' :: ' + added.join(' | ') : ''}`);
  return added.length === 0;
};

let pass = true;
const record = (ok) => { if (!ok) pass = false; };

console.log(`\nLUMENFALL smoke check -> ${URL}\n`);

await step('load', async () => {
  // A module-level ReferenceError kills the game before __lumenfall is ever set,
// which is indistinguishable from a hang. Probe the boot marker directly and
// report whatever the console collected instead of waiting out the timeout.
await page.goto(URL, { waitUntil: 'load' });
  try {
    await page.waitForFunction(
      () => window.__lumenfall && window.__lumenfall.machine,
      null, { timeout: 25000 });
  } catch (e) {
    console.log('boot never completed. console said:');
    [...new Set(logs)].slice(0, 12).forEach((l) => console.log('   ' + l));
    throw e;
  }
  await page.waitForTimeout(600);
});

record(await step('boot reached menu', async () => {
  const s = await page.evaluate(() => window.__lumenfall.machine.state);
  if (s !== 'menu') throw new Error(`state=${s}`);
}));
await page.screenshot({ path: `${SHOT_DIR}/01-menu.png` });

record(await step('atlases loaded with frames', async () => {
  const info = await page.evaluate(() => {
    const c = window.__lumenfall.characters;
    return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Object.keys(v.frames).length]));
  });
  console.log('      atlases:', JSON.stringify(info));
  for (const [k, n] of Object.entries(info)) if (n < 4) throw new Error(`${k} has ${n} clips`);
}));

record(await step('new game -> cutscene', async () => {
  await page.click('#menu-new');
  await page.waitForFunction(() => window.__lumenfall.machine.state === 'cutscene', null, { timeout: 5000 });
}));
await page.waitForTimeout(900);
await page.screenshot({ path: `${SHOT_DIR}/02-cutscene.png` });

record(await step('cutscene typewriter advances', async () => {
  // Restart from line 0 so the sample is deterministic: by the time the earlier
  // steps have run, the first line has usually already finished typing.
  await page.evaluate(() => {
    const c = window.__lumenfall.cutscene;
    c.index = 0; c.chars = 0; c.typing = true; c._paint();
  });
  await page.waitForTimeout(350);
  const a = await page.evaluate(() => window.__lumenfall.cutscene.chars);
  await page.waitForTimeout(400);
  const b = await page.evaluate(() => window.__lumenfall.cutscene.chars);
  if (a <= 0) throw new Error(`no characters typed (${a})`);
  if (b <= a) throw new Error(`typing stalled at ${b}`);
  await page.waitForFunction(() => !window.__lumenfall.cutscene.typing, null, { timeout: 8000 });
  const done = await page.evaluate(() => ({
    chars: window.__lumenfall.cutscene.chars,
    len: window.__lumenfall.cutscene.current.text.length,
  }));
  if (done.chars < done.len) throw new Error(`line incomplete: ${done.chars}/${done.len}`);
}));

record(await step('skip cutscene -> play', async () => {
  for (let i = 0; i < 10; i++) {
    const s = await page.evaluate(() => window.__lumenfall.machine.state);
    if (s !== 'cutscene') break;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(160);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(160);
  }
  await page.waitForFunction(() => window.__lumenfall.machine.state === 'play', null, { timeout: 8000 });
}));

record(await step('player physics + movement', async () => {
  const y0 = await page.evaluate(() => window.__lumenfall.player.body.y);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyD');
  const p = await page.evaluate(() => ({
    x: window.__lumenfall.player.body.x,
    y: window.__lumenfall.player.body.y,
    onGround: window.__lumenfall.player.onGround,
  }));
  if (p.x <= 2) throw new Error(`did not move, x=${p.x}`);
  if (!p.onGround) throw new Error('not on ground');
}));
await page.screenshot({ path: `${SHOT_DIR}/03-play.png` });

record(await step('jump', async () => {
  await page.keyboard.press('Space');
  await page.waitForTimeout(120);
  const airborne = await page.evaluate(() => !window.__lumenfall.player.onGround);
  await page.waitForTimeout(600);
  if (!airborne) throw new Error('jump did not leave the ground');
}));

record(await step('dash: i-frames, ghost, cooldown', async () => {
  await page.keyboard.press('KeyK');
  await page.waitForTimeout(60);
  const st = await page.evaluate(() => {
    const p = window.__lumenfall.player;
    return {
      dashing: p.isDashing,
      invuln: p.isInvulnerable,
      cd: p.dashCd,
      ghostActive: p.ghosts.some((g) => g.active),
    };
  });
  if (!st.dashing) throw new Error('not dashing');
  if (!st.invuln) throw new Error('dash gave no i-frames');
  if (st.cd <= 0) throw new Error('cooldown not started');
  if (!st.ghostActive) throw new Error('no ghost trail');
  // 1s cooldown must actually gate a second dash.
  await page.waitForTimeout(250);
  const early = await page.evaluate(() => { window.__lumenfall.player._tryDash(); return window.__lumenfall.player.dashTimer; });
  if (early > 0) throw new Error('dashed again during cooldown');
}));

record(await step('sword attack', async () => {
  await page.evaluate(() => { window.__lumenfall.player.dashCd = 0; });
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(80);
  const attacking = await page.evaluate(() => window.__lumenfall.player.isAttacking);
  if (!attacking) throw new Error('attack did not start');
}));

record(await step('adaptive AI governor respects the ceiling', async () => {
  const d = await page.evaluate(() => {
    const g = window.__lumenfall.governor;
    // Force a very dodge-heavy, aggressive player and let the model adapt hard.
    for (let i = 0; i < 40; i++) {
      window.__lumenfall.model.record(i % 2 ? 'dash' : 'attack', { dx: 20, x: i, y: i });
    }
    for (let i = 0; i < 200; i++) g.update(window.__lumenfall.model);
    return g.describe();
  });
  console.log('      governor:', JSON.stringify(d));
  if (d.scalar > d.base + 1e-6) throw new Error(`scalar ${d.scalar} exceeded ceiling ${d.base}`);
  if (d.adapt > d.base && d.adapt > 0.2) throw new Error(`adapt out of band: ${d.adapt}`);
}));

record(await step('L1 -> L2 with rotation mechanic', async () => {
  await page.evaluate(() => {
    const g = window.__lumenfall;
    g._onBossDefeated();          // skips straight to the next level
  });
  await page.waitForTimeout(400);
  for (let i = 0; i < 10; i++) {
    const s = await page.evaluate(() => window.__lumenfall.machine.state);
    if (s !== 'cutscene') break;
    await page.keyboard.press('Enter'); await page.waitForTimeout(140);
    await page.keyboard.press('Enter'); await page.waitForTimeout(140);
  }
  await page.waitForFunction(() => window.__lumenfall.machine.state === 'play', null, { timeout: 8000 });
  const id = await page.evaluate(() => window.__lumenfall.level.data.id);
  if (id !== 2) throw new Error(`expected level 2, got ${id}`);
}));

record(await step('L2 rotate: 90deg over ~0.6s, physics suspended', async () => {
  const before = await page.evaluate(() => {
    const g = window.__lumenfall;
    return { rot: g.level.rot, can: g.level.canRotate, enabled: g.player.body.enabled };
  });
  if (!before.can) throw new Error('level 2 cannot rotate');

  await page.keyboard.press('KeyE');
  await page.waitForTimeout(80);
  const during = await page.evaluate(() => ({
    rotating: window.__lumenfall.level.isRotating,
    enabled: window.__lumenfall.player.body.enabled,
  }));
  if (!during.rotating) throw new Error('rotation did not start');
  if (during.enabled) throw new Error('physics not suspended during rotation');

  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => {
    const g = window.__lumenfall;
    const local = g.level.worldToLocal(g.player.mesh.position.clone());
    return {
      rot: g.level.rot,
      rotCount: g.level.rotCount,
      rotating: g.level.isRotating,
      enabled: g.player.body.enabled,
      drift: Math.hypot(local.x - g.player.cx, local.y - g.player.body.bottom),
    };
  });
  const turned = Math.abs(after.rot - before.rot);
  if (after.rotating) throw new Error('rotation never finished');
  if (Math.abs(turned - Math.PI / 2) > 0.02) throw new Error(`rotated ${turned}, expected PI/2`);
  if (after.rotCount < 1) throw new Error('rotCount did not increment');
  if (!after.enabled) throw new Error('physics not restored after rotation');
  // The player must be back in local space where the body thinks they are,
  // otherwise the next physics step teleports them.
  if (after.drift > 2) throw new Error(`local/world drift after rotation: ${after.drift}`);
}));
await page.screenshot({ path: `${SHOT_DIR}/04-rotate.png` });

record(await step('L2 -> L3, halo is the only light', async () => {
  await page.evaluate(() => window.__lumenfall._onBossDefeated());
  await page.waitForTimeout(400);
  for (let i = 0; i < 10; i++) {
    const s = await page.evaluate(() => window.__lumenfall.machine.state);
    if (s !== 'cutscene') break;
    await page.keyboard.press('Enter'); await page.waitForTimeout(140);
    await page.keyboard.press('Enter'); await page.waitForTimeout(140);
  }
  await page.waitForFunction(() => window.__lumenfall.machine.state === 'play', null, { timeout: 8000 });
  const st = await page.evaluate(() => ({
    id: window.__lumenfall.level.data.id,
    darkness: window.__lumenfall.pipeline.postUniforms.darkness.value,
  }));
  if (st.id !== 3) throw new Error(`expected level 3, got ${st.id}`);
  if (st.darkness < 0.5) throw new Error(`L3 darkness not applied: ${st.darkness}`);
}));
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOT_DIR}/05-level3.png` });

record(await step('Patient One predicts the lantern path', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__lumenfall;
    // Put the boss and the player in the same place, so line of sight is real
    // and the fairness gate is not the reason nothing happened.
    g.player.body.x = 200; g.player.body.y = 32;
    g._startBoss();
    await new Promise((res) => setTimeout(res, 400));
    const b = g.boss;
    if (!b) return { ok: false, why: 'no boss' };
    b.body.x = 300; b.body.y = 32;

    // A straight, fast-moving light trail: the read should be confident.
    for (let i = 0; i < 12; i++) g.model.record('move', { dx: 20, x: 100 + i * 20, y: 100 });

    // decide() rolls weighted, so leave it to chance and this test is flaky. Pin
    // the weights to strike-only to test the prediction itself, not the dice.
    const realThink = b.think.bind(b);
    b.think = (dt, player, level) => {
      const a = realThink(dt, player, level, { strike: 1, strike_hold: 0.2 });
      if (a === 'strike') b.agent.markAttack();
      return a;
    };

    const acts = [];
    for (let i = 0; i < 300; i++) {
      b.update(1 / 60, g.player, g.level.data, g.fx);
      acts.push(b.agent.action);
    }
    const counts = acts.reduce((m, a) => (m[a] = (m[a] || 0) + 1, m), {});
    return {
      ok: true,
      name: b.nameKey,
      predicted: !!b.lastPredicted,
      pred: b.lastPredicted && {
        x: Math.round(b.lastPredicted.x),
        conf: +b.lastPredicted.confidence.toFixed(2),
      },
      counts,
      los: b.agent.sense.los,
      dist: Math.round(b.agent.sense.dist),
      // The fairness floor: at most one committed attack per 0.8s.
      strikes: counts.strike || 0,
    };
  });
  console.log('      patient one:', JSON.stringify(r));
  if (!r.ok) throw new Error(r.why);
  if (!r.los) throw new Error('no line of sight, prediction never attempted');
  if (!r.predicted) throw new Error('never produced a light-path prediction');
  if (!r.strikes) throw new Error('never committed a strike');
}));

record(await step('adaptive AI: counter-dodge raises the bait weight', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__lumenfall;
    const { Agent, Governor, PlayerModel } = await import('./js/game/ai.js');
    const mk = (fill) => {
      const m = new PlayerModel();
      for (let i = 0; i < 20; i++) m.record(fill, { x: i, y: 0 });
      const self = { cx: 0, cy: 0 };
      const a = new Agent({ model: m, governor: new Governor('normal'), self });
      return { m, a };
    };
    const player = {
      cx: 100, cy: 0, dead: false, isInvulnerable: false, isDashing: false,
      isAttacking: false, onGround: true, hurt() { return false; },
    };
    const self = { cx: 0, cy: 0 };
    const weights = { approach: 1, attack: 1, bait: 0, retreat: 0 };

    // A steady dodger.
    const dodger = mk('dash');
    dodger.a.perceive(player, { width: 200, height: 40, grid: new Uint8Array(8000) }, 0);
    const d1 = dodger.a.decide(player, { ...weights });

    // A maser.
    const maser = mk('attack');
    maser.a.perceive(player, { width: 200, height: 40, grid: new Uint8Array(8000) }, 0);
    const d2 = maser.a.decide(player, { ...weights });

    return {
      dodgeBias: +dodger.m.dodgeBias.toFixed(2),
      aggression: +maser.m.aggression.toFixed(2),
      dodgerPick: d1.key,
      dodgerBaitWeight: d1.weights.bait ?? 0,
      maserPick: d2.key,
      maserApproachWeight: d2.weights.approach ?? 0,
    };
  });
  console.log('      adaptation:', JSON.stringify(r));
  if (r.dodgeBias < 0.4) throw new Error(`dodgeBias not detected: ${r.dodgeBias}`);
  if (r.aggression < 0.4) throw new Error(`aggression not detected: ${r.aggression}`);
  // A steady dodger should be baited, not charged.
  if (r.dodgerBaitWeight <= 0) throw new Error('bait weight not raised against a dodger');
}));

record(await step('fairness caps: no attack during i-frames', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__lumenfall;
    const b = g.boss;
    const agent = b.agent;
    // Make the gate see a reachable, visible, long-idle player...
    const level = { width: 200, height: 40, grid: new Uint8Array(8000) };
    const player = { cx: b.cx + 30, cy: b.cy, dead: false, isInvulnerable: true, onGround: true };
    agent.time = 99;
    agent.lastAttackAt = -99;
    agent.perceive(player, level, 99);
    // _attackAllowed returns true to PERMIT an attack, so these read inverted:
    // permittedDuringIframes must be false.
    const permittedDuringIframes = agent._attackAllowed(player, { ...agent.sense });

    // ...and the same situation with the i-frames gone.
    player.isInvulnerable = false;
    agent.perceive(player, level, 99);
    const permittedWhenVulnerable = agent._attackAllowed(player, agent.sense);

    // And the min-attack-gap rule.
    agent.lastAttackAt = agent.time - 0.2;
    const permittedInsideGap = agent._attackAllowed(player, agent.sense);

    // And off-screen grace.
    const hidden = { ...player, cx: 0, cy: 0, dead: false };
    agent.body = { cx: 5000, cy: 5000 };
    agent.perceive(hidden, level, 99);
    const permittedOffScreen = agent._attackAllowed(player, agent.sense);

    return { permittedDuringIframes, permittedWhenVulnerable, permittedInsideGap, permittedOffScreen };
  });
  if (r.permittedDuringIframes) throw new Error('attacked through the player i-frames');
  if (!r.permittedWhenVulnerable) throw new Error('never allowed a legitimate attack');
  if (r.permittedInsideGap) throw new Error('attacked again inside the 0.8s gap');
  if (r.permittedOffScreen) throw new Error('committed an attack with no line of sight');
}));

record(await step('boss phase 2 at 55% health', async () => {
  const p = await page.evaluate(() => {
    const b = window.__lumenfall.boss;
    if (!b) return { ok: false, why: 'no boss' };
    b.hurt(Math.ceil(b.maxHp * 0.5));
    return { ok: true, phase: b.phase };
  });
  if (!p.ok) throw new Error(p.why);
  if (p.phase !== 2) throw new Error(`expected phase 2, got ${p.phase}`);
}));

record(await step('Ul Burjo: phase 2 drops the disguise and rotates the arena', async () => {
  const r = await page.evaluate(async () => {
    const g = window.__lumenfall;
    g.ui.hideAll();
    g.levelIndex = 1; g._loadLevel(1, { silent: true });
    g.cutscene.active = false; g.cutscene.onDone = null;
    g.machine.state = 'play'; g.ui.showHud();
    g.bossDef = { type: 'boss', boss: 'ulburjo', x: g.level.worldWidth - 160, y: 32 };
    g.player.body.x = g.bossDef.x - 120; g.player.body.y = 32;
    g._startBoss();
    await new Promise((res) => setTimeout(res, 500));
    const b = g.boss;
    if (!b) return { ok: false, why: 'no boss' };

    const beforeSprite = b.sprite.char.name;
    b.hurt(Math.ceil(b.maxHp * 0.6));   // cross the 55% phase threshold
    for (let i = 0; i < 600; i++) {
      b.update(1 / 60, g.player, g.level.data, g.fx);
      if (g.level.isRotating) {
        for (let k = 0; k < 80; k++) g.level.updateRotation(1 / 60);
        b.onRotationDone();
      }
    }
    return {
      ok: true,
      beforeSprite,
      afterSprite: b.sprite.char.name,
      phase: b.phase,
      rotCount: g.level.rotCount,
      rot: +g.level.rot.toFixed(3),
    };
  });
  console.log('      ul burjo:', JSON.stringify(r));
  if (!r.ok) throw new Error(r.why);
  if (r.beforeSprite !== 'goodwitch') throw new Error(`expected the elder disguise, got ${r.beforeSprite}`);
  if (r.afterSprite !== 'badwitch') throw new Error(`disguise never dropped, still ${r.afterSprite}`);
  if (r.phase !== 2) throw new Error(`expected phase 2, got ${r.phase}`);
  if (r.rotCount < 1) throw new Error('phase 2 never rotated the arena');
  // One turn per 4.5s cooldown: 10s of sim should not spin the room 144 times.
  if (r.rotCount > 3) throw new Error(`arena rotating too often: ${r.rotCount}`);
}));

record(await step('defeating the final boss reaches the ending', async () => {
  // Self-contained: the preceding checks leave the game in whatever level they
  // needed, so jump to L3 and spawn its boss explicitly.
  await page.evaluate(async () => {
    const g = window.__lumenfall;
    g.ui.hideAll();
    g.levelIndex = 2; g._loadLevel(2, { silent: true });
    g.cutscene.active = false; g.cutscene.onDone = null;
    g.machine.state = 'play';
    g.bossDef = { type: 'boss', boss: 'patientone', x: g.level.worldWidth - 160, y: 32 };
    g.player.body.x = g.bossDef.x - 100; g.player.body.y = 32;
    g._startBoss();
    await new Promise((r) => setTimeout(r, 400));
    const b = g.boss;
    if (b) { b.state = 'idle'; b.hurt(999); }
  });
  await page.waitForFunction(() => window.__lumenfall.machine.state === 'cutscene', null, { timeout: 12000 });
  for (let i = 0; i < 12; i++) {
    const s = await page.evaluate(() => window.__lumenfall.machine.state);
    if (s === 'ending') break;
    await page.keyboard.press('Enter'); await page.waitForTimeout(140);
    await page.keyboard.press('Enter'); await page.waitForTimeout(140);
  }
  await page.waitForFunction(() => window.__lumenfall.machine.state === 'ending', null, { timeout: 8000 });
  const on = await page.evaluate(() => document.getElementById('ending').classList.contains('on'));
  if (!on) throw new Error('ending screen not shown');
}));
await page.waitForTimeout(700);
await page.screenshot({ path: `${SHOT_DIR}/06-ending.png` });

record(await step('language toggle switches every string', async () => {
  const es = await page.evaluate(() => document.getElementById('pause-title').textContent);
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(250);
  const en = await page.evaluate(() => document.getElementById('pause-title').textContent);
  const diff = await page.evaluate(() => ({ lang: window.__lumenfall && document.documentElement.lang }));
  console.log(`      "${es}" -> "${en}"`);
  if (es === en) throw new Error('strings did not change');
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(200);
}));

record(await step('no hardcoded player-facing text in UI layer', async () => {
  const bad = await page.evaluate(async () => {
    const files = ['ui/hud.js', 'ui/cutscene.js'];
    const out = [];
    for (const f of files) {
      const src = await (await fetch(`js/${f}`)).text();
      // Any string literal with a space and a lowercase word is likely UI text.
      const m = src.match(/'[^']*[a-z]{3,}\s+[a-z]{3,}[^']*'/g) || [];
      for (const s of m) {
        if (/^'[a-zA-Z_]+'$/.test(s)) continue;         // identifiers
        if (/^\s*'[^']*'\s*$/.test(s)) continue;
        out.push(`${f}: ${s}`);
      }
    }
    return out;
  });
  if (bad.length) throw new Error(bad.slice(0, 4).join(' | '));
}));

await browser.close();

console.log(`\n--- console errors: ${errors.length} ---`);
errors.forEach((e) => console.log('  ' + e));
if (warnings.length) {
  console.log(`--- console warnings: ${warnings.length} ---`);
  [...new Set(warnings)].slice(0, 8).forEach((w) => console.log('  ' + w));
}

console.log(`\n${pass && errors.length === 0 ? 'PASS' : 'FAIL'}\n`);
process.exit(pass && errors.length === 0 ? 0 : 1);
