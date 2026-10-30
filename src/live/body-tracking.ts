import type { TrackingOptions } from './tracking';
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
export interface BodyPoint { x: number; y: number; visibility: number; presence?: number }
/** Joint pairs retain MediaPipe anatomical left/right order, before mirroring. */
export interface BodyResult {
  shoulders: [BodyPoint, BodyPoint]; hips: [BodyPoint, BodyPoint]; aspect: number;
  elbows?: [BodyPoint, BodyPoint]; wrists?: [BodyPoint, BodyPoint];
}
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

interface ArmAngles { upper: number; bend?: number }
/** Image-plane angles, aspect corrected and relative to the torso inclination. */
export function readArm(body: BodyResult | null, side: number, roll = readBody(body)?.roll ?? 0): ArmAngles | null {
  if (!body || !Number.isFinite(body.aspect) || body.aspect <= 0) return null;
  const shoulder = body.shoulders?.[side], elbow = body.elbows?.[side], wrist = body.wrists?.[side];
  if (!shoulder || !elbow || !usable(shoulder, 0.55) || !usable(elbow, 0.55)) return null;
  const ux = (elbow.x - shoulder.x) * body.aspect, uy = elbow.y - shoulder.y;
  const length = Math.hypot(ux, uy);
  if (length < 0.02) return null;
  const upper = Math.atan2(ux, uy) * 180 / Math.PI + roll;
  if (!wrist || !usable(wrist, 0.55)) return { upper };
  const vx = (wrist.x - elbow.x) * body.aspect, vy = wrist.y - elbow.y, forearm = Math.hypot(vx, vy);
  if (forearm < 0.02) return { upper };
  return { upper, bend: Math.acos(clamp((ux * vx + uy * vy) / (length * forearm), -1, 1)) * 180 / Math.PI };
}
interface ArmChannel { value: number; neutral: number | null; seen: number; weight: number; param: number }
const channel = (): ArmChannel => ({ value: 0, neutral: null, seen: -Infinity, weight: 0, param: 0 });
const angleDelta = (value: number, neutral: number) => ((value - neutral + 540) % 360) - 180;
/** Independent upper-arm and elbow channels let a hidden wrist release only the bend. */
export class ArmPose {
  private sides = [ [channel(), channel()], [channel(), channel()] ];
  private roll = 0;
  update(body: BodyResult | null, now: number) {
    this.roll = readBody(body)?.roll ?? this.roll;
    this.sides.forEach((channels, side) => {
      const angles = readArm(body, side, this.roll);
      for (const [i, value] of [angles?.upper, angles?.bend].entries()) {
        if (value === undefined) continue;
        const c = channels[i]; c.value = value; c.seen = now;
        if (c.neutral === null) c.neutral = value;
      }
    });
  }
  calibrate(now: number) {
    let available = false;
    for (const channels of this.sides) for (const c of channels) {
      const visible = now - c.seen <= 500;
      c.neutral = visible ? c.value : null; c.param = 0;
      if (!visible) c.weight = 0;
      available ||= visible;
    }
    return available;
  }
  reset() { this.sides = [[channel(), channel()], [channel(), channel()]]; this.roll = 0; }
  sample(now: number, dt: number, options: TrackingOptions) {
    const params: Record<string, number> = {}, weights: Record<string, number> = {};
    let active = false;
    const fade = 1 - Math.exp(-Math.max(0, dt) / 0.2);
    const tau = clamp(options.smoothing, 0, 1) * 0.25;
    const smooth = tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau);
    const gain = clamp(options.sensitivity, 0.25, 2);
    for (const [side, channels] of this.sides.entries()) {
      // Raw anatomical left is camera-image right. Mirror swaps its destination,
      // while outward swing retains its sign on both sides.
      const imageSide = (options.mirror ? side === 0 : side === 1) ? 'L' : 'R';
      for (const [i, c] of channels.entries()) {
        const visible = !!options.bodyTracking && !!options.armsTracking && c.neutral !== null && now - c.seen <= 500;
        active ||= visible;
        c.weight += ((visible ? 1 : 0) - c.weight) * fade;
        if (!visible && c.weight < 0.005) c.weight = 0;
        if (visible) {
          const target = i === 0
            ? clamp(angleDelta(c.value, c.neutral!) * (side === 0 ? 1 : -1) * gain / 45, -1, 1)
            // A clearly bent (90 degree) elbow maps to 0.6 at normal sensitivity.
            : clamp((c.value - c.neutral!) * gain / 150, 0, 0.75);
          c.param += (target - c.param) * smooth;
        }
        if (c.weight > 0) {
          const key = `${i === 0 ? 'armSwing' : 'elbowBend'}${imageSide}`;
          params[key] = c.param; weights[key] = c.weight;
        }
      }
    }
    return { active, params, weights };
  }
}
