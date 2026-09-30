// Stage 5 gate: runs the generic boss gate with this stage's config.
import { spawnSync } from 'node:child_process';
const r = spawnSync('node', ['tools/gateboss.mjs', JSON.stringify({"level":3,"p1":["lantern","ring","cutoff"],"p2":"surge","p2min":0.9,"rotate":false})], { stdio: 'inherit' });
process.exit(r.status ?? 2);
