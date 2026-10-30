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
// Fractions of calibrated shoulder width, and degrees of shoulder-line roll.
export const BODY_DEAD_ZONE = Object.freeze({ shift: 0.04, roll: 2, hips: 0.04 });
const smooth = (a: number, b: number, value: number) => {
  const t = clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t);
};
/** Zero inside the threshold, with a zero-slope onset and no threshold jump. */
export function softDeadZone(value: number, threshold: number) {
  if (!Number.isFinite(value)) return 0;
  const excess = Math.max(0, Math.abs(value) - threshold);
  return excess === 0 ? 0 : Math.sign(value) * excess * smooth(0, threshold, excess);
}
function readHips(body: BodyResult | null | undefined) {
  if (!body || !Number.isFinite(body.aspect) || body.aspect <= 0 || body.hips?.length !== 2 || !body.hips.every(p => usable(p, 0.65))) return undefined;
  return (body.hips[0].x + body.hips[1].x) / 2 * body.aspect;
}
export function readBody(body: BodyResult | null | undefined): BodyNeutral | null {
  if (!body || !Number.isFinite(body.aspect) || body.aspect <= 0 || body.shoulders?.length !== 2 || !body.shoulders?.every(p => usable(p, 0.55))) return null;
  const [a, b] = [...body.shoulders].sort((a, b) => a.x - b.x), dx = (b.x - a.x) * body.aspect, dy = b.y - a.y;
  const width = Math.hypot(dx, dy); if (width < 0.03) return null;
  return { shoulderX: (a.x + b.x) / 2 * body.aspect, width, roll: Math.atan2(dy, dx) * 180 / Math.PI,
    ...(readHips(body) !== undefined ? { hipX: readHips(body) } : {}) };
}
export function mapBody(body: BodyNeutral, neutral: BodyNeutral, options: TrackingOptions) {
  const gain = clamp(options.sensitivity, 0.25, 2) * (options.mirror ? -1 : 1);
  const shoulders = (body.shoulderX - neutral.shoulderX) / neutral.width;
  const hips = body.hipX !== undefined && neutral.hipX !== undefined ? (body.hipX - neutral.hipX) / neutral.width : 0;
  return { bodyAngleX: clamp(softDeadZone(shoulders, BODY_DEAD_ZONE.shift) * gain * 20, -10, 10), bodyAngleZ: clamp(softDeadZone(body.roll - neutral.roll, BODY_DEAD_ZONE.roll) * gain, -10, 10), weightShift: clamp(softDeadZone(hips, BODY_DEAD_ZONE.hips) * gain * 1.4, -1, 1) };
}
export class BodyPose {
  private body: BodyNeutral | null = null;
  private neutral: BodyNeutral | null = null;
  private seen = -Infinity;
  private weight = 0;
  private hipX: number | undefined;
  private hipSeen = -Infinity;
  private hipWeight = 0;
  private trusted = { shift: 0, roll: 0 };
  private params = { bodyAngleX: 0, bodyAngleZ: 0, weightShift: 0 };
  update(result: BodyResult | null, now: number) {
    this.body = readBody(result); this.seen = this.body ? now : -Infinity;
    if (!this.neutral && this.body) this.neutral = { ...this.body };
    const hipX = readHips(result);
    if (hipX !== undefined && this.neutral) {
      // First-visible hips define their own neutral; shoulder motion must never
      // become a weight-shift offset, including after seated calibration.
      this.neutral.hipX ??= hipX;
      this.hipX = hipX; this.hipSeen = now;
    }
  }
  calibrate(now: number) {
    if (!this.body || now - this.seen > 500) return false;
    this.neutral = { ...this.body };
    this.trusted = { shift: 0, roll: 0 };
    this.params = { bodyAngleX: 0, bodyAngleZ: 0, weightShift: 0 }; return true;
  }
  reset() {
    this.body = null; this.neutral = null; this.seen = -Infinity;
    this.hipX = undefined; this.hipSeen = -Infinity; this.trusted = { shift: 0, roll: 0 };
  }
  sample(now: number, dt: number, options: TrackingOptions, armActivity = 0) {
    const shouldersActive = !!options.bodyTracking && !!this.body && !!this.neutral && now - this.seen <= 500;
    const alpha = 1 - Math.exp(-Math.max(0, dt) / 0.2);
    const hipsActive = !!options.bodyTracking && !!this.neutral && this.neutral.hipX !== undefined && this.hipX !== undefined && now - this.hipSeen <= 500;
    this.weight += ((shouldersActive ? 1 : 0) - this.weight) * alpha;
    this.hipWeight += ((hipsActive ? 1 : 0) - this.hipWeight) * alpha;
    if (!shouldersActive && this.weight < 0.005) this.weight = 0;
    if (!hipsActive && this.hipWeight < 0.005) this.hipWeight = 0;
    const tau = clamp(options.smoothing, 0, 1) * 0.25;
    const a = tau <= 0 ? 1 : 1 - Math.exp(-Math.max(0, dt) / tau);
    if (shouldersActive) {
      const body = this.body!, neutral = this.neutral!;
      const shift = (body.shoulderX - neutral.shoulderX) / neutral.width, roll = body.roll - neutral.roll;
      const activity = clamp(armActivity, 0, 1);
      if (!activity) this.trusted = { shift, roll };
      const hipShift = body.hipX !== undefined && neutral.hipX !== undefined ? (body.hipX - neutral.hipX) / neutral.width : 0;
      // Independently visible hips can corroborate a real sideways lean. Tiny
      // hip jitter and opposite/disagreeing shifts cannot unlock arm-driven roll.
      const corroboration = shift * hipShift > 0
        ? smooth(0.04, 0.1, Math.abs(hipShift)) * (1 - smooth(0.04, 0.12, Math.abs(shift - hipShift))) : 0;
      const xHold = activity * (1 - corroboration);
      const guarded = { ...body,
        shoulderX: neutral.shoulderX + (shift + (this.trusted.shift - shift) * xHold) * neutral.width,
        roll: neutral.roll + roll + (this.trusted.roll - roll) * activity };
      const target = mapBody(guarded, neutral, options);
      for (const key of ['bodyAngleX', 'bodyAngleZ'] as const) this.params[key] += (target[key] - this.params[key]) * a;
    }
    if (hipsActive) {
      const neutral = this.neutral!, gain = clamp(options.sensitivity, 0.25, 2) * (options.mirror ? -1 : 1);
      const shift = (this.hipX! - neutral.hipX!) / neutral.width;
      const target = clamp(softDeadZone(shift, BODY_DEAD_ZONE.hips) * gain * 1.4, -1, 1);
      this.params.weightShift += (target - this.params.weightShift) * a;
    }
    return { active: shouldersActive || hipsActive, weight: this.weight, hipWeight: this.hipWeight, params: { ...this.params } };
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
  activity(now: number) {
    let activity = 0;
    for (const channels of this.sides) for (const [i, c] of channels.entries()) {
      if (c.neutral === null) continue;
      const confidence = Math.exp(-Math.max(0, now - c.seen - 500) / 200);
      const delta = Math.abs(i === 0 ? angleDelta(c.value, c.neutral) : c.value - c.neutral);
      activity = Math.max(activity, confidence * (i === 0 ? smooth(10, 30, delta) : smooth(15, 45, delta)));
    }
    return activity;
  }
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
