import type { LightingSettings } from 'mesh-avatar';
import { lightingFromQuery, writeLightingQuery } from '../lighting/storage';
import { overlayNames } from './overlay-protocol';
export const SAMPLE_PROJECT = 'sample-miko-qipao';
export interface ViewSettings {
  project: string;
  avatar?: string;
  background: string;
  fit: 'contain' | 'cover';
  idle: boolean;
  lighting?: LightingSettings;
  /** Overlay layers shown on the avatar, such as glasses. */
  overlays?: string[];
}
export function backgroundColor(value: string | null): string {
  if (value === 'green') return '#00ff00';
  if (value === 'blue') return '#0000ff';
  if (value && /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return `#${value.replace('#', '')}`;
  return 'transparent';
}
export function viewSettings(search: string, origin = globalThis.location?.origin ?? 'http://localhost'): ViewSettings {
  const query = new URLSearchParams(search), project = query.get('project');
  let avatar: string | undefined;
  try {
    const value = query.get('avatar');
    if (!query.has('project') && value) {
      const url = new URL(value, origin);
      if (url.origin === origin && /^https?:$/.test(url.protocol) && !url.username && !url.password) avatar = value;
    }
  } catch { /* Invalid or external URLs fall back to the sample. */ }
  return { project: project && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) ? project : SAMPLE_PROJECT,
    ...(avatar ? { avatar } : {}),
    background: backgroundColor(query.get('bg')), fit: query.get('fit') === 'cover' ? 'cover' : 'contain', idle: query.get('idle') !== '0', ...(query.has('light') ? { lighting: lightingFromQuery(query) } : {}),
    ...(query.has('overlays') ? { overlays: overlayNames(query.get('overlays')!.split(',').filter(Boolean)) ?? [] } : {}) };
}
const overlaysKey = (project: string) => `mesh-avatar-live-overlays:${project}`;
/** Overlays last shown for a project on this Live page; storage may be unavailable. */
export function loadOverlays(project: string): string[] {
  try { return overlayNames(JSON.parse(localStorage.getItem(overlaysKey(project)) ?? '[]')) ?? []; } catch { return []; }
}
export function saveOverlays(project: string, overlays: string[]) {
  try { localStorage.setItem(overlaysKey(project), JSON.stringify(overlays)); } catch { /* the choice is kept for this page only */ }
}
export function streamUrl(settings: ViewSettings, origin: string): string {
  const url = new URL('/stream.html', origin);
  url.search = new URLSearchParams({ project: settings.project, bg: settings.background, fit: settings.fit, idle: settings.idle ? '1' : '0' }).toString();
  if (settings.avatar) { url.searchParams.delete('project'); url.searchParams.set('avatar', settings.avatar); }
  if (settings.lighting) writeLightingQuery(url.searchParams, settings.lighting);
  if (settings.overlays?.length) url.searchParams.set('overlays', settings.overlays.join(','));
  return url.href;
}
