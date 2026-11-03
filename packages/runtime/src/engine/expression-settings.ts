import { OVERLAY_EXPRESSIONS } from './expression-overlay.js';

/** Per-expression settings for a live expression shown with `setExpression`. */
export interface ExpressionMouthSettings {
  /** Resting mouth opening, 0–1. Replaces the built-in value (surprise 0.6, the others 0). */
  mouthOpen?: number;
}

/** Optional settings keyed by live expression name; an entry for `neutral` is ignored. */
export type ExpressionSettings = Partial<Record<Exclude<keyof typeof OVERLAY_EXPRESSIONS, 'neutral'>, ExpressionMouthSettings>>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function parseExpressionSettings(input: unknown): ExpressionSettings {
  if (!isObject(input)) throw new TypeError('expressions: expected an object');
  const settings: Record<string, ExpressionMouthSettings> = {};
  for (const [name, entry] of Object.entries(input)) {
    // Names this runtime does not know are ignored, so files written for newer runtimes still load.
    // `neutral` leaves the parameters untouched, so an entry for it is ignored the same way.
    if (name === 'neutral' || !Object.hasOwn(OVERLAY_EXPRESSIONS, name)) continue;
    if (!isObject(entry)) throw new TypeError(`expressions.${name}: expected an object`);
    const parsed: ExpressionMouthSettings = {}, value = entry.mouthOpen;
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
        throw new RangeError(`expressions.${name}.mouthOpen: expected 0–1`);
      parsed.mouthOpen = value;
    }
    settings[name] = parsed;
  }
  return settings as ExpressionSettings;
}

/** Explicit settings override saved ones for each expression and field. */
export function mergeExpressionSettings(saved: ExpressionSettings = {}, explicit: ExpressionSettings = {}): ExpressionSettings {
  const merged: Record<string, ExpressionMouthSettings> = {};
  for (const name of new Set([...Object.keys(saved), ...Object.keys(explicit)]))
    merged[name] = { ...saved[name as keyof ExpressionSettings], ...explicit[name as keyof ExpressionSettings] };
  return merged as ExpressionSettings;
}
