// Drives parameters: idle ("auto idle"), mouse follow, blinking, expressions, motions.
import { PARAMS } from './rig.js';
import { MOTIONS, IDLE_MOTIONS, ADDITIVE, sampleTrack } from './motions.js';
import { VOWELS, kanaToMoras, sampleMoras } from './kana.js';

const ALL_MOTIONS = { ...MOTIONS, ...IDLE_MOTIONS };
// scales the head / body / arm tracks of idle motions (they are authored at full size, so 1)
// (gaze, eyes and brows are left alone)
export const IDLE_GAIN = { amp: 1, stiff: 1.8 };
const IDLE_SCALED = /^(angle|bodyAngle|armAngle|handAngle)/;

// motion tracks that replace the expression (the rest are additive or body targets)
const FACE_TRACKS = new Set(['eyeOpen', 'eyeOpenL', 'eyeSmileL', 'eyeSmile', 'mouthOpen',
  'mouthForm', 'blush', 'browY', 'browAngle']);
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// smooth 1D value noise
function noise(t, seed) {
  const i = Math.floor(t), f = t - i;
  const h = n => { const x = Math.sin((n + seed * 57.3) * 127.1) * 43758.5453; return x - Math.floor(x); };
  const u = f * f * (3 - 2 * f);
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}
const fbm = (t, s) => noise(t, s) * 0.7 + noise(t * 2.3, s + 9) * 0.3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const EXPRESSIONS = {
  normal: { label: 'Neutral', p: {} },
  smile: { label: 'Smile', p: { eyeOpen: 0, eyeSmile: 1, blush: 0.35, browY: 0.2 } },
  shy: { label: 'Blush', p: { eyeOpen: 0.78, eyeSmile: 0.5, blush: 1, browAngle: -0.5, browY: -0.1, glance: [0.7, 0.35] } },
  jito: { label: 'Half-lidded', p: { eyeOpen: 0.5, browY: -0.5, browAngle: 0.6 } },
  surprise: { label: 'Surprise', p: { eyeOpen: 1.22, browY: 1, mouthOpen: 0.6, mouthForm: 0.6 } },
  wink: { label: 'Wink', p: { eyeOpenL: 0, eyeSmileL: 1, blush: 0.3 } },
  // talking faces for AITuber OnAir emotion tags: eyes stay mostly open (closed / ^^ eyes are
  // what a single image fakes worst, and they would stay shut for a whole sentence)
  happyTalk: { label: 'happy', p: { eyeOpen: 0.8, eyeSmile: 0.45, blush: 0.35, browY: 0.25, mouthForm: -0.5 } },
  sadTalk: { label: 'sad', p: { eyeOpen: 0.78, browAngle: -0.8, browY: -0.2, mouthForm: 0.3, glance: [0, -0.35] } },
  angryTalk: { label: 'angry', p: { eyeOpen: 0.72, browAngle: 0.85, browY: -0.55, mouthForm: 0.2 } },
  surprisedTalk: { label: 'surprised', p: { eyeOpen: 1.18, browY: 0.9, mouthForm: 0.9 } },
  relaxedTalk: { label: 'relaxed', p: { eyeOpen: 0.82, eyeSmile: 0.35, blush: 0.15, browY: 0.1 } },
};

// emotion tag -> [expression, motion played when the line starts]
const EMOTIONS = {
  happy: ['happyTalk', 'nod'],
  sad: ['sadTalk', 'sigh'],
  angry: ['angryTalk', 'no'],
  surprised: ['surprisedTalk', 'surprise'],
  relaxed: ['relaxedTalk', 'sway'],
  neutral: ['normal', null],
};

// [stiffness, damping ratio] of the parameter smoothing; unlisted params use [120, 0.95]
const SPRINGS = {
  gazeX: [260, 0.9], gazeY: [260, 0.9],
  angleX: [55, 0.72], angleY: [55, 0.72], angleZ: [45, 0.75],
  bodyAngleX: [14, 0.9], bodyAngleZ: [12, 0.9],
  armAngle: [20, 0.85], handAngle: [30, 0.8],
};

