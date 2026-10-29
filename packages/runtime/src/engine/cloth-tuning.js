/** @type {Readonly<import('../rig/types').ClothTuning>} */
export const CLOTH_DEFAULTS = Object.freeze({
  responseGain: 1, swing: 1, stiffness: 1, damping: 1, follow: 0.85, cohesion: 3, wind: 0.05, max: 20,
});

/** Validate a partial override before applying it to any garment. */
export function checkClothTuning(tuning) {
  if (!tuning || typeof tuning !== 'object' || Array.isArray(tuning)) throw new TypeError('Expected cloth tuning');
  for (const [key, value] of Object.entries(tuning)) {
    if (!Object.hasOwn(CLOTH_DEFAULTS, key)) throw new RangeError(`Unknown cloth tuning: ${key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`${key}: expected a finite number`);
    if (['responseGain', 'swing', 'stiffness', 'damping', 'max'].includes(key) && value <= 0) throw new RangeError(`${key}: must be positive`);
    if (['follow', 'wind'].includes(key) && (value < 0 || (key === 'follow' && value > 1))) throw new RangeError(`${key}: out of range`);
    if (key === 'cohesion' && (!Number.isInteger(value) || value < 0 || value > 8)) throw new RangeError('cohesion: expected an integer from 0 to 8');
  }
}
