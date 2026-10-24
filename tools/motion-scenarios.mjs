import { Motion } from '../packages/runtime/src/engine/motion.js';
import { MOTIONS, IDLE_MOTIONS } from '../packages/runtime/src/engine/motions.js';
import { createPhysics } from '../packages/runtime/src/engine/physics.js';

export const SCENARIOS = ['idle', 'motions', 'speech', 'emotions'];
export const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral'];
export const SPEECH = 'こんにちは。きょうも、いっしょにあいうえおをれんしゅうしましょう。';
export const ALL_MOTIONS = { ...MOTIONS, ...IDLE_MOTIONS };

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function createScenario(name, rig, engine, seconds) {
  if (!SCENARIOS.includes(name)) throw new Error(`Unknown scenario: ${name}`);
  const motion = new Motion(rig.view.gazeCenter ?? [rig.head.cx, rig.head.cy]);
  const { Physics } = createPhysics(engine, rig);
  const physics = new Physics();
  motion.autoMotion = false;
  motion.autoIdle = name === 'idle';
  if (name === 'speech') motion.speakKana(SPEECH, { loop: true });
  const ids = Object.keys(ALL_MOTIONS);
  const frames = Math.max(3, Math.round(seconds * 60));
  const schedule = name === 'motions' ? ids.map((id, i) => ({
    frame: Math.min(frames - 1, Math.ceil(i * frames / ids.length)), id, duration: ALL_MOTIONS[id].dur,
  })) : name === 'emotions' ? EMOTIONS.map((tag, i) => ({ frame: Math.min(frames - 1, Math.ceil(i * frames / EMOTIONS.length)), tag })) : [];
  let next = 0;
  return { motion, physics, frames, schedule,
    step(frame) {
      while (next < schedule.length && frame >= schedule[next].frame) {
        const event = schedule[next++];
        if (event.id) motion.playMotion(event.id);
        else motion.setEmotion(event.tag);
      }
      const parameters = motion.update(1 / 60);
      const offsets = physics.step(parameters, 1 / 60);
      return { parameters, offsets };
    },
  };
}

export function traceValues(parameters, offsets, physics, rig) {
  const round = v => Math.round(v * 1e6) / 1e6;
  return {
    parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, round(value)])),
    physics: {
      gain: round(offsets.gain),
      buns: Object.fromEntries(['bunL', 'bunR', ...Object.keys(physics.hair)].filter((key, i, keys) => keys.indexOf(key) === i)
        .map(key => [key, offsets[key].map(round)])),
      strands: Object.fromEntries((rig.strands ?? []).map((strand, i) => [strand.name, offsets.strands[i].map(point => point.map(round))])),
      tassels: Object.fromEntries(physics.chains.map(ch => [ch.t.name, { angles: ch.phi.map(round), points: ch.pts.map(point => point.map(round)) }])),
    },
  };
}
