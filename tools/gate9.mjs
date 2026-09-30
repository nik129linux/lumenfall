// Stage 9 gate: README completeness and honesty. Run: node tools/gate9.mjs
import fs from 'node:fs';
const results = [], check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const md = fs.existsSync('README.md') ? fs.readFileSync('README.md', 'utf8') : '';
check('R0 README.md exists', md.length > 0, '');
const heads = ['# LUMENFALL', '## Run it', '## Controls', '## Story', '## Levels and bosses', '## Adaptive AI', '## Metrics', '## Project structure', '## Tests', '## Known limitations', '## Credits'];
let last = -1, order = true; const missing = [];
for (const h of heads) { const i = md.search(new RegExp('^' + h.replace(/[#]/g, '\\#') + '\\s*$', 'm')); if (i < 0) missing.push(h); else { if (i < last) order = false; last = i; } }
check('R1 all required headings exist', missing.length === 0, missing.join(' | '));
check('R2 headings are in the required order', order, '');
const lines = md.split('\n').length;
check('R3 at most 250 lines', lines <= 250 && lines > 60, `lines=${lines}`);
const paths = [...md.matchAll(/`((?:js|tools|assets|docs|css|sprites)\/[A-Za-z0-9_./-]+)`/g)].map((m) => m[1]).filter((p) => !p.includes('*'));
const bad = [...new Set(paths)].filter((p) => !fs.existsSync(p));
check('R4 every path in backticks exists', paths.length >= 10 && bad.length === 0, bad.length ? `missing: ${bad.join(', ')}` : `${new Set(paths).size} paths checked`);
const must = ['Easy', 'Normal', 'Hard', 'last 20', 'Google Analytics', 'GA_MEASUREMENT_ID', 'python3 -m http.server', 'localhost', 'lumenfall.metrics.v1', 'node tools/gateai.mjs', 'node tools/gate7.mjs', 'node tools/reach.mjs', 'Move', 'Jump', 'Attack', 'Dash', 'Rotate', 'Pause', 'windup', 'Ul Burjo', 'Patient One'];
const lack = must.filter((w) => !md.includes(w));
check('R5 mentions every required term', lack.length === 0, lack.join(', '));
const tokens = ['A', 'D', 'W', 'J', 'K', 'E', 'Space', 'Esc', 'Shift', 'Enter'];
const absent = tokens.filter((w) => !new RegExp('(^|[^A-Za-z])' + w + '([^A-Za-z]|$)').test(md));
check('R6 the README shows the real key bindings (A D W J K E Space Esc Shift Enter)', absent.length === 0, absent.length ? `not shown: ${absent.join(',')}` : 'all shown');
check('R7 it has a limitations section with real content', /## Known limitations\s+[\s\S]{80,}?(?=\n## )/.test(md), '');
check('R8 written in English (no common Spanish words in prose)', !/\b(nueva partida|controles|historia|niveles)\b/i.test(md.replace(/`[^`]*`/g, '')), '');
let failed = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); if (!r.ok) failed++; }
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
