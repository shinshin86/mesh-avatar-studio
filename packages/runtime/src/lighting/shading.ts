// Shared reference math; the shader in renderer.js follows the same formulas.
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const TERMINATOR = -0.1;
export const DETAIL_SCALE = 0.9;
export const SHADOW_SATURATION = 1.0;
export const MAX_IRRADIANCE = 1.06;
/** Colour of an unpremultiplied albedo under a grey irradiance level. */
export function shadedColor(albedo: readonly number[], irradiance: number) {
  const dark = 1 - Math.max(0, Math.min(1, irradiance));
  return albedo.map(v => v * (1 + (v - 1) * dark * SHADOW_SATURATION) * irradiance);
}
export function diffuseTerm(ndl: number, mode: 'soft' | 'cel', softness: number) {
  if (mode === 'cel') {
    const w = 0.01 + softness * 0.08;
    return 0.2 + 0.45 * smoothstep(TERMINATOR - w, TERMINATOR + w, ndl) + 0.35 * smoothstep(0.55 - w, 0.55 + w, ndl);
  }
  const s = 0.05 + softness * 0.5;
  // A soft terminator, then a gentle rise toward surfaces facing the light.
  return smoothstep(TERMINATOR - s, TERMINATOR + s, ndl) * (0.35 + 0.65 * Math.max(0, ndl));
}
export function attenuation(distance: number, reach: number) { return 1 / (1 + (distance / reach) ** 2); }
export function rimTerm(nz: number, facing: number) { return (1 - Math.max(0, nz)) ** 4 * smoothstep(-0.2, 0.7, facing); }
export function shadowOffset(x: number, y: number): [number, number] { return [(0.5 - x) * 0.12, (0.5 - y) * 0.12]; }
export function headRotation(angleX: number, angleY: number, angleZ: number, maxRoll: number) {
  const yaw = angleX * Math.PI / 180, pitch = angleY * Math.PI / 180, roll = -angleZ / 30 * maxRoll;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  // Column-major Rz * Ry * Rx, in image coordinates (y points down).
  return [cr * cy, sr * cy, -sy, cr * sy * sp - sr * cp, sr * sy * sp + cr * cp, cy * sp,
    cr * sy * cp + sr * sp, sr * sy * cp - cr * sp, cy * cp];
}
