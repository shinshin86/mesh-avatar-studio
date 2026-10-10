import type { LightingSettings } from 'mesh-avatar';
import { lightingFromQuery, writeLightingQuery } from '../lighting/storage';
export const SAMPLE_PROJECT = 'sample-miko-qipao';
export interface ViewSettings {
  project: string;
  avatar?: string;
  background: string;
  fit: 'contain' | 'cover';
  idle: boolean;
  lighting?: LightingSettings;
}
export function backgroundColor(value: string | null): string {
  if (value === 'green') return '#00ff00';
  if (value === 'blue') return '#0000ff';
  if (value && /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return `#${value.replace('#', '')}`;
  return 'transparent';
}
export function viewSettings(search: string): ViewSettings {
  const query = new URLSearchParams(search), project = query.get('project');
  return { project: project && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(project) ? project : SAMPLE_PROJECT,
    ...(!query.has('project') && query.get('avatar') ? { avatar: query.get('avatar')! } : {}),
    background: backgroundColor(query.get('bg')), fit: query.get('fit') === 'cover' ? 'cover' : 'contain', idle: query.get('idle') !== '0', ...(query.has('light') ? { lighting: lightingFromQuery(query) } : {}) };
}
export function streamUrl(settings: ViewSettings, origin: string): string {
  const url = new URL('/stream.html', origin);
  url.search = new URLSearchParams({ project: settings.project, bg: settings.background, fit: settings.fit, idle: settings.idle ? '1' : '0' }).toString();
  if (settings.avatar) { url.searchParams.delete('project'); url.searchParams.set('avatar', settings.avatar); }
  if (settings.lighting) writeLightingQuery(url.searchParams, settings.lighting);
  return url.href;
}
