import { createMeshAvatar, type MeshAvatar, type MeshAvatarOptions } from '../engine';
import { parseRig } from '../rig/validate';
import type { Rig } from '../rig/types';
import { defaultManifest, parseManifest, type AvatarManifest } from './manifest';
import { validateAvatarFiles } from './validate';
import { checkEntryName, unpackAvatar } from './zip';

export interface AvatarPackage {
  manifest: AvatarManifest;
  rig: Rig;
  assets: Record<string, string>;
  release(): void;
}
export type AvatarSource = string | URL | Blob | ArrayBuffer | Uint8Array | AvatarPackage;
export interface OpenAvatarOptions {
  version?: string | number;
  rigFile?: string;
}
const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
function json(bytes: Uint8Array, path: string) {
  try { return decode(bytes); }
  catch { throw new Error(`${path}: invalid UTF-8 JSON`); }
}
function assetNames(layers: { layers?: Record<string, unknown> }, sprites?: { layers?: Record<string, unknown> }) {
  return ['layers.json', 'base.png', 'hairmask.png', ...Object.keys(layers?.layers ?? {}).map(name => `${name}.png`),
    ...(sprites ? ['sprites/sprites.json', ...Object.keys(sprites.layers ?? {}).map(name => `sprites/${name}.png`)] : [])];
}
function assertValid(files: Parameters<typeof validateAvatarFiles>[0]) {
  const errors = validateAvatarFiles(files);
  if (errors.length) throw new Error(errors.join('\n'));
}
function isPackage(source: AvatarSource): source is AvatarPackage {
  return !!source && typeof source === 'object' && 'manifest' in source && 'rig' in source && 'assets' in source && 'release' in source;
}
function fromArchive(data: ArrayBuffer | Uint8Array): AvatarPackage {
  const files = unpackAvatar(data);
  if (!Object.hasOwn(files, 'avatar.json')) throw new Error('avatar.json: missing file in .mavatar archive');
  assertValid(files);
  const manifest = parseManifest(json(files['avatar.json'], 'avatar.json'));
  const rig = parseRig(json(files['rig.json'], 'rig.json'));
  const names = assetNames(json(files['built/layers.json'], 'built/layers.json'),
    files['built/sprites/sprites.json'] ? json(files['built/sprites/sprites.json'], 'built/sprites/sprites.json') : undefined);
  const assets: Record<string, string> = {}, urls: string[] = [];
  const release = () => { urls.splice(0).forEach(url => URL.revokeObjectURL(url)); };
  try {
    for (const name of new Set(names)) {
      const url = URL.createObjectURL(new Blob([new Uint8Array(files[`built/${name}`])], { type: name.endsWith('.json') ? 'application/json' : 'image/png' }));
      urls.push(url); assets[name] = url;
    }
  } catch (error) { release(); throw error; }
  return { manifest, rig, assets, release };
}

export async function openAvatar(source: AvatarSource, options: OpenAvatarOptions = {}): Promise<AvatarPackage> {
  if (isPackage(source)) return source;
  if (source instanceof Blob) return fromArchive(await source.arrayBuffer());
  if (source instanceof ArrayBuffer || source instanceof Uint8Array) return fromArchive(source);
  const url = new URL(source, typeof location === 'undefined' ? undefined : location.href);
  if (/\.mavatar$/i.test(url.pathname)) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`.mavatar: could not load (${response.status})`);
    return fromArchive(await response.arrayBuffer());
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  const fileUrl = (path: string) => {
    const result = new URL(url);
    result.pathname += path.split('/').map(encodeURIComponent).join('/');
    if (options.version !== undefined) result.searchParams.set('v', String(options.version));
    return result.href;
  };
  const files: Parameters<typeof validateAvatarFiles>[0] = {};
  async function read(path: string, optional = false) {
    const response = await fetch(fileUrl(path));
    // Static SPA servers can return their HTML fallback for absent optional JSON files.
    if (optional && (response.status === 404 || (response.ok && response.headers.get('content-type')?.includes('text/html')))) return;
    if (!response.ok) throw new Error(`${path}: could not load (${response.status})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    files[path] = bytes;
    return json(bytes, path);
  }
  const rigFile = options.rigFile ?? 'rig.json';
  checkEntryName(rigFile);
  const [raw, metadata, manifest, sprites] = await Promise.all([
    read(rigFile), read('built/layers.json'), read('avatar.json', true), read('built/sprites/sprites.json', true),
  ]);
  if (Array.isArray(raw?.eyes) && Array.isArray(metadata?.eyes)) {
    raw.eyes = raw.eyes.map((eye: Record<string, unknown>, i: number) => {
      if (!eye || typeof eye !== 'object') return eye;
      const filled = { ...eye };
      for (const key of ['x0', 'x1', 'top', 'bot']) if (filled[key] === undefined) filled[key] = metadata.eyes[i]?.[key];
      return filled;
    });
  }
  files['rig.json'] = new TextEncoder().encode(JSON.stringify(raw));
  const names = assetNames(metadata, sprites);
  // Folder images stay as URLs; the renderer (or editor preflight) checks image readability.
  for (const name of names) if (name.endsWith('.png')) files[`built/${name}`] = { size: 1 };
  assertValid(files);
  const rig = parseRig(raw);
  const assets = Object.fromEntries(names.map(name => [name, fileUrl(`built/${name}`)]));
  const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) ?? 'Avatar');
  return { manifest: manifest === undefined ? defaultManifest(name) : parseManifest(manifest), rig, assets, release() {} };
}

export async function loadMeshAvatar(canvas: HTMLCanvasElement, source: AvatarSource,
  options: Omit<MeshAvatarOptions, 'rig' | 'assets' | 'assetsBase'> = {}): Promise<MeshAvatar & { package: AvatarPackage }> {
  const owned = !isPackage(source), loaded = await openAvatar(source);
  try {
    const avatar = await createMeshAvatar(canvas, { ...options, rig: loaded.rig, assets: loaded.assets });
    const destroy = avatar.destroy.bind(avatar);
    let destroyed = false;
    return Object.assign(avatar, { package: loaded, destroy() {
      if (destroyed) return;
      destroyed = true;
      try { destroy(); } finally { if (owned) loaded.release(); }
    } });
  } catch (error) { if (owned) loaded.release(); throw error; }
}
