import { colorHex, DEFAULT_LIGHTING, parseLighting, type LightingSettings } from 'mesh-avatar';

// URL parameter names; colours are six hex digits without '#'.
const params = { x: 'lx', y: 'ly', z: 'lz', strength: 'ls', intensity: 'li', ambient: 'la',
  reach: 'lr', softness: 'lf', specular: 'lsp', rim: 'lrim', detail: 'ld' } as const;
export function lightingFromQuery(query: URLSearchParams): LightingSettings {
  const value = { ...DEFAULT_LIGHTING, enabled: query.get('light') === '1', shadow: query.get('shadow') === '1', mode: query.get('lm') === 'cel' ? 'cel' : 'soft' } as LightingSettings;
  for (const [key, param] of Object.entries(params)) {
    const raw = query.get(param), n = Number(raw);
    if (raw?.trim() && Number.isFinite(n)) (value as unknown as Record<string, unknown>)[key] = n;
  }
  for (const [key, param] of [['color', 'lc'], ['ambientColor', 'lac']] as const) {
    const color = query.get(param);
    if (color && /^[0-9a-f]{6}$/i.test(color)) value[key] = parseInt(color, 16);
  }
  return parseLighting(value)!;
}
export function writeLightingQuery(query: URLSearchParams, value: LightingSettings) {
  query.set('light', value.enabled ? '1' : '0');
  for (const [key, param] of Object.entries(params)) query.set(param, String(value[key as keyof typeof params]));
  query.set('lc', colorHex(value.color).slice(1)); query.set('lac', colorHex(value.ambientColor).slice(1));
  query.set('lm', value.mode); query.set('shadow', value.shadow ? '1' : '0');
}
export function loadLighting(project: string): LightingSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(`mesh-avatar:lighting:${project}`) ?? 'null');
    // Settings saved before newer options existed keep their values; missing options use defaults.
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? parseLighting({ ...DEFAULT_LIGHTING, ...stored }) ?? { ...DEFAULT_LIGHTING } : { ...DEFAULT_LIGHTING };
  }
  catch { return { ...DEFAULT_LIGHTING }; }
}
export function saveLighting(project: string, value: LightingSettings) {
  try { localStorage.setItem(`mesh-avatar:lighting:${project}`, JSON.stringify(value)); } catch { /* Storage is optional. */ }
}
