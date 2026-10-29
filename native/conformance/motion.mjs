import { writeFile } from 'node:fs/promises';
import { SCENARIOS, createScenario, seededRandom } from '../../tools/motion-scenarios.mjs';
import { Motion } from '../../packages/runtime/src/engine/motion.js';
import { ExpressionOverlay } from '../../packages/runtime/src/engine/expression-overlay.js';
import { kanaToMoras, sampleMoras, skippedKanaCharacters } from '../../packages/runtime/src/engine/kana.js';

export const speechText = 'こんにちは。きょうも、いっしょにあいうえおをれんしゅうしましょう。';
export const actions = [
  [0, 'setAutoIdle', false], [0, 'setAutoMotion', false], [5, 'setSpeaking', true], [30, 'setEmotion', 'happy'],
  [60, 'setEmotion', 'sad', { playMotion: false }], [70, 'setExpression', 'wink'],
  [90, 'setSpeaking', false], [120, 'speakKana', speechText, { loop: true, speed: 8 }],
  [150, 'setLipSync', { granularity: 0.1, openness: 0.8, closeSpeed: 0.2 }],
  [180, 'holdMouth', 'n'], [190, 'holdMouth', 'i'], [200, 'stopLipSync'], [210, 'setExpression', 'sad'],
  [230, 'setExpression', 'neutral'], [240, 'speakKana', 'あ'], [265, 'setLipSync', { closeSpeed: 0.5 }],
  [280, 'setSpeaking', true], [320, 'setSpeaking', false], [340, 'setExpression', 'unknown'],
];

export async function dumpMotion({ rig, engine, destination }) {
  const original = Math.random;
  try {
    const scenarios = [];
    for (const name of [...SCENARIOS, 'automatic']) {
      Math.random = seededRandom(173);
      const current = createScenario(name === 'automatic' ? 'idle' : name, rig, engine, 20), samples = [];
      if (name === 'automatic') { current.motion.autoMotion = true; current.motion.autoIdle = false; }
      for (let frame = 0; frame < current.frames; frame++) {
        const { parameters, offsets } = current.step(frame);
        if (frame % 60 === 0 || frame === current.frames - 1) samples.push({ frame, parameters: { ...parameters },
          offsets: structuredClone(offsets), chains: current.physics.chains.map(ch => ({ phi: ch.phi, points: ch.pts })) });
      }
      scenarios.push({ name, schedule: current.schedule, samples });
    }
    Math.random = seededRandom(173);
    const motion = new Motion(rig.view.gazeCenter ?? [rig.head.cx, rig.head.cy]);
    const expression = new ExpressionOverlay(), updates = [];
    for (let frame = 0; frame < 360; frame++) {
      for (const [at, method, ...args] of actions) if (at === frame) {
        if (method === 'setExpression') expression.set(...args);
        else if (method === 'setAutoIdle') motion.autoIdle = args[0];
        else if (method === 'setAutoMotion') motion.autoMotion = args[0];
        else motion[method](...args);
      }
      const voice = 0.5 + Math.sin(frame * 0.73) * 0.45;
      motion.setVoiceLevel(voice);
      const dt = frame === 100 ? 0 : 1 / 60;
      const parameters = { ...motion.update(dt) }, output = expression.apply(parameters, dt);
      updates.push({ frame, voice, dt, parameters, output, expression: { name: expression.name, active: expression.active }, lipSync: motion.getLipSyncState() });
    }
    const kana = ['コンニチハ、きゃっほー！abc😀', 'あいうえおん', 'まみむめも ぱぴぷぺぽ'].flatMap(text => [0, 0.1, 0.5, 0.8, 1].map(granularity => {
      const moras = kanaToMoras(text), samples = [];
      for (let t = 0; t < 4; t += 0.037) samples.push({ t, target: sampleMoras(moras, t, granularity) });
      return { text, granularity, moras, skipped: skippedKanaCharacters(text), samples };
    }));
    const rng = seededRandom(173);
    const modes = [];
    for (const mode of ['manual', 'mouse']) {
      Math.random = seededRandom(173);
      const motion = new Motion([600, 500]); motion.mode = mode; motion.setExpression('shy');
      const samples = [];
      for (let frame = 0; frame < 120; frame++) {
        if (frame === 30) motion.playMotion('tilt');
        motion.manual.angleX = 12; motion.manual.eyeLOpen = 0.4; motion.manual.breath = 0.6;
        motion.pointer = [600 + Math.sin(frame / 20) * 350, 500 + Math.cos(frame / 25) * 200];
        samples.push({ pointer: motion.pointer, parameters: { ...motion.update(1 / 60) } });
      }
      modes.push({ mode, samples });
    }
    await writeFile(new URL('motion.json', destination), JSON.stringify({ version: 1, seed: 173, seconds: 20, stride: 60,
      random: Array.from({ length: 100 }, () => rng()), scenarios, actions, updates, kana, modes }) + '\n');
    console.log(`Wrote ${scenarios.length} seeded motion scenarios, speech/expression sequences and kana samples`);
  } finally { Math.random = original; }
}
