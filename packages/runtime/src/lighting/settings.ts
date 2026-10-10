export interface LightingSettings {
  enabled: boolean; x: number; y: number; z: number; color: number;
  strength: number; intensity: number; ambient: number; mode: 'soft' | 'cel'; shadow: boolean;
  reach: number; ambientColor: number; softness: number; specular: number; rim: number; detail: number;
}
export const DEFAULT_LIGHTING: Readonly<LightingSettings> = Object.freeze({
  enabled: false, x: 0.2, y: 0.2, z: 0.45, color: 0xffffff,
  strength: 0.8, intensity: 0.8, ambient: 0.4, mode: 'soft', shadow: false,
  reach: 1.2, ambientColor: 0xeef0f8, softness: 0.45, specular: 0.12, rim: 0.3, detail: 0.4,
});
const ranges = { x: [0, 1], y: [0, 1], z: [0.1, 2], color: [0, 0xffffff], strength: [0, 1], intensity: [0, 2], ambient: [0, 1],
  reach: [0.2, 3], ambientColor: [0, 0xffffff], softness: [0, 1], specular: [0, 1], rim: [0, 1], detail: [0, 1] } as const;
const colors = new Set(['color', 'ambientColor']);
// Strict wire format: only finite numbers and enumerated strings; no arbitrary payloads.
export function parseLighting(input: unknown): LightingSettings | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).length !== Object.keys(DEFAULT_LIGHTING).length || Object.keys(data).some(k => !(k in DEFAULT_LIGHTING))) return null;
  if (![true, false].includes(data.enabled as boolean) || ![true, false].includes(data.shadow as boolean) || !['soft', 'cel'].includes(data.mode as string)) return null;
  const result = { ...DEFAULT_LIGHTING, enabled: data.enabled, shadow: data.shadow, mode: data.mode } as LightingSettings;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const value = data[key], [min, max] = ranges[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || (colors.has(key) && !Number.isInteger(value))) return null;
    result[key] = Math.max(min, Math.min(max, value));
  }
  return result;
}
export function colorHex(color: number) { return `#${color.toString(16).padStart(6, '0')}`; }
