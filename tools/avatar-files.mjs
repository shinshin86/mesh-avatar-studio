import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function readAvatarFolder(root, paths) {
  const files = Object.create(null);
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const key = `${prefix}${entry.name}`, path = resolve(directory, entry.name);
      if (entry.isDirectory() && (!paths || [...paths].some(name => name.startsWith(`${key}/`)))) await visit(path, `${key}/`);
      else if (entry.isFile() && (!paths || paths.has(key))) files[key] = await readFile(path);
      // Symlinks and special files are not read; required assets must be regular files.
    }
  }
  await visit(root);
  return files;
}
