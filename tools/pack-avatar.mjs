import { writeFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { packProjectAvatar } from '../packages/runtime/src/format/project-archive.ts';
import { readAvatarFolder } from './avatar-files.mjs';

const args = process.argv.slice(2);
let folder, output, includeSource = true;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--no-source') includeSource = false;
  else if (args[i] === '-o' && args[i + 1]) output = args[++i];
  else if (!args[i].startsWith('-') && !folder) folder = args[i];
  else { folder = undefined; break; }
}
if (!folder || args.includes('--help')) {
  console.log('Usage: npm run pack-avatar -- <project-folder> [--no-source] [-o out.mavatar]');
  process.exit(args.includes('--help') ? 0 : 1);
}
try {
  const root = resolve(folder), destination = resolve(output ?? `${root}.mavatar`);
  if (!(await stat(root)).isDirectory()) throw new Error('Expected a project folder.');
  const bytes = await packProjectAvatar(paths => readAvatarFolder(root, paths), { name: basename(root), includeSource });
  await writeFile(destination, bytes, { flag: 'wx' });
  console.log(`Packed ${basename(destination)} (${bytes.length} bytes${includeSource ? '' : ', source omitted'})`);
} catch (error) {
  console.error(`pack-avatar: ${error.message}`);
  process.exitCode = 1;
}
