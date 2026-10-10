import { readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { validateAvatarFiles } from '../packages/runtime/src/format/validate.ts';
import { unpackAvatar } from '../packages/runtime/src/format/zip.ts';
import { readAvatarFolder } from './avatar-files.mjs';

const args = process.argv.slice(2);
if (args.length !== 1 || args.includes('--help')) {
  console.log('Usage: npm run validate-avatar -- <project-folder|file.mavatar>');
  process.exit(args.includes('--help') ? 0 : 1);
}
try {
  const root = resolve(args[0]);
  const folder = (await stat(root)).isDirectory();
  if (!folder && !root.toLowerCase().endsWith('.mavatar')) throw new Error('Expected a project folder or .mavatar file.');
  const files = folder ? await readAvatarFolder(root) : unpackAvatar(await readFile(root));
  const errors = validateAvatarFiles(files);
  if (!folder && !Object.hasOwn(files, 'avatar.json')) errors.unshift('avatar.json: missing file in .mavatar archive');
  if (errors.length) {
    errors.forEach(error => console.error(error));
    process.exitCode = 1;
  } else console.log(`Valid avatar ${folder ? 'folder' : 'archive'}: ${basename(root)}`);
} catch (error) {
  console.error(`validate-avatar: ${error.message}`);
  process.exitCode = 1;
}
