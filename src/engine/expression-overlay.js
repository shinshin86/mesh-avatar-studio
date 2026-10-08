// Expressions layered over tracked or posed parameters, so blinking, gaze and the mouth keep
// following the camera or microphone while the face holds a smile, a frown and so on.
import { EXPRESSIONS } from './motion.js';

/** Expressions offered for live switching, in key order (1 = neutral). */
export const OVERLAY_EXPRESSIONS = {
  neutral: 'normal', smile: 'smile', shy: 'shy', surprise: 'surprise',
  halfLidded: 'jito', angry: 'angryTalk', sad: 'sadTalk', wink: 'wink',
};
// Brows are often hidden under bangs, so some faces also lean on gaze and head pitch to read.
const POSE = { sad: { pitch: -6, gy: -0.45 } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const NEUTRAL = Object.freeze({ eyeOpen: 1, eyeOpenL: 1, eyeSmile: 0, eyeSmileL: 0, blush: 0, browY: 0, browAngle: 0, mouthOpen: 0, gx: 0, gy: 0, pitch: 0 });

export function overlayTarget(name) {
  const E = EXPRESSIONS[OVERLAY_EXPRESSIONS[name]]?.p ?? {}, pose = POSE[name] ?? {};
  return { eyeOpen: E.eyeOpen ?? 1, eyeOpenL: E.eyeOpenL ?? E.eyeOpen ?? 1, eyeSmile: E.eyeSmile ?? 0,
    eyeSmileL: E.eyeSmileL ?? E.eyeSmile ?? 0, blush: E.blush ?? 0, browY: E.browY ?? 0, browAngle: E.browAngle ?? 0,
    mouthOpen: E.mouthOpen ?? 0, gx: E.glance?.[0] ?? 0, gy: pose.gy ?? E.glance?.[1] ?? 0, pitch: pose.pitch ?? 0 };
}

/** Eyes scale with the expression so blinks still show; smiles, blush and brows add on top. */
export function applyOverlay(P, m) {
  const out = { ...P };
  out.eyeROpen = (P.eyeROpen ?? 1) * m.eyeOpen;
  out.eyeLOpen = (P.eyeLOpen ?? 1) * m.eyeOpenL;
  out.eyeSmile = Math.max(P.eyeSmile ?? 0, m.eyeSmile);
  out.eyeSmileL = Math.max(P.eyeSmileL ?? P.eyeSmile ?? 0, m.eyeSmileL);
  out.blush = Math.max(P.blush ?? 0, m.blush);
  out.browY = clamp((P.browY ?? 0) + m.browY, -1, 1);
  out.browAngle = clamp((P.browAngle ?? 0) + m.browAngle, -1, 1);
  out.mouthOpen = Math.max(P.mouthOpen ?? 0, m.mouthOpen);
  out.gazeX = clamp((P.gazeX ?? 0) + m.gx, -1, 1);
  out.gazeY = clamp((P.gazeY ?? 0) + m.gy, -1, 1);
  out.angleY = clamp((P.angleY ?? 0) + m.pitch, -30, 30);
  return out;
}

/** Smoothed switching. While neutral and settled the parameters pass through untouched. */
export class ExpressionOverlay {
  /** @type {keyof typeof OVERLAY_EXPRESSIONS} */
  name = 'neutral';
  mix = { ...NEUTRAL };
  /** @param {string} name */
  set(name) { this.name = Object.hasOwn(OVERLAY_EXPRESSIONS, name) ? /** @type {keyof typeof OVERLAY_EXPRESSIONS} */ (name) : 'neutral'; }
  /** True while an expression is shown or still fading out. */
  get active() { return this.name !== 'neutral' || Object.keys(NEUTRAL).some(k => Math.abs(this.mix[k] - NEUTRAL[k]) > 1e-3); }
  apply(P, dt) {
    if (!this.active) { this.mix = { ...NEUTRAL }; return P; }
    const target = overlayTarget(this.name), k = 1 - Math.exp(-Math.max(0, dt) * 12);
    for (const key of Object.keys(NEUTRAL)) this.mix[key] += (target[key] - this.mix[key]) * k;
    return applyOverlay(P, this.mix);
  }
}
