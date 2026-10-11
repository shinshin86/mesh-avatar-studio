export interface AvatarManifest {
  format: 'mesh-avatar';
  version: 1;
  name: string;
  author?: string;
  license?: string;
  thumbnail?: string;
  source?: string;
  studio?: { version: string };
}

export function parseManifest(input: unknown): AvatarManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('avatar.json: expected an object');
  }
  const value = input as Record<string, unknown>, errors: string[] = [];
  if (value.format !== 'mesh-avatar') errors.push('avatar.json.format: expected "mesh-avatar"');
  if (value.version !== 1) errors.push(`avatar.json.version: unsupported version ${JSON.stringify(value.version) ?? 'missing'} (expected 1)`);
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push('avatar.json.name: expected a non-empty string');
  const manifest: AvatarManifest = { format: 'mesh-avatar', version: 1, name: value.name as string };
  for (const key of ['author', 'license', 'thumbnail', 'source'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'string') errors.push(`avatar.json.${key}: expected a string`);
    else manifest[key] = value[key];
  }
  if (value.studio !== undefined) {
    const studio = value.studio;
    if (!studio || typeof studio !== 'object' || Array.isArray(studio)
      || !('version' in studio) || typeof studio.version !== 'string' || !studio.version.trim()) {
      errors.push('avatar.json.studio.version: expected a non-empty string');
    } else manifest.studio = { version: studio.version };
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return manifest;
}

export function defaultManifest(name: string): AvatarManifest {
  return parseManifest({ format: 'mesh-avatar', version: 1, name });
}
