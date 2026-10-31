import { openAvatar, parseRig, type Rig, type AvatarPackage, parseManifest, type LipSyncSettings } from 'mesh-avatar';
import type { LocalProject, LocalProjectEntry } from '../project-types';
import { FolderOpenError } from './folder-errors';
import { packProjectAvatar } from '../../packages/runtime/src/format/project-archive';
export type { LocalProject, LocalProjectEntry } from '../project-types';

const sampleBase = '/miko-qipao/';
export const sampleSourceUrl = `${sampleBase}source.png`;
let samplePackage: Promise<AvatarPackage> | undefined;
export function openSampleAvatar() {
  return samplePackage ??= openAvatar(sampleBase).catch(error => { samplePackage = undefined; throw error; });
}

export interface ProjectAssets {
  sourceUrl: string;
  assets: Record<string, string>;
  rig?: Rig;
  urls: string[];
  lipSync?: LipSyncSettings;
}
export async function openProjectFolder(files: File[]): Promise<ProjectAssets> {
  const entries = files.map(file => ({ file, path: file.webkitRelativePath.replace(/^[^/]+\//, '') || file.name }));
  const source = entries.find(entry => /(^|\/)source\.png$/i.test(entry.path));
  const layers = entries.find(entry => /(^|\/)layers\.json$/i.test(entry.path));
  if (!source || !layers) throw new FolderOpenError('missingFolderFiles', [!source ? 'source.png' : '', !layers ? 'layers.json' : ''].filter(Boolean));
  const read = async (entry: typeof entries[number]) => {
    try { return await entry.file.arrayBuffer(); }
    catch { throw new FolderOpenError('unreadableFolder', [entry.path]); }
  };
  const prefix = layers.path.slice(0, -'layers.json'.length);
  const rigFile = entries.find(entry => /(^|\/)rig\.json$/i.test(entry.path));
  const rig = rigFile ? parseRig(JSON.parse(new TextDecoder().decode(await read(rigFile)))) : undefined;
  const layerBytes = await read(layers);
  const metadata = JSON.parse(new TextDecoder().decode(layerBytes)) as { layers?: Record<string, unknown> };
  if (!metadata.layers || typeof metadata.layers !== 'object') throw new Error('layers.json must contain layer rectangles.');
  const available = new Set(entries.filter(entry => entry.path.startsWith(prefix)).map(entry => entry.path.slice(prefix.length)));
  const required = ['base.png', 'hairmask.png', ...(rig?.cloth?.length ? ['base_cloth.png'] : []), ...Object.keys(metadata.layers).map(name => `${name}.png`)];
  const missing = required.filter(name => !available.has(name));
  if (missing.length) throw new FolderOpenError('missingFolderFiles', missing.map(name => `${prefix}${name}`));
  // Reading the bytes catches locked files before replacing the current project.
  // Object URLs alone do not read a File and defer failures to the preview.
  const sourceBytes = await read(source);
  const built = [];
  for (const entry of entries.filter(entry => entry.path.startsWith(prefix))) {
    built.push({ entry, bytes: entry === layers ? layerBytes : await read(entry) });
  }
  const manifestFile = entries.find(entry => entry.path === 'avatar.json');
  const lipSync = manifestFile ? parseManifest(JSON.parse(new TextDecoder().decode(await read(manifestFile)))).lipSync : undefined;
  const urls: string[] = [];
  const sourceUrl = URL.createObjectURL(new Blob([sourceBytes], { type: source.file.type }));
  urls.push(sourceUrl);
  const assets = Object.fromEntries(built.map(({ entry, bytes }) => {
    const url = URL.createObjectURL(new Blob([bytes], { type: entry.file.type }));
    urls.push(url);
    return [entry.path.slice(prefix.length), url];
  }));
  return { sourceUrl, assets, rig, urls, lipSync };
}

export async function localProjects(): Promise<LocalProjectEntry[] | null> {
  if (!import.meta.env.DEV) return null;
  try {
    const response = await fetch('/__studio/projects');
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return null;
    const list = await response.json();
    return Array.isArray(list) ? list : null;
  } catch { return null; }
}
const baseUrl = (project: LocalProject) => `/__studio/projects/${encodeURIComponent(project.name)}/`;
export async function repositoryContext(): Promise<{ rootPath: string; displayRootPath: string } | null> {
  if (!import.meta.env.DEV) return null;
  try { const response = await fetch('/__studio/context'); return response.ok && response.headers.get('content-type')?.includes('application/json') ? await response.json() : null; } catch { return null; }
}
export async function copySample(rig: Rig): Promise<LocalProject> {
  const response = await fetch('/__studio/copy-sample', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rig) });
  if (!response.ok) throw new Error('Could not copy the sample.');
  return response.json();
}
export async function importAvatar(file: File): Promise<LocalProject> {
  if (file.size > 128 * 1024 * 1024) throw new Error('Archive exceeds 128 MiB.');
  const response = await fetch('/__studio/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
export async function exportAvatar(name: string, includeSource: boolean, pickedFiles?: File[], lipSync?: LipSyncSettings): Promise<Blob> {
  if (pickedFiles) {
    const entries = new Map(pickedFiles.map(file => [file.webkitRelativePath.replace(/^[^/]+\//, '') || file.name, file]));
    const bytes = await packProjectAvatar(async paths => {
      const files: Record<string, Uint8Array> = Object.create(null);
      for (const path of paths) {
        const file = entries.get(path);
        if (file) files[path] = new Uint8Array(await file.arrayBuffer());
      }
      return files;
    }, { name, includeSource, lipSync });
    return new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  }
  const response = await fetch('/__studio/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: name, includeSource, lipSync }) });
  if (!response.ok) throw new Error((await response.json()).error);
  return response.blob();
}
export async function revealRepository() {
  const response = await fetch('/__studio/reveal', { method: 'POST' });
  if (!response.ok) throw new Error('Could not open repository.');
}
export const variantGroups = {
  eyes: ['eyes_closed', 'eyes_half', 'eyes_smile'],
  expression: ['eyes_sad', 'eyes_surprise', 'mouth_angry', 'mouth_sad'],
  mouth: ['mouth_a', 'mouth_a_half', 'mouth_i', 'mouth_o'],
} as const;
export type VariantGroup = keyof typeof variantGroups;
export const variantNames = [...variantGroups.eyes, ...variantGroups.expression, ...variantGroups.mouth] as const;
export type VariantName = typeof variantNames[number];
export interface VariantRequest { name: VariantName; prompt: string; maskUrl: string }
export interface JobResult { path: string; log: string; requests?: VariantRequest[] }
export type ProjectJob = 'rebuild' | 'variant-requests' | 'import-variants';
export class ProjectJobError extends Error {
  constructor(public code: string, public log = '') { super(code); }
}
export async function runProjectJob(project: LocalProject, action: ProjectJob, rig: Rig, files: File[] = []): Promise<JobResult> {
  let body: object = { rig };
  if (action === 'import-variants') {
    if (!files.length || files.length > variantNames.length || new Set(files.map(file => file.name)).size !== files.length || files.some(file => !variantNames.some(name => file.name === `${name}.png`) || file.size > 24 * 1024 * 1024) || files.reduce((sum, file) => sum + file.size, 0) > 26 * 1024 * 1024) throw new ProjectJobError('invalidImages');
    body = { files: await Promise.all(files.map(file => new Promise<{ name: string; data: string }>((done, reject) => {
      const reader = new FileReader(); reader.onload = () => done({ name: file.name, data: String(reader.result).split(',')[1] }); reader.onerror = () => reject(new ProjectJobError('invalidImages')); reader.readAsDataURL(file);
    }))) };
  }
  const response = await fetch(`${baseUrl(project)}${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new ProjectJobError(result.code ?? (response.status === 400 && action === 'import-variants' ? 'invalidImages' : 'toolFailed'), result.log ?? result.error);
  return result;
}
export async function projectVariantRequests(project: LocalProject): Promise<VariantRequest[]> {
  try { return (await jsonFile(`${baseUrl(project)}variants`)).requests ?? []; } catch { return []; }
}
async function jsonFile(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Project could not load.');
  return response.json();
}
export async function openLocalProject(project: LocalProject): Promise<ProjectAssets> {
  const base = baseUrl(project), version = Date.now();
  const { rig, assets, manifest } = await openAvatar(base, { version, rigFile: project.rigFile });
  const sourceUrl = project.hasSource === false ? '' : `${base}source.png?v=${version}`;
  // Check images before replacing the editor's current project.
  const urls = [sourceUrl, ...Object.entries(assets).filter(([name]) => name.endsWith('.png')).map(([, url]) => url)].filter(Boolean);
  await Promise.all(urls.map(url => new Promise<void>((done, reject) => {
    const image = new Image(); image.onload = () => done(); image.onerror = () => reject(new Error('Missing project image.')); image.src = url;
  })));
  return { sourceUrl, assets, rig, urls: [], lipSync: manifest.lipSync };
}
export async function projectAction(project: LocalProject, action: 'rig' | 'reveal', rig?: Rig): Promise<{ path: string }> {
  const response = await fetch(`${baseUrl(project)}${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: rig ? JSON.stringify(rig) : '{}' });
  if (!response.ok) throw new Error('Project operation failed.');
  return response.json();
}

export class RenameError extends Error {
  constructor(readonly reason: 'invalid' | 'taken' | 'failed') { super(`Rename ${reason}.`); }
}
/** Renames the project folder (and its manifest name); resolves with the project under the new name. */
export async function renameProject(project: LocalProject, name: string): Promise<LocalProject> {
  const response = await fetch(`${baseUrl(project)}rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  const result = await response.json().catch(() => ({}));
  if (response.ok) return result;
  throw new RenameError(response.status === 400 ? 'invalid' : response.status === 409 && /exists/.test(result.error ?? '') ? 'taken' : 'failed');
}

export function sampleImagesAvailable(): Promise<boolean> {
  return Promise.all([sampleSourceUrl, `${sampleBase}built/base.png`].map(url => new Promise<boolean>(resolve => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  }))).then(results => results.every(Boolean));
}

export async function saveLipSync(project: LocalProject, lipSync: LipSyncSettings) {
  const response = await fetch(`${baseUrl(project)}lip-sync`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lipSync) });
  if (!response.ok) throw new Error('Could not save lip sync settings.');
}
