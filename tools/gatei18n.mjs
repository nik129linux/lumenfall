// i18n gate: Spanish and English have exactly the same keys, none empty, and every t('key')
// used in the code exists. Run: node tools/gatei18n.mjs
import { STRINGS } from '../js/ui/strings.js';
import fs from 'node:fs'; import path from 'node:path';
const results = [], check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const es = Object.keys(STRINGS.es), en = Object.keys(STRINGS.en);
const missingEn = es.filter((k) => !(k in STRINGS.en)), missingEs = en.filter((k) => !(k in STRINGS.es));
check('I1 every Spanish key exists in English', missingEn.length === 0, missingEn.join(','));
check('I2 every English key exists in Spanish', missingEs.length === 0, missingEs.join(','));
const empty = [...es.filter((k) => !String(STRINGS.es[k]).trim()), ...en.filter((k) => !String(STRINGS.en[k]).trim())];
check('I3 no empty string', empty.length === 0, empty.join(','));
const same = es.filter((k) => k in STRINGS.en && STRINGS.es[k] === STRINGS.en[k] && String(STRINGS.es[k]).length > 14 && !k.startsWith('ctlKeys'));
check('I4 long strings are really translated (not copied)', same.length === 0, same.slice(0, 6).join(','));
const used = new Set();
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== 'vendor') walk(p); } else if (f.name.endsWith('.js')) { for (const m of fs.readFileSync(p, 'utf8').matchAll(/\bt\(\s*['"]([A-Za-z0-9_]+)['"]/g)) used.add(m[1]); for (const m of fs.readFileSync(p, 'utf8').matchAll(/(?:titleKey|textKey|nameKey|labelKey)\s*:\s*['"]([A-Za-z0-9_]+)['"]/g)) used.add(m[1]); } } };
walk('js');
const unknown = [...used].filter((k) => k !== 'key' && !(k in STRINGS.es));
check('I5 every key used in the code exists', unknown.length === 0, unknown.join(','));
let failed = 0;
for (const r of results) { console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`); if (!r.ok) failed++; }
console.log(failed ? `GATE FAIL (${failed} of ${results.length})` : 'GATE PASS');
process.exit(failed ? 1 : 0);
