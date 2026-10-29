// Authored keyframes and expression targets shared with the JS runtime.
import { readFile, writeFile } from 'node:fs/promises';
import { MOTIONS, IDLE_MOTIONS, ADDITIVE } from '../../packages/runtime/src/engine/motions.js';
import { EXPRESSIONS } from '../../packages/runtime/src/engine/motion.js';
const motions = Object.entries({ ...MOTIONS, ...IDLE_MOTIONS }).map(([id, motion]) => ({
  id, ...motion, idle: motion.idle ?? false, tracks: Object.entries(motion.tracks),
}));
const path = new URL('../crates/mesh-avatar-core/src/engine/motions.json', import.meta.url);
const expected = JSON.stringify({ motions, additive: [...ADDITIVE], expressions: EXPRESSIONS }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  const actual = await readFile(path, 'utf8');
  if (actual !== expected) {
    console.error('Embedded motion data differs from the JS runtime. Run node --experimental-strip-types native/conformance/sync-motion-data.mjs');
    process.exitCode = 1;
  }
} else await writeFile(path, expected);
