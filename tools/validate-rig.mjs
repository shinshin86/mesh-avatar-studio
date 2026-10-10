import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { validateRig } from '../packages/runtime/src/rig/validate.ts';

const args = process.argv.slice(2);
const files = args.filter(arg => arg !== '--draft');
if (files.length !== 1 || args.includes('--help')) {
  console.log('Usage: npm run validate-rig -- <rig.json|rig.draft.json> [--draft]');
  process.exit(args.includes('--help') ? 0 : 1);
}
try {
  const draft = args.includes('--draft') || /(^|[._-])draft([._-]|$)/i.test(basename(files[0]));
  const errors = validateRig(JSON.parse(await readFile(files[0], 'utf8')), { draft });
  if (errors.length) {
    errors.forEach(error => console.error(error));
    process.exitCode = 1;
  } else console.log(`Valid ${draft ? 'draft' : 'complete'} rig: ${basename(files[0])}`);
} catch (error) {
  console.error(`validate-rig: ${error.message}`);
  process.exitCode = 1;
}
