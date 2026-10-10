// Vite bundles its config before applying aliases, so use the public source entry here.
import { parseLighting, type LightingSettings } from '../../packages/runtime/src/index';
export const LIGHTING_EVENT = 'studio:lighting';
export interface LightingMessage { project: string; lighting: Omit<LightingSettings, 'enabled' | 'shadow'> & { enabled: 0 | 1; shadow: 0 | 1 } }
export function lightingMessage(input: unknown): LightingMessage | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || typeof data.project !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(data.project) || !data.lighting || typeof data.lighting !== 'object') return null;
  const value = data.lighting as Record<string, unknown>;
  if (![0, 1].includes(value.enabled as number) || ![0, 1].includes(value.shadow as number)) return null;
  const parsed = parseLighting({ ...value, enabled: value.enabled === 1, shadow: value.shadow === 1 });
  return parsed ? { project: data.project, lighting: { ...parsed, enabled: parsed.enabled ? 1 : 0, shadow: parsed.shadow ? 1 : 0 } } : null;
}
export function lightingWire(project: string, value: LightingSettings): LightingMessage {
  return { project, lighting: { ...value, enabled: value.enabled ? 1 : 0, shadow: value.shadow ? 1 : 0 } };
}
export function lightingValue(message: LightingMessage): LightingSettings {
  return { ...message.lighting, enabled: message.lighting.enabled === 1, shadow: message.lighting.shadow === 1 };
}
