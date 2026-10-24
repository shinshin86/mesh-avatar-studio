export interface LipSyncSettings {
  granularity?: number;
  openness?: number;
  closeSpeed?: number;
  /** Editor selection only; playback uses the numeric settings. */
  preset?: 'calm' | 'default' | 'lively' | 'subtle' | 'big' | 'custom';
}

type ResolvedLipSync = Required<Pick<LipSyncSettings, 'granularity' | 'openness' | 'closeSpeed'>>;

export function parseLipSyncSettings(input: unknown): LipSyncSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('lipSync: expected an object');
  const raw = input as LipSyncSettings, settings: LipSyncSettings = {};
  for (const key of ['granularity', 'openness', 'closeSpeed'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError(`lipSync.${key}: expected 0–1`);
    settings[key] = value;
  }
  if (raw.preset !== undefined) {
    if (!['calm', 'default', 'lively', 'subtle', 'big', 'custom'].includes(raw.preset))
      throw new RangeError('lipSync.preset: expected calm, default, lively, subtle, big or custom');
    settings.preset = raw.preset;
  }
  return settings;
}

export function resolveLipSync(input: LipSyncSettings = {}, base: ResolvedLipSync = {
  granularity: 0.5, openness: 0.5, closeSpeed: 0.5,
}): ResolvedLipSync {
  const settings = parseLipSyncSettings(input);
  return { granularity: settings.granularity ?? base.granularity,
    openness: settings.openness ?? base.openness, closeSpeed: settings.closeSpeed ?? base.closeSpeed };
}

// Center values are explicit so the unconfigured path keeps its original constants.
const centered = (value: number, low: number, center: number, high: number) => value === 0.5 ? center
  : value < 0.5 ? low + (center - low) * value * 2 : center + (high - center) * (value - 0.5) * 2;
export function lipMotionOptions(settings: ResolvedLipSync) {
  return {
    arm: centered(settings.granularity, 0.2, 0.6, 0.9),
    trigger: centered(settings.granularity, 0.65, 0.8, 0.95),
    relax: centered(settings.granularity, 1.5, 5, 12),
    range: centered(settings.granularity, 0.7, 0.3, 0.05),
    risePower: centered(settings.granularity, 0.05, 0.3, 0.8),
    openness: centered(settings.openness, 0.55, 1, 1.25),
    audioRelease: centered(settings.closeSpeed, 6, 32, 45),
    kanaRelease: centered(settings.closeSpeed, 6, 22, 45),
  };
}
