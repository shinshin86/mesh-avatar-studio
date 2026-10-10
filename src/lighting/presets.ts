// Vite bundles its config before applying aliases, so use the public source entry here.
import { DEFAULT_LIGHTING, parseLighting, type LightingSettings } from '../../packages/runtime/src/index';

export const LIGHTING_PRESET_COUNT = 8;
/** Slot i holds preset number i + 1; empty slots are null. */
export type LightingPresets = (LightingSettings | null)[];

export function parseLightingPresets(stored: unknown): LightingPresets {
  return Array.from({ length: LIGHTING_PRESET_COUNT }, (_, i) => {
    const value: unknown = Array.isArray(stored) ? stored[i] : null;
    // Presets saved before newer options existed keep their values; missing options use defaults.
    return value && typeof value === 'object' && !Array.isArray(value) ? parseLighting({ ...DEFAULT_LIGHTING, ...value }) : null;
  });
}
export function sameLighting(a: LightingSettings, b: LightingSettings) {
  return (Object.keys(DEFAULT_LIGHTING) as (keyof LightingSettings)[]).every(key => a[key] === b[key]);
}
export function loadLightingPresets(project: string): LightingPresets {
  try { return parseLightingPresets(JSON.parse(localStorage.getItem(`mesh-avatar:lighting-presets:${project}`) ?? 'null')); }
  catch { return parseLightingPresets(null); }
}
export function saveLightingPresets(project: string, presets: LightingPresets) {
  try { localStorage.setItem(`mesh-avatar:lighting-presets:${project}`, JSON.stringify(presets)); } catch { /* Storage is optional. */ }
}
