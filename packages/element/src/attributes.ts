import { LIVE_EXPRESSIONS, type LiveExpression } from 'mesh-avatar';

/** Shown when the element has no `src`: the Miko sample published with the Mesh Avatar Studio site. */
export const DEFAULT_SRC = 'https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar';

export const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral'] as const;
export type Emotion = typeof EMOTIONS[number];
export type Fit = 'contain' | 'cover';

/** Returns the expression, 'neutral' when the attribute is missing, or undefined when it is unknown. */
export function parseExpression(value: string | null): LiveExpression | undefined {
  if (value === null || value === '') return 'neutral';
  return (LIVE_EXPRESSIONS as string[]).includes(value) ? value as LiveExpression : undefined;
}

/** Returns the emotion, null when the attribute is missing, or undefined when it is unknown. */
export function parseEmotion(value: string | null): Emotion | null | undefined {
  if (value === null || value === '') return null;
  return (EMOTIONS as readonly string[]).includes(value) ? value as Emotion : undefined;
}

/** Returns the fit, 'contain' when the attribute is missing, or undefined when it is unknown. */
export function parseFit(value: string | null): Fit | undefined {
  if (value === null || value === '') return 'contain';
  return value === 'contain' || value === 'cover' ? value : undefined;
}

/** Overlay layer names from a space-separated attribute; none when it is missing or empty. */
export function parseOverlays(value: string | null): string[] {
  return value ? value.split(/\s+/).filter(Boolean) : [];
}

/** Seconds since the previous frame, limited like the runtime's own loop. */
export function frameSeconds(now: number, previous: number) {
  return Math.min(0.05, Math.max(0.001, (now - previous) / 1000));
}

/**
 * A promise for the avatar that is loading now. A load that starts before the previous one
 * finished keeps the same pending promise, so callers waiting on it get the newest avatar.
 */
export class ReadySignal<T> {
  promise!: Promise<T>;
  #resolve!: (value: T) => void;
  #reject!: (error: unknown) => void;
  #settled = true;

  /** Call when a load starts. */
  start() {
    if (!this.#settled) return;
    this.#settled = false;
    this.promise = new Promise<T>((resolve, reject) => { this.#resolve = resolve; this.#reject = reject; });
    // Callers who never await `ready` should not see unhandled rejections.
    this.promise.catch(() => {});
  }

  resolve(value: T) { if (!this.#settled) { this.#settled = true; this.#resolve(value); } }
  reject(error: unknown) { if (!this.#settled) { this.#settled = true; this.#reject(error); } }
}
