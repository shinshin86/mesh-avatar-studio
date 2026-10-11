// Vite bundles its config before applying aliases, so use the public source entry here.
import { PARAMS } from '../../packages/runtime/src/index';

export interface FaceResult {
  faceLandmarks: unknown[][];
  faceBlendshapes: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes: { data: number[] }[];
}
export interface RawFace { yaw: number; pitch: number; roll: number; shapes: Record<string, number> }
export interface TrackingOptions { mirror: boolean; sensitivity: number; smoothing: number }
export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
export const faceNeutral: Record<string, number> = {
  angleX: 0, angleY: 0, angleZ: 0, bodyAngleX: 0, bodyAngleZ: 0,
  eyeLOpen: 1, eyeROpen: 1, gazeX: 0, gazeY: 0, mouthOpen: 0, mouthForm: 0, browY: 0, eyeSmile: 0, eyeSmileL: 0,
};
export function readFace(result: FaceResult): RawFace | null {
  const matrix = result.facialTransformationMatrixes[0]?.data;
  if (!result.faceLandmarks.length || !matrix || matrix.length !== 16 || !matrix.every(Number.isFinite)) return null;
  // MediaPipe matrices are column-major. Remove scale before extracting Y-X-Z rotation.
  const m = [...matrix];
  for (const offset of [0, 4, 8]) {
    const length = Math.hypot(m[offset], m[offset + 1], m[offset + 2]);
    if (length < 1e-6) return null;
    for (let i = 0; i < 3; i++) m[offset + i] /= length;
  }
  const degrees = 180 / Math.PI;
  return { yaw: Math.atan2(m[8], m[10]) * degrees, pitch: Math.asin(clamp(-m[9], -1, 1)) * degrees,
    roll: Math.atan2(m[1], m[5]) * degrees,
    shapes: Object.fromEntries((result.faceBlendshapes[0]?.categories ?? []).map(shape => [shape.categoryName, clamp(shape.score)])) };
}
const angleDelta = (value: number, neutral: number) => ((value - neutral + 540) % 360) - 180;
export function mapFace(face: RawFace, neutral: RawFace | null, options: TrackingOptions): Record<string, number> {
  const s = (key: string) => face.shapes[key] ?? 0;
  const n = (key: string) => neutral?.shapes[key] ?? 0;
  const d = (key: string) => s(key) - n(key);
  const mean = (a: string, b: string) => (d(a) + d(b)) / 2;
  const mirror = options.mirror ? -1 : 1, gain = clamp(options.sensitivity, 0.25, 2);
  const x = clamp(angleDelta(face.yaw, neutral?.yaw ?? 0) * gain * mirror, -30, 30);
  const y = clamp(angleDelta(face.pitch, neutral?.pitch ?? 0) * gain, -30, 30);
  const z = clamp(angleDelta(face.roll, neutral?.roll ?? 0) * gain * mirror, -30, 30);
  const open = (side: string) => {
    const blink = s(`eyeBlink${side}`);
    return blink >= 0.85 ? 0 : clamp((1 - blink) / Math.max(0.2, 1 - n(`eyeBlink${side}`)), 0, 1.25);
  };
  const smile = clamp((mean('mouthSmileLeft', 'mouthSmileRight') + mean('cheekSquintLeft', 'cheekSquintRight')) * 0.3);
  return { angleX: x, angleY: y, angleZ: z, bodyAngleX: x * 0.2, bodyAngleZ: z * 0.2,
    eyeLOpen: open(options.mirror ? 'Right' : 'Left'), eyeROpen: open(options.mirror ? 'Left' : 'Right'),
    gazeX: clamp((d('eyeLookOutRight') - d('eyeLookInRight') + d('eyeLookInLeft') - d('eyeLookOutLeft')) * mirror, -1, 1),
    gazeY: clamp(mean('eyeLookUpLeft', 'eyeLookUpRight') - mean('eyeLookDownLeft', 'eyeLookDownRight'), -1, 1),
    mouthOpen: clamp((d('jawOpen') - Math.max(0, d('mouthClose'))) * gain / Math.max(0.2, 1 - n('jawOpen'))),
    mouthForm: clamp((d('mouthPucker') + d('mouthFunnel') - mean('mouthSmileLeft', 'mouthSmileRight') - mean('mouthStretchLeft', 'mouthStretchRight')) * gain, -1, 1),
    browY: clamp((d('browInnerUp') + mean('browOuterUpLeft', 'browOuterUpRight') - mean('browDownLeft', 'browDownRight')) * gain, -1, 1),
    eyeSmile: smile, eyeSmileL: smile };
}
export function smoothParameters(current: Record<string, number>, target: Record<string, number>, dt: number, smoothing: number) {
  const tau = clamp(smoothing) * 0.25;
  const alpha = tau === 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau);
  return Object.fromEntries(Object.entries(target).map(([key, value]) => [key, (current[key] ?? value) + (value - (current[key] ?? value)) * alpha]));
}
export class FacePose {
  private face: RawFace | null = null;
  private neutral: RawFace | null = null;
  private seen = -Infinity;
  private params = { ...faceNeutral };
  private weight = 0;
  update(result: FaceResult, now: number) {
    const face = readFace(result);
    if (face) { this.face = face; this.seen = now; }
  }
  calibrate(now: number) {
    if (!this.face || now - this.seen > 500) return false;
    this.neutral = structuredClone(this.face); this.params = { ...faceNeutral }; return true;
  }
  reset() { this.face = null; this.neutral = null; this.seen = -Infinity; }
  sample(now: number, dt: number, options: TrackingOptions) {
    const tracking = !!this.face && now - this.seen <= 500;
    const target = tracking ? mapFace(this.face!, this.neutral, options) : faceNeutral;
    this.params = smoothParameters(this.params, target, dt, tracking ? options.smoothing : 0.7);
    if (tracking) for (const eye of ['eyeLOpen', 'eyeROpen']) if (target[eye] === 0) this.params[eye] = 0;
    this.weight = tracking ? 1 : this.weight * Math.exp(-dt / 0.2);
    if (this.weight < 0.005) this.weight = 0;
    return { tracking, params: { ...this.params }, weight: this.weight };
  }
}
export function rmsLevel(samples: Float32Array, gain: number): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return clamp((Math.sqrt(sum / samples.length) - 0.008) * clamp(gain, 0, 10) * 5);
}
export const parameterRanges = new Map(PARAMS.map(param => [param.id, [param.min, param.max] as const]));
parameterRanges.set('eyeSmileL', [0, 1]);
