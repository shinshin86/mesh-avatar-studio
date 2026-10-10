import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { validateAvatarFiles } from '../packages/runtime/src/format/validate.ts';

const args = process.argv.slice(2);
if (args.length !== 1 || args.includes('--help')) {
  console.log('Usage: npm run validate-avatar -- <project-folder>');
  process.exit(args.includes('--help') ? 0 : 1);
}
try {
  const root = resolve(args[0]);
  if (!(await stat(root)).isDirectory()) throw new Error('Expected a project folder; .mavatar archives are not supported by this command yet.');
  const files = Object.create(null);
  async function readFolder(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const key = `${prefix}${entry.name}`, path = resolve(directory, entry.name);
      if (entry.isDirectory()) await readFolder(path, `${key}/`);
      else if (entry.isFile()) files[key] = await readFile(path);
      // Symlinks and special files are not read; required assets must be regular files.
    }
  }
  await readFolder(root);
  const errors = validateAvatarFiles(files);
  if (errors.length) {
    errors.forEach(error => console.error(error));
    process.exitCode = 1;
  } else console.log(`Valid avatar folder: ${basename(root)}`);
} catch (error) {
  console.error(`validate-avatar: ${error.message}`);
  process.exitCode = 1;
}
