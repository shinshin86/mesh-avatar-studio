import { parseManifest, type AvatarManifest } from './manifest.ts';
import { checkEntryName, packAvatar } from './zip.ts';

type Files = Record<string, Uint8Array>;

// Shared by Studio and the CLI; this is not part of the runtime's public API.
export async function packProjectAvatar(
  read: (paths: Set<string>) => Promise<Files>,
  { name, includeSource = true }: { name: string; includeSource?: boolean },
): Promise<Uint8Array> {
  const wanted = new Set(['avatar.json', 'rig.json', 'built/layers.json', 'built/sprites/sprites.json']);
  const metadata = await read(wanted);
  const json = (path: string) => {
    try { return JSON.parse(new TextDecoder().decode(metadata[path])); }
    catch { throw new Error(`${path}: invalid JSON`); }
  };
  const manifest = metadata['avatar.json'] ? parseManifest(json('avatar.json')) : undefined;
  const source = manifest?.source ?? 'source.png', thumbnail = manifest?.thumbnail ?? 'thumbnail.png';
  checkEntryName(source); checkEntryName(thumbnail);
  wanted.add('built/base.png'); wanted.add('built/hairmask.png'); wanted.add(thumbnail);
  if (includeSource) wanted.add(source);
  for (const [path, prefix] of [['built/layers.json', 'built/'], ['built/sprites/sprites.json', 'built/sprites/']]) {
    if (!metadata[path]) continue;
    for (const layer of Object.keys(json(path)?.layers ?? {})) {
      if (!/^[A-Za-z0-9_-]+$/.test(layer)) throw new Error(`${path}.layers.${layer}: invalid layer name`);
      wanted.add(`${prefix}${layer}.png`);
    }
  }
  const files = await read(wanted);
  let override: Partial<AvatarManifest> | undefined = manifest ? undefined : { name };
  if (!includeSource && manifest?.source) override = { ...manifest, source: undefined };
  return packAvatar(files, { manifest: override });
}
