import { writeFile } from 'node:fs/promises';
import { PARAMS, createRig } from '../../packages/runtime/src/engine/rig.js';
import { Motion } from '../../packages/runtime/src/engine/motion.js';
import { validateRig } from '../../packages/runtime/src/rig/validate.ts';
import { seededRandom } from '../../tools/motion-scenarios.mjs';
import { limbRig } from './limb-rigs.mjs';

const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const phys = { gain: 0.8, bunL: [1.5, -2], bunR: [-3, 1], strands: [] };
const poses = [{}, ...[-1, -0.7, 0.7, 1].map(weightShift => ({ weightShift, bodyAngleX: weightShift * 8,
  bodyAngleZ: -5, breath: 0.7, angleX: 20, angleZ: -12, armSwingL: 0.9, armSwingR: -0.7, elbowBendL: 0.8, elbowBendR: 0.4 })),
{ weightShift: 2, bodyAngleX: -20, armSwingL: -4, armSwingR: 4, elbowBendL: -2, elbowBendR: 3 }];

export async function dumpLimbs({ rig: source, destination }) {
  const variants = [];
  const original = Math.random;
  try {
    for (const name of ['legs', 'arms', 'legs-arms', 'twist', 'hip']) {
      const rig = limbRig(source, name), errors = validateRig(rig);
      if (errors.length) throw new Error(errors.join('\n'));
      const engine = createRig(rig), points = [];
      for (let y = 0; y <= rig.image.height; y += 55) for (let x = 0; x <= rig.image.width; x += 55) points.push([x, y]);
      for (const leg of Object.values(rig.legs ? { left: rig.legs.left, right: rig.legs.right } : {})) {
        for (const point of [leg.hip, leg.knee, leg.ankle]) for (const dy of [-55, -0.001, 0, 0.001, 55]) points.push([point[0], point[1] + dy]);
      }
      for (const arm of Object.values(rig.arms ? { left: rig.arms.left, right: rig.arms.right } : {})) {
        points.push(arm.shoulder, arm.elbow, arm.wrist);
        for (const point of arm.split) for (const dx of [-0.001, 0, 0.001]) points.push([point[0] + dx, point[1]]);
      }
      const weights = points.map(([x, y]) => engine.baseWeights(x, y, 0));
      const capture = (P, selected = points, selectedWeights = weights) => {
        const F = engine.handFrame(P);
        return { parameters: P, legFrame: engine.legs?.frame(P) ?? null,
          base: selected.map(([x, y], i) => engine.deformBase(x, y, selectedWeights[i], P, phys, [0, 0])),
          hand: selected.map(([x, y]) => engine.deformHand(x, y, engine.handWeights(x, y), P, F, [0, 0])),
          body: selected.map(([x, y]) => { const p = [x, y]; engine.applyBody(p, y, P); return p; }) };
      };
      const staticPoses = poses.map(pose => capture({ ...defaults, ...pose }));
      const trace = [], tracePoints = points.filter((_, i) => i % 23 === 0);
      const traceWeights = tracePoints.map(([x, y]) => engine.baseWeights(x, y, 0));
      for (let frame = 0; frame < 360; frame++) {
        const dt = frame === 0 || frame === 180 ? 0 : frame === 90 ? -0.1 : frame === 270 ? 0.08 : 1 / 60;
        const P = { ...defaults, weightShift: Math.sin(frame / 38) * 0.9, bodyAngleX: Math.cos(frame / 41) * 7,
          bodyAngleZ: Math.sin(frame / 29) * 5, breath: 0.6, armSwingL: Math.sin(frame / 31), armSwingR: Math.cos(frame / 37), elbowBendL: 0.8, elbowBendR: 0.4 };
        // Holding every parameter still must invalidate arm frames as torso springs settle.
        if (frame >= 120 && frame < 180) Object.assign(P, { weightShift: 0.7, bodyAngleX: 5, bodyAngleZ: 3, armSwingL: 0.8, armSwingR: -0.6 });
        engine.stepBody(P, dt);
        trace.push({ dt, ...capture(P, tracePoints, traceWeights) });
      }
      const modes = [];
      for (const mode of ['auto', 'idle', 'manual', 'mouse']) {
        Math.random = seededRandom(173);
        const motion = new Motion([600, 500], !!rig.legs, rig.arms ? rig : null);
        motion.mode = mode === 'idle' ? 'auto' : mode;
        motion.autoIdle = mode === 'idle'; motion.autoMotion = mode === 'auto';
        const samples = [];
        for (let frame = 0; frame < 1200; frame++) {
          const manual = { ...defaults, weightShift: frame < 45 ? -0.6 : 0.8, armSwingL: frame < 45 ? 0.9 : -0.4,
            armSwingR: -0.8, elbowBendL: 0.7, elbowBendR: 0.4 };
          const pointer = [600 + Math.sin(frame / 20) * 350, 500 + Math.cos(frame / 25) * 200];
          Object.assign(motion.manual, manual); motion.pointer = pointer;
          if (frame === 30) motion.playMotion('tilt');
          const dt = frame === 180 ? 0 : 1 / 60;
          samples.push({ dt, manual, pointer, parameters: { ...motion.update(dt) } });
        }
        // The next RNG value also verifies that optional motion consumes no additional draws.
        modes.push({ mode, samples, nextRandom: Math.random() });
      }
      variants.push({ name, rig, points, weights, staticPoses, tracePoints, trace, modes });
    }
    const validation = [
      ['legs.spine', 0], ['legs.spine', 1], ['legs.spine', 1.01], ['legs.bob', 0], ['legs.bob', -1],
      ['legs.twist', 15], ['legs.twist', 15.01], ['legs.twist', -1], ['legs.shift', -1], ['legs.tilt', -1], ['legs.bend', -1],
      ['legs.pelvis', [1]], ['legs.band', [940, 700]], ['legs.left.knee', [560, 930]], ['legs.right.ankle', [700, 1080]],
      ['legs.split', [[627, 950]]], ['legs.split', [[627, 950], [627, 950]]], ['legs', null], ['legs.spine', null],
      ['arms.swing', 0], ['arms.swing', 10], ['arms.swing', 10.01], ['arms.swing', -1],
      ['arms.bend', 0], ['arms.bend', 12], ['arms.bend', 12.01], ['arms.bend', -1],
      ['arms.inward', 0], ['arms.inward', 1], ['arms.inward', -0.01], ['arms.inward', 1.01],
      ['arms.left.elbow', [200, 650]], ['arms.right.wrist', [1104, 800]],
      ['arms.left.wrist', [-1, 950]], ['arms.right.shoulder', [source.image.width, 650]],
      ['arms.left.split', [[265, 680]]], ['arms.left.split', [[265, 800], [235, 800]]],
      ['arms.left.split.1', [190, 800]], ['arms.right.split.1', [1060, 800]],
      ['arms.left.split.0', [265, -1]], ['arms', null], ['arms.bend', null],
      ['body.hip', { shift: -2, band: [900, 1210] }], ['body.hip', { shift: 2, band: [900, 900] }], ['body.hip', null],
    ].map(([path, value]) => {
      const rig = limbRig(source), keys = path.split('.'), key = keys.pop();
      keys.reduce((v, key) => v[key], rig)[key] = value;
      return { path, rig, valid: validateRig(rig).length === 0 };
    });
    await writeFile(new URL('limbs.json', destination), JSON.stringify({ version: 1, physics: phys, variants, validation }) + '\n');
    console.log(`Wrote ${variants.length} leg/arm variants with weights, poses, body springs and motion traces`);
  } finally { Math.random = original; }
}
