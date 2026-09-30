// Stage 4 gate: runs the generic boss gate with this stage's config.
import { spawnSync } from 'node:child_process';
const r = spawnSync('node', ['tools/gateboss.mjs', JSON.stringify({"level":2,"p1":["volley","sweep","blink"],"p2":"rotate","p2min":0.9,"rotate":true})], { stdio: 'inherit' });
process.exit(r.status ?? 2);