export class Motion {
  /** @param {number[]} gazeCenter */
  constructor(gazeCenter) {
    this.mode = 'auto';           // auto | mouse | manual
    this.P = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
    this.manual = { ...this.P };
    this.cur = { ...this.P };      // smoothed values
    this.vel = Object.fromEntries(PARAMS.map(p => [p.id, 0]));
    this.expr = 'normal';
    this.exprMix = {};             // smoothed expression values
    this.t = 0;
    this.blink = { t: 0, start: 1.5, double: false };
    this.gaze = { x: 0, y: 0, next: 0 };
    this.tap = { next: 4, until: -1 };
    this.pointer = null;           // image px
    this.faceCenter = [...gazeCenter];
    this.lipOpen = null;           // external mouth value from lip sync
    this.lipForm = 0;
    this.speaking = false;         // TTS audio playing (setSpeaking)
    this.voice = 0;                // 0..1 loudness (setVoiceLevel)
    this.mouth = 0;
    this.vowel = 'a';
    this.vowelForm = 0;
    this.syllableArmed = true;
    this.voicePeak = 0;
    this.voiceTrough = 0;
    this.kana = null;
    this.lipHold = null;
    this.emotionUntil = 0;         // when the emotion face goes back to normal
    this.talkGain = 1;             // how much the head moves along with the voice
    this.play = null;              // { id, t } of the motion being played
    this.autoMotion = true;        // "auto idle" plays a reaction motion now and then
    this.nextAuto = 14;
    this.autoIdle = true;          // ...and small idle motions more often
    this.nextIdle = 3;
    this.lastAuto = null;
    this.onMotion = null;          // UI callback (id or null)
  }

  setExpression(k) { this.expr = k; }

  hasMotion(id) { return id in ALL_MOTIONS; }

  // ---- speech (driven from outside, e.g. by the TTS audio analyser) ----
  setVoiceLevel(v) { this.voice = Math.min(1, Math.max(0, Number(v) || 0)); }

  setSpeaking(on) {
    if (on === this.speaking) return;
    this.speaking = !!on;
    if (!on) {
      // hold the emotion a moment after the line, then go back to the plain face
      this.emotionUntil = this.t + 1.2;
      this.voice = 0;
    }
  }

  /** `playMotion: false` changes only the face (a caller that picks motions itself). */
  setEmotion(tag, { playMotion = true } = {}) {
    const e = EMOTIONS[tag] ?? EMOTIONS.neutral;
    this.expr = e[0];
    this.emotionUntil = Infinity;
    if (e[1] && playMotion) this.playMotion(e[1]);
  }

  /** Mouth shapes from kana text, without audio (preview / tuning). */
  /** @param {string} text @param {{ speed?: number, loop?: boolean }} [options] */
  speakKana(text, { speed, loop = false } = {}) {
    this.lipHold = null;
    const moras = kanaToMoras(text, speed === undefined ? 0.14 : 1 / clamp(Number(speed) || 7, 4, 12));
    this.kana = moras.length ? { moras, t: 0, loop, duration: moras.reduce((sum, m) => sum + m.dur, 0) } : null;
  }

  holdMouth(vowel) {
    this.kana = null;
    this.lipHold = Object.hasOwn(VOWELS, vowel) ? vowel : null;
  }

  stopLipSync() {
    this.kana = null; this.lipHold = null; this.lipOpen = null; this.mouth = 0;
  }

  getLipSyncState() {
    return { active: this.kana !== null || this.lipHold !== null, open: this.P.mouthOpen, form: this.P.mouthForm };
  }

