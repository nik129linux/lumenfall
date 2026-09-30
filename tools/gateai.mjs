// AI gate: the adaptive model reads the last 20 actions, agents counter what it sees, and the
// governor can never make the game harder than the difficulty the player chose.
// Pure node, no browser:  node tools/gateai.mjs
import { PlayerModel, Governor, Agent, predictLight } from '../js/game/ai.js';
import { DIFFICULTY, AI } from '../js/core/config.js';

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const fill = (type, n, data = {}) => { const m = new PlayerModel(); for (let i = 0; i < n; i++) m.record(type, data); return m; };
const stub = (over = {}) => ({ cx: 100, cy: 20, dead: false, isInvulnerable: false, isDashing: false, isAttacking: false, onGround: true, ...over });
const agentFor = (model, key = 'normal') => {
  const a = new Agent({ model, governor: new Governor(key), self: { cx: 0, cy: 20 } });
  a.time = 10; a.lastAttackAt = -999;
  a.sense = { dist: 40, dx: 40, dy: 0, los: true, playerState: 'ground' };
  return a;
};
const W = () => ({ attack: 1, approach: 1, bait: 0, retreat: 0 });

// model
{
  const m = fill('attack', 30);
  check('AI1 the window holds only the last 20 actions', m.count === AI.memory && AI.memory === 20, `count=${m.count} memory=${AI.memory}`);
  const m2 = new PlayerModel(); for (let i = 0; i < 20; i++) m2.record('dash'); for (let i = 0; i < 20; i++) m2.record('attack');
  check('AI2 old actions are forgotten (20 dashes then 20 attacks)', m2.dodgeBias < 0.05 && m2.aggression > 0.95, `dodge=${m2.dodgeBias.toFixed(2)} aggr=${m2.aggression.toFixed(2)}`);
  const d = fill('dash', 20);
  check('AI3 a dasher is read as a dodger', d.dodgeBias >= 0.6 && d.tendency === 'dash' && d.predictability >= 0.9, `dodge=${d.dodgeBias.toFixed(2)} tendency=${d.tendency} pred=${d.predictability.toFixed(2)}`);
}

// counters
{
  const base = W();
  const dodge = agentFor(fill('dash', 20)).decide(stub(), base).weights;
  check('AI4 against a dodger the agent baits and commits less', dodge.bait > 0.5 && dodge.attack < base.attack, `bait=${dodge.bait?.toFixed(2)} attack=${dodge.attack?.toFixed(2)}`);
  const neutral = agentFor(new PlayerModel()).decide(stub(), base).weights;
  check('AI5 a neutral player gets the base weights', neutral.bait === 0 && neutral.attack === 1, `bait=${neutral.bait} attack=${neutral.attack}`);
  const mash = agentFor(fill('attack', 20)).decide(stub(), base).weights;
  check('AI6 against a masher the agent approaches harder and keeps spacing', mash.approach > base.approach && mash.retreat > 0, `approach=${mash.approach?.toFixed(2)} retreat=${mash.retreat?.toFixed(2)}`);
  const jumper = agentFor(fill('jump', 20)).decide(stub(), { ...base, antiAir: 0 }).weights;
  check('AI7 against a jump spammer the agent adds anti-air', jumper.antiAir > 0.5, `antiAir=${jumper.antiAir?.toFixed(2)}`);
}

// governor
{
  let ok = true, detail = '';
  for (const key of Object.keys(DIFFICULTY)) {
    const { scalar, band } = DIFFICULTY[key];
    for (const type of ['attack', 'dash', 'jump', 'idle']) {
      const g = new Governor(key), m = fill(type, 20);
      for (let i = 0; i < 3000; i++) {
        g.update(m);
        if (g.scalar > scalar + 1e-9 || g.scalar < scalar * (1 - band) - 1e-9 || Math.abs(g.adapt) > band + 1e-9) { ok = false; detail = `${key}/${type} scalar=${g.scalar} adapt=${g.adapt}`; }
      }
    }
  }
  check('AI8 the governor never exceeds the chosen difficulty and stays inside its band', ok, detail || 'all difficulties, 4 player types, 3000 ticks each');
  const gm = new Governor('normal'), gd = new Governor('normal');
  for (let i = 0; i < 1200; i++) { gm.update(fill('attack', 20)); gd.update(fill('dash', 20)); }
  check('AI9 it adapts in opposite directions to a masher and a dodger', gm.adapt > 0.01 && gd.adapt < -0.01, `masher=${gm.adapt.toFixed(3)} dodger=${gd.adapt.toFixed(3)}`);
  check('AI10 easy is never harder than normal, normal never harder than hard', DIFFICULTY.easy.scalar < DIFFICULTY.normal.scalar && DIFFICULTY.normal.scalar < DIFFICULTY.hard.scalar, '');
}

// fairness
{
  const m = new PlayerModel();
  const a = agentFor(m);
  check('AI11 never attacks a player in i-frames', a._attackAllowed(stub({ isInvulnerable: true }), a.sense) === false, '');
  check('AI12 never attacks a dead player', a._attackAllowed(stub({ dead: true }), a.sense) === false, '');
  a.lastAttackAt = a.time;
  check('AI13 respects the minimum gap between attacks', a._attackAllowed(stub(), a.sense) === false, `minAttackGap=${AI.minAttackGap}`);
  const b = agentFor(m); b.sense.los = false;
  check('AI14 does not commit without line of sight', b._attackAllowed(stub(), b.sense) === false, '');
}

// light prediction
{
  const m = new PlayerModel();
  check('AI15 no prediction with a short trail', predictLight(agentFor(m), m, 0.45) === null, '');
  for (let i = 0; i < 6; i++) m.record('idle', { x: 100 + i * 10, y: 32 });
  const p = predictLight(agentFor(m), m, 0.45);
  check('AI16 a straight run is extrapolated ahead of the player', p && p.x > 150 && p.confidence > 0 && p.confidence <= 1, p ? `x=${p.x.toFixed(1)} conf=${p.confidence.toFixed(2)}` : 'null');
}

let failed = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); if (!r.ok) failed++; }
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
