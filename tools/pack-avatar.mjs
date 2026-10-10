import { writeFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { packAvatar } from '../packages/runtime/src/format/zip.ts';
import { parseManifest } from '../packages/runtime/src/format/manifest.ts';
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
  const wanted = new Set(['avatar.json', 'rig.json', 'built/layers.json', 'built/sprites/sprites.json']);
  const all = await readAvatarFolder(root, wanted);
  const manifest = all['avatar.json'] ? parseManifest(JSON.parse(new TextDecoder().decode(all['avatar.json']))) : undefined;
  const source = manifest?.source ?? 'source.png', thumbnail = manifest?.thumbnail ?? 'thumbnail.png';
  // Include playback files and optional original/thumbnail, never drafts or private work files.
  wanted.add('built/base.png'); wanted.add('built/hairmask.png'); wanted.add(thumbnail);
  if (includeSource) wanted.add(source);
  for (const [metadata, prefix] of [['built/layers.json', 'built/'], ['built/sprites/sprites.json', 'built/sprites/']]) {
    if (all[metadata]) {
      const value = JSON.parse(new TextDecoder().decode(all[metadata]));
      for (const name of Object.keys(value?.layers ?? {})) wanted.add(`${prefix}${name}.png`);
    }
  }
  const files = await readAvatarFolder(root, wanted);
  let override = manifest ? undefined : { name: basename(root) };
  if (!includeSource && manifest?.source) override = { ...manifest, source: undefined };
  const bytes = packAvatar(files, { manifest: override });
  await writeFile(destination, bytes, { flag: 'wx' });
  console.log(`Packed ${basename(destination)} (${bytes.length} bytes${includeSource ? '' : ', source omitted'})`);
} catch (error) {
  console.error(`pack-avatar: ${error.message}`);
  process.exitCode = 1;
}