  // Mouth from the TTS loudness. A volume signal has no vowel information, so each syllable
  // (the voice dipping and rising again) gets one vowel at random, weighted towards a, and
  // keeps it until the next syllable: the drawn mouths must not change shape mid-syllable.
  // Syllables are found relative to the recent peak (not an absolute level), and the mouth
  // is scaled by where the voice sits between the recent trough and peak, so it closes in
  // the dip before each mora even when a loud voice never gets quiet.
  speechMouth(dt) {
    if (this.kana || this.lipHold) {
      let m;
      if (this.lipHold) m = VOWELS[this.lipHold];
      else {
        this.kana.t += dt;
        if (this.kana.loop) this.kana.t %= this.kana.duration;
        m = sampleMoras(this.kana.moras, this.kana.t);
      }
      if (!m) { this.kana = null; return this.mouth > 0.01 ? [this.mouth *= 0.6, this.vowelForm] : null; }
      const k = m.open > this.mouth ? 1 - Math.exp(-dt * 30) : 1 - Math.exp(-dt * 22);
      this.mouth += (m.open - this.mouth) * k;
      if (m.form !== null) this.vowelForm = m.form;
      return [this.mouth, this.vowelForm];
    }
    const v = this.speaking ? this.voice : 0;
    // recent peak / trough: follow at once, then relax over ~0.2 s
    const relax = 1 - Math.exp(-dt * 5);
    this.voicePeak = v > this.voicePeak ? v : this.voicePeak + (v - this.voicePeak) * relax;
    this.voiceTrough = v < this.voiceTrough ? v : this.voiceTrough + (v - this.voiceTrough) * relax;
    const peak = Math.max(this.voicePeak, 0.05);
    if (v < peak * 0.6) this.syllableArmed = true;
    else if (this.syllableArmed && v > peak * 0.8 && v > 0.1) {
      this.syllableArmed = false;
      const r = Math.random();
      this.vowel = r < 0.4 ? 'a' : r < 0.58 ? 'o' : r < 0.74 ? 'e' : r < 0.88 ? 'i' : 'u';
    }
    const range = this.voicePeak - this.voiceTrough;
    const rise = range < peak * 0.3 ? 1 : Math.max(0, (v - this.voiceTrough) / range);
    const shape = VOWELS[this.vowel ?? 'a'];
    const level = Math.min(1, Math.pow(v, 0.7) * 1.15) * Math.pow(rise, 0.3);
    const target = this.speaking ? Math.min(0.95, level) * (0.45 + 0.55 * shape.open / 0.9) : 0;
    // quick attack, quick release: the mouth has to shut between morae (~7 per second)
    const k = target > this.mouth ? 1 - Math.exp(-dt * 40) : 1 - Math.exp(-dt * 32);
    this.mouth += (target - this.mouth) * k;
    if (this.speaking) this.vowelForm = shape.form;   // after the line: close in the last shape
    return this.speaking || this.mouth > 0.01 ? [this.mouth, this.vowelForm] : null;
  }

  // Breathing: inhale ~40% of the cycle, a slower exhale, a short pause at the bottom,
  // and a period that drifts between ~3.2 and 4.6 s so it never looks metronomic.
  breathValue(dt) {
    this.breathPhase = (this.breathPhase ?? 0) + dt / (this.breathPeriod ?? 3.8);
    if (this.breathPhase >= 1) { this.breathPhase -= 1; this.breathPeriod = 3.2 + Math.random() * 1.4; }
    const x = this.breathPhase;
    if (x < 0.4) return sstep(0, 0.4, x);
    if (x < 0.88) return 1 - sstep(0.4, 0.88, x);
    return 0;
  }

  // pick one at random, never the one that just played
  playRandom(ids) {
    const pool = ids.filter(k => k !== this.lastAuto);
    this.playMotion(pool[Math.floor(Math.random() * pool.length)]);
  }

  playMotion(id) {
    this.lastAuto = id;
    this.play = { id, t: 0 };
    this.onMotion?.(id);
  }

