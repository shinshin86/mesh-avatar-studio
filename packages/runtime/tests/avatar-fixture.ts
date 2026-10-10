import { readFileSync, readdirSync } from 'node:fs';

export function sampleFiles(): Record<string, Uint8Array> {
  const root = new URL('../../../samples/miko-qipao/', import.meta.url);
  const files: Record<string, Uint8Array> = {};
  function read(url: URL, prefix = '') {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const path = `${prefix}${entry.name}`;
      if (entry.isDirectory()) read(new URL(`${entry.name}/`, url), `${path}/`);
      else if (entry.isFile()) files[path] = readFileSync(new URL(entry.name, url));
    }
  }
  read(root);
  return files;
}
