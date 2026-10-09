import { LIGHTING_PRESET_COUNT } from '../lighting/presets';

// Expression and lighting preset switches sent from other apps (keyboard shortcuts, button
// panels) through the local development server to the Live page.
export const EXPRESSION_EVENT = 'studio:expression';
export const EXPRESSION_PATH = '/__live/expression';
export const LIGHTING_PRESET_EVENT = 'studio:lighting-preset';
export const LIGHTING_PRESET_PATH = '/__live/lighting';
export const EXPRESSION_TOKEN_PATH = '/__live/expression-token';
export const TOKEN_HEADER = 'x-studio-token';
export const REMOTE_EXPRESSIONS = ['neutral', 'smile', 'shy', 'surprise', 'halfLidded', 'angry', 'sad', 'wink'] as const;
export type RemoteExpression = typeof REMOTE_EXPRESSIONS[number];
export interface ExpressionMessage { expression: RemoteExpression; project: string | null }
export interface LightingPresetMessage { preset: number; project: string | null }

const projectName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** The object with only `field` and an optional plain project name, or null. */
function remoteBody(input: unknown, field: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => key !== field && key !== 'project')) return null;
  if (data.project !== undefined && data.project !== null && (typeof data.project !== 'string' || !projectName.test(data.project))) return null;
  return { value: data[field], project: typeof data.project === 'string' ? data.project : null };
}
/** Accepts `{ expression, project? }` with a known expression and a plain project name only. */
export function expressionMessage(input: unknown): ExpressionMessage | null {
  const body = remoteBody(input, 'expression');
  if (!body || typeof body.value !== 'string' || !(REMOTE_EXPRESSIONS as readonly string[]).includes(body.value)) return null;
  return { expression: body.value as RemoteExpression, project: body.project };
}
/** Accepts `{ preset, project? }` with a preset number from 1 to 8. */
export function lightingPresetMessage(input: unknown): LightingPresetMessage | null {
  const body = remoteBody(input, 'preset');
  if (!body || !Number.isInteger(body.value) || (body.value as number) < 1 || (body.value as number) > LIGHTING_PRESET_COUNT) return null;
  return { preset: body.value as number, project: body.project };
}