  blinkValue(dt) {
    const b = this.blink;
    b.t += dt;
    if (b.t < b.start) return 1;
    const x = (b.t - b.start) / 0.17;
    if (x >= 1) {
      if (b.double) { b.double = false; b.start = b.t + 0.07; }
      else { b.start = b.t + 1.8 + Math.random() * 4.2; b.double = Math.random() < 0.18; }
      return 1;
    }
    return x < 0.45 ? 1 - x / 0.45 : (x - 0.45) / 0.55;
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const T = {};                  // targets
    for (const p of PARAMS) T[p.id] = p.def;

    if (this.mode === 'manual') {
      Object.assign(T, this.manual);
    } else if (this.mode === 'auto') {
      // wandering plus following the gaze: the eyes jump first, the head turns after them
      T.angleX = fbm(t * 0.18, 1) * 10 + this.gaze.x * 11;
      T.angleY = fbm(t * 0.15, 2) * 6 - 1 + this.gaze.y * 7;
      T.angleZ = fbm(t * 0.12, 3) * 10;
      T.bodyAngleX = fbm(t * 0.1, 4) * 5;
      T.bodyAngleZ = fbm(t * 0.09, 5) * 4;
      T.armAngle = fbm(t * 0.14, 6) * 5;
      T.handAngle = fbm(t * 0.21, 7) * 5;
      // glances
      if (t > this.gaze.next) {
        const r = Math.random();
        this.gaze.x = r < 0.45 ? 0 : (Math.random() * 2 - 1) * 0.8;
        this.gaze.y = r < 0.45 ? 0 : (Math.random() * 2 - 1) * 0.5;
        this.gaze.next = t + 0.8 + Math.random() * 2.5;
      }
      T.gazeX = this.gaze.x + T.angleX / 60;
      T.gazeY = this.gaze.y + T.angleY / 60;
      // occasional finger tapping on the chin
      if (t > this.tap.next) { this.tap.until = t + 1.1; this.tap.next = t + 5 + Math.random() * 6; }
      // random playback: reactions every ~15-25 s, small idle motions every few seconds in between
      // while talking: no random motions, just nod along with the voice
      if (this.speaking) {
        this.nextIdle = Math.max(this.nextIdle, t + 2.5);
        this.nextAuto = Math.max(this.nextAuto, t + 6);
        const g = this.talkGain;
        this.talkNod = (this.talkNod ?? 0) + (this.voice * 7 * g - (this.talkNod ?? 0)) * Math.min(1, dt * 6);
        T.angleY -= this.talkNod;
        T.angleX += fbm(t * 0.6, 11) * 5 * g;
        T.angleZ += fbm(t * 0.5, 12) * 4 * g;
      }
      if (!this.speaking && t > this.emotionUntil) { this.expr = 'normal'; this.emotionUntil = Infinity; }
      if (this.speaking) { /* no random playback */ }
      else if (!this.play && this.autoMotion && t > this.nextAuto) {
        this.playRandom(Object.keys(MOTIONS).filter(k => k !== 'surprise'));
        this.nextAuto = t + 15 + Math.random() * 10;
        this.nextIdle = Math.max(this.nextIdle, t + 5);
      } else if (!this.play && this.autoIdle && t > this.nextIdle) {
        this.playRandom(Object.keys(IDLE_MOTIONS));
        this.nextIdle = t + 5 + Math.random() * 5;   // counted from the start, so 1-5 s of plain idling after it
      }
    } else if (this.mode === 'mouse' && this.pointer) {
      const dx = (this.pointer[0] - this.faceCenter[0]) / 500, dy = (this.pointer[1] - this.faceCenter[1]) / 500;
      T.angleX = clamp(dx * 30, -30, 30);
      T.angleY = clamp(-dy * 30, -30, 30);
      T.angleZ = clamp(-dx * dy * 25, -12, 12);
      T.bodyAngleX = clamp(dx * 10, -10, 10) * 0.6;
      T.gazeX = clamp(dx * 1.4, -1, 1);
      T.gazeY = clamp(-dy * 1.4, -1, 1);
      T.handAngle = clamp(dx * 4, -5, 5);
    }
    if (this.mode !== 'manual') {
      T.breath = this.breathValue(dt);
      if (t < this.tap.until) T.fingerTap = Math.max(0, Math.sin((this.tap.until - t) * Math.PI * 3.6)) ** 2;
    }

    // motion: body/head tracks go into the targets, so the springs smooth them too
    let M = null, mw = 0;
    if (this.play) {
      const def = ALL_MOTIONS[this.play.id];
      this.play.t += dt;
      if (this.play.t >= def.dur) { this.play = null; this.onMotion?.(null); }
      else {
        M = {};
        for (const [id, keys] of Object.entries(def.tracks))
          M[id] = sampleTrack(keys, this.play.t) * (def.idle && IDLE_SCALED.test(id) ? IDLE_GAIN.amp : 1);
        mw = sstep(0, 0.15, this.play.t) * (1 - sstep(def.dur - 0.25, def.dur, this.play.t));
        for (const [id, v] of Object.entries(M)) {
          if (ADDITIVE.has(id)) T[id] += v;
          else if (id === 'breath') T[id] += (v - T[id]) * mw;   // a motion sets its own breathing
          else if (!FACE_TRACKS.has(id)) T[id] = Math.max(T[id], Math.max(0, v));
        }
      }
    }

    if (this.mode !== 'manual') T.angleY += T.breath * 1.6;

    // expression layer (smoothed so switching is not a jump)
    const E = EXPRESSIONS[this.expr].p;
    const keys = ['eyeOpen', 'eyeOpenL', 'eyeSmileL', 'eyeSmile', 'mouthOpen', 'mouthForm', 'blush', 'browY', 'browAngle', 'gx', 'gy'];
    const target = { eyeOpen: E.eyeOpen ?? 1, eyeOpenL: E.eyeOpenL ?? E.eyeOpen ?? 1, eyeSmileL: E.eyeSmileL ?? E.eyeSmile ?? 0,
      eyeSmile: E.eyeSmile ?? 0, mouthOpen: E.mouthOpen ?? 0, mouthForm: E.mouthForm ?? 0,
      blush: E.blush ?? 0, browY: E.browY ?? 0, browAngle: E.browAngle ?? 0,
      gx: E.glance?.[0] ?? 0, gy: E.glance?.[1] ?? 0 };
    const k = 1 - Math.exp(-dt * 9);
    for (const key of keys) {
      if (this.exprMix[key] === undefined) this.exprMix[key] = target[key];
      this.exprMix[key] += (target[key] - this.exprMix[key]) * k;
    }
    const X = this.exprMix;

    // spring-damper towards the targets for body params
    const out = {};
    for (const p of PARAMS) {
      const id = p.id;
      if (this.mode === 'manual' && !M) { out[id] = T[id]; this.cur[id] = T[id]; this.vel[id] = 0; continue; }
      // eyes lead, the head follows with a slight overshoot, the body trails behind
      let [stiff, zeta] = SPRINGS[id] ?? [120, 0.95];
      // keyframed motions are already smooth; follow them more tightly than idle wandering
      // keyframed motions are followed more tightly than the idle wandering; idle motions a
      // bit less so they stay soft but still reach their poses
      if (M && /^angle|^body/.test(id)) {
        if (ALL_MOTIONS[this.play?.id ?? '']?.idle) { stiff *= IDLE_GAIN.stiff; zeta = 0.8; }
        else if (/^angle/.test(id)) { stiff *= 4.5; zeta = 0.75; }
      }
      const damp = 2 * Math.sqrt(stiff) * zeta;
      this.vel[id] += (stiff * (T[id] - this.cur[id]) - damp * this.vel[id]) * dt;
      this.cur[id] += this.vel[id] * dt;
      out[id] = this.cur[id];
    }
    let blink = 1;
    if (this.mode !== 'manual') {
      blink = this.blinkValue(dt);
      out.eyeROpen = X.eyeOpen * blink;
      out.eyeLOpen = X.eyeOpenL * blink;
      out.eyeSmile = X.eyeSmile;
      out.eyeSmileL = X.eyeSmileL;
      out.mouthOpen = X.mouthOpen;
      out.mouthForm = X.mouthForm;
      out.blush = X.blush;
      // brows dip a little with each blink and lift when looking up
      out.browY = X.browY + (out.angleY > 0 ? out.angleY / 60 : 0) - (1 - blink) * 0.18;
      out.browAngle = X.browAngle;
      out.gazeX = clamp(out.gazeX + X.gx, -1, 1);
      out.gazeY = clamp(out.gazeY + X.gy, -1, 1);
    } else {
      out.eyeSmileL = out.eyeSmile;
    }
    if (M) {
      const mix = (key, v) => { out[key] += (v - out[key]) * mw; };
      const clampEye = v => Math.min(1.3, Math.max(0, v));
      if ('eyeOpen' in M) { mix('eyeROpen', clampEye(M.eyeOpen) * blink); if (!('eyeOpenL' in M)) mix('eyeLOpen', clampEye(M.eyeOpen) * blink); }
      if ('eyeOpenL' in M) mix('eyeLOpen', clampEye(M.eyeOpenL) * blink);
      if ('eyeSmile' in M) { mix('eyeSmile', M.eyeSmile); if (!('eyeSmileL' in M)) mix('eyeSmileL', M.eyeSmile); }
      if ('eyeSmileL' in M) mix('eyeSmileL', M.eyeSmileL);
      for (const id of ['mouthOpen', 'mouthForm', 'blush', 'browY', 'browAngle'])
        if (id in M) mix(id, id === 'mouthOpen' || id === 'blush' ? Math.max(0, M[id]) : M[id]);
    }
    const sm = this.speechMouth(dt);
    if (sm) { this.lipOpen = sm[0]; this.lipForm = sm[1]; }
    else if (this.lipOpen !== null && !this.speaking && !this.kana) this.lipOpen = null;
    if (this.lipOpen !== null) {
      out.mouthOpen = Math.max(out.mouthOpen * 0.3, this.lipOpen);
      // while talking the voice decides the vowel; the expression's form would shift it
      out.mouthForm = clamp(this.lipForm, -1, 1);
    }
    this.P = out;
    return out;
  }
}
