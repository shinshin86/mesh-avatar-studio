import type { TrackingOptions } from './tracking';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
export interface BodyPoint { x: number; y: number; visibility: number; presence?: number }
export interface BodyResult { shoulders: [BodyPoint, BodyPoint]; hips: [BodyPoint, BodyPoint]; aspect: number }
export interface BodyNeutral { shoulderX: number; width: number; roll: number; hipX?: number }
const usable = (p: BodyPoint, threshold: number) => p && [p.x, p.y, p.visibility, p.presence ?? 1].every(Number.isFinite) && p.visibility >= threshold && (p.presence ?? 1) >= 0.5;
export function readBody(body: BodyResult | null | undefined): BodyNeutral | null {
  if (!body || !Number.isFinite(body.aspect) || body.aspect <= 0 || body.shoulders?.length !== 2 || !body.shoulders?.every(p => usable(p, 0.55))) return null;
  const [a, b] = [...body.shoulders].sort((a, b) => a.x - b.x), dx = (b.x - a.x) * body.aspect, dy = b.y - a.y;
  const width = Math.hypot(dx, dy); if (width < 0.03) return null;
  return { shoulderX: (a.x + b.x) / 2 * body.aspect, width, roll: Math.atan2(dy, dx) * 180 / Math.PI,
    ...(body.hips?.length === 2 && body.hips.every(p => usable(p, 0.65)) ? { hipX: (body.hips[0].x + body.hips[1].x) / 2 * body.aspect } : {}) };
}
export function mapBody(body: BodyNeutral, neutral: BodyNeutral, options: TrackingOptions) {
  const gain = clamp(options.sensitivity, 0.25, 2) * (options.mirror ? -1 : 1);
  const shoulders = (body.shoulderX - neutral.shoulderX) / neutral.width;
  const hips = body.hipX !== undefined && neutral.hipX !== undefined ? (body.hipX - neutral.hipX) / neutral.width : shoulders;
  return { bodyAngleX: clamp(shoulders * gain * 20, -10, 10), bodyAngleZ: clamp((body.roll - neutral.roll) * gain, -10, 10), weightShift: clamp(hips * gain * 1.4, -1, 1) };
}
export class BodyPose {
  private body: BodyNeutral | null = null;
  private neutral: BodyNeutral | null = null;
  private seen = -Infinity;
  private weight = 0;
  private params = { bodyAngleX: 0, bodyAngleZ: 0, weightShift: 0 };
  update(result: BodyResult | null, now: number) {
    this.body = readBody(result); this.seen = this.body ? now : -Infinity;
    if (!this.neutral && this.body) this.neutral = { ...this.body };
    // Hips may first appear after a seated calibration. Keep the current shoulder
    // displacement as their initial offset, avoiding a new calibration jump.
    if (this.body?.hipX !== undefined && this.neutral && this.neutral.hipX === undefined)
      this.neutral.hipX = this.body.hipX - (this.body.shoulderX - this.neutral.shoulderX);
  }
  calibrate(now: number) {
    if (!this.body || now - this.seen > 500) return false;
    this.neutral = { ...this.body }; this.params = { bodyAngleX: 0, bodyAngleZ: 0, weightShift: 0 }; return true;
  }
  reset() { this.body = null; this.neutral = null; this.seen = -Infinity; }
  sample(now: number, dt: number, options: TrackingOptions) {
    const active = !!options.bodyTracking && !!this.body && !!this.neutral && now - this.seen <= 500;
    const alpha = 1 - Math.exp(-Math.max(0, dt) / 0.2);
    this.weight += ((active ? 1 : 0) - this.weight) * alpha;
    if (!active && this.weight < 0.005) this.weight = 0;
    if (active) {
      const target = mapBody(this.body!, this.neutral!, options), tau = options.smoothing * 0.25;
      const a = tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau);
      for (const key of ['bodyAngleX', 'bodyAngleZ', 'weightShift'] as const) this.params[key] += (target[key] - this.params[key]) * a;
    }
    return { active, weight: this.weight, params: { ...this.params } };
  }
}
