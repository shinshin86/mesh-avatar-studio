import { expect, test, vi } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, validateRig, type Legs } from 'mesh-avatar';
import { createRig, PARAMS } from '../packages/runtime/src/engine/rig.js';
import { createLegs } from '../packages/runtime/src/engine/legs.js';
import { Motion } from '../packages/runtime/src/engine/motion.js';
import { triangleMetrics } from '../tools/quality-metrics.mjs';

const legs: Legs = {
  pelvis: [512, 600], shift: 4, tilt: 0.002, bend: 2, band: [540, 700],
  left: { hip: [440, 680], knee: [450, 1005], ankle: [435, 1235] },
  right: { hip: [580, 680], knee: [570, 1005], ankle: [585, 1235] },
  split: [[508, 670], [508, 1536]],
};
const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const phys = { gain: 0, bunL: [0, 0], bunR: [0, 0], strands: [] };
const length = (a: number[], b: number[]) => Math.hypot(...a.map((n, i) => n - b[i]));
function rigWithLegs() { const rig = parseRig(fixture); rig.legs = structuredClone(legs); return rig; }

test('optional legs validate and malformed joints, split and amounts are rejected', () => {
  expect(validateRig(rigWithLegs())).toEqual([]);
  for (const change of [
    (l: Legs) => { l.left.knee[1] = l.left.ankle[1]; },
    (l: Legs) => { l.split[1][1] = l.split[0][1]; },
    (l: Legs) => { l.bend = -1; },
    (l: Legs) => { l.shift = NaN; },
    (l: Legs) => { l.spine = 1.1; },
    (l: Legs) => { l.bob = -1; },
  ]) {
    const rig = rigWithLegs(); change(rig.legs!);
    expect(validateRig(rig).join()).toContain('rig.legs');
  }
});

test('weightShift never changes a legacy rig; neutral legs add exactly zero deformation', () => {
  const old = createRig(parseRig(fixture)), newer = createRig(rigWithLegs());
  const model = createLegs(legs, fixture.body)!;
  for (let y = 0; y <= 1536; y += 12) for (let x = 350; x <= 670; x += 20) {
    const w = old.baseWeights(x, y, 0), out = [0, 0];
    const expected = [...old.deformBase(x, y, w, defaults, phys, out)];
    for (const weightShift of [-1, 0, 1])
      expect(old.deformBase(x, y, w, { ...defaults, weightShift }, phys, [0, 0])).toEqual(expected);
    const p = [x, y];
    model.apply(p, x, y, model.weights(x, y), defaults);
    expect(p).toEqual([x, y]);
    expect(newer.deformBase(x, y, newer.baseWeights(x, y, 0), defaults, phys, [0, 0])).toEqual(expected);
  }
});

test('two-bone IK keeps both bone lengths, planted ankles and a continuous small pelvis correction', () => {
  const model = createLegs(legs, fixture.body)!;
  const neutral = model.frame({ weightShift: 0, bodyAngleX: 0 });
  let previous: ReturnType<typeof model.frame> | undefined;
  let maxDrop = 0;
  for (let i = -1000; i <= 1000; i++) {
    const weightShift = i / 1000;
    const F = model.frame({ weightShift, bodyAngleX: 0 });
    maxDrop = Math.max(maxDrop, F.drop);
    for (const [j, side] of (['left', 'right'] as const).entries()) {
      const rest = neutral.bones[j], b = F.bones[j];
      expect(length(b.hip3, b.knee3)).toBeCloseTo(length(rest.hip3, rest.knee3), 8);
      expect(length(b.knee3, b.ankle3)).toBeCloseTo(length(rest.knee3, rest.ankle3), 8);
      expect(b.ankle).toEqual(legs[side].ankle);
      if (previous) expect(length(b.knee, previous.bones[j].knee)).toBeLessThan(0.1);
    }
    previous = F;
  }
  expect(maxDrop).toBeLessThan(3);
  const engine = createRig(rigWithLegs());
  for (const weightShift of [-1, 0, 1]) for (const bodyAngleX of [-10, 10])
    for (let y = 1235; y < 1536; y += 7) for (const x of [400, 435, 585, 620]) {
      const P = { ...defaults, weightShift, bodyAngleX, bodyAngleZ: 10, breath: 1, angleX: 30 };
      expect(engine.deformBase(x, y, engine.baseWeights(x, y), P, phys, [0, 0])).toEqual([x, y]);
    }
});

test('weight transfers do not invert the hip, knee or ankle mesh', () => {
  const engine = createRig(rigWithLegs());
  const rest: number[] = [], tris: number[] = [];
  // Separate leg strips keep triangles out of the transparent crotch gap.
  for (const [x0, x1] of [[390, 495], [525, 630]]) {
    const base = rest.length / 2, columns = 8, rows = 100;
    for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) rest.push(x0 + (x1 - x0) * col / columns, 550 + row * 8);
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const a = base + row * (columns + 1) + col, b = a + columns + 1;
      tris.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const weights = Array.from({ length: rest.length / 2 }, (_, i) => engine.baseWeights(rest[i * 2], rest[i * 2 + 1], 0));
  for (const weightShift of [-1, -0.6, 0, 0.6, 1]) for (const bodyAngleX of [-10, 0, 10]) {
    const pos = weights.flatMap((w, i) => engine.deformBase(rest[i * 2], rest[i * 2 + 1], w, { ...defaults, weightShift, bodyAngleX }, phys, [0, 0]));
    expect(triangleMetrics({ rest, pos, tris }).flipped).toBe(0);
  }
});

test('soft extension engages before reach is exhausted without popping or stretching bones', () => {
  const tuned = { ...legs, shift: 12, tilt: 0.035, bend: 6 };
  const model = createLegs(tuned, fixture.body)!;
  const neutral = model.frame({ weightShift: 0, bodyAngleX: 0 });
  let previous = model.frame({ weightShift: -1, bodyAngleX: 0 });
  let maxDrop = 0;
  for (let i = -999; i <= 1000; i++) {
    const F = model.frame({ weightShift: i / 1000, bodyAngleX: 0 });
    maxDrop = Math.max(maxDrop, F.drop);
    for (let j = 0; j < 2; j++) {
      const b = F.bones[j], rest = neutral.bones[j];
      expect(length(b.knee, previous.bones[j].knee)).toBeLessThan(0.5);
      expect(length(b.hip3, b.knee3)).toBeCloseTo(length(rest.hip3, rest.knee3), 8);
      expect(length(b.knee3, b.ankle3)).toBeCloseTo(length(rest.knee3, rest.ankle3), 8);
    }
    previous = F;
  }
  expect(maxDrop).toBeGreaterThan(0.5);
  expect(maxDrop).toBeLessThan(3);
});

test('forward projection limits visible knee travel and skins the shortened bones to their joints', () => {
  for (const [shift, tilt, bend] of [[8, 0.02, 4], [12, 0.035, 6], [16, 0.05, 8], [20, 0.06, 10]]) {
    const tuned = { ...legs, shift, tilt, bend }, model = createLegs(tuned, fixture.body)!;
    for (const weightShift of [-0.6, 0.6]) {
      const P = { weightShift, bodyAngleX: 0 }, F = model.frame(P);
      for (const [i, side] of (['left', 'right'] as const).entries()) {
        const rest = tuned[side], bone = F.bones[i];
        expect(length(bone.knee, rest.knee)).toBeLessThan(shift * 0.6);
        for (const joint of ['hip', 'knee', 'ankle'] as const) {
          const [x, y] = rest[joint], out = [x, y];
          model.apply(out, x, y, model.weights(x, y), P);
          expect(out[0]).toBeCloseTo(bone[joint][0], 8);
          expect(out[1]).toBeCloseTo(bone[joint][1], 8);
        }
        const free = i === (weightShift > 0 ? 0 : 1);
        if (free) {
          expect(bone.knee3[2]).toBeGreaterThan(0);
          expect(length(bone.hip, bone.knee)).toBeLessThan(length(rest.hip, rest.knee));
          expect(length(bone.knee, bone.ankle)).toBeLessThan(length(rest.knee, rest.ankle));
        }
      }
    }
  }
});

test('idle weight transfer keeps moving through five-second cycles', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    const motion = new Motion([512, 180]); motion.autoIdle = false; motion.autoMotion = false;
    const samples: number[] = [];
    for (let f = 0; f < 1440; f++) samples.push(motion.update(1 / 60).weightShift);
    expect(Math.max(...samples)).toBeLessThanOrEqual(0.7);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(-0.7);
    expect(Math.max(...samples)).toBeGreaterThan(0.6);
    expect(Math.min(...samples)).toBeLessThan(-0.6);
    const crossings = samples.flatMap((v, i) => i > 180 && v > 0 && samples[i - 1] <= 0 ? [i] : []);
    expect(crossings.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < crossings.length; i++) expect(crossings[i] - crossings[i - 1]).toBeCloseTo(300, 0);
    const speeds = samples.slice(181).map((v, i) => Math.abs(v - samples[i + 180]) * 60);
    expect(speeds.filter(v => v < 0.05).length / speeds.length).toBeLessThan(0.15);
  } finally { random.mockRestore(); }
});

test('serial trunk response delays the chest, stabilizes the head and preserves planted feet', () => {
  const body = structuredClone(fixture.body); body.chest.cy = legs.pelvis[1] - 150;
  const head = { ...fixture.head, pivotX: 512, pivotY: 350, weightBand: [300, 360] };
  const tuned = { ...legs, shift: 20, tilt: 0.06, bend: 10, spine: 0.7, bob: 2 };
  const model = createLegs(tuned, body, head)!;
  const samples: { ws: number; chest: number; head: number }[] = []; let maxBob = 0;
  for (let f = 0; f < 900; f++) {
    const ws = 0.7 * Math.sin((f + 1) / 60 * Math.PI * 2 / 5), P = { weightShift: ws, bodyAngleX: 0 };
    model.step(P, 1 / 60); const F = model.frame(P);
    samples.push({ ws, chest: F.trunk.chest, head: F.trunk.head }); maxBob = Math.max(maxBob, F.trunk.bob);
    const foot = [435, 1300]; model.apply(foot, foot[0], foot[1], model.weights(foot[0], foot[1]), P); expect(foot).toEqual([435, 1300]);
  }
  const lag = (key: 'chest' | 'head') => {
    const errors = Array.from({ length: 25 }, (_, delay) => samples.slice(350).reduce((s, value, i) => s + (value[key] - samples[i + 350 - delay].ws) ** 2, 0));
    return errors.indexOf(Math.min(...errors));
  };
  expect(lag('chest') / 60).toBeGreaterThanOrEqual(0.1);
  expect(lag('chest') / 60).toBeLessThanOrEqual(0.2);
  expect(lag('head')).toBeGreaterThan(lag('chest'));
  expect(maxBob).toBeGreaterThan(0.5); expect(maxBob).toBeLessThanOrEqual(2.01);
  for (let f = 0; f < 240; f++) model.step({ weightShift: 0.7 }, 1 / 60);
  const P = { weightShift: 0.7 }, F = model.frame(P);
  expect(F.trunk.bob).toBeLessThan(0.01);
  const line = (y: number) => [462, 562].map(x => { const q = [x, y]; model.apply(q, x, y, model.weights(x, y), P); return q; });
  const angle = (line: number[][]) => Math.atan2(line[1][1] - line[0][1], line[1][0] - line[0][0]);
  expect(angle(line(body.chest.cy)) * F.angle).toBeLessThan(0);
  expect(Math.abs(angle(line(200)))).toBeLessThan(0.001);
});

test('planted motion uses held transfers without consuming additional random values', () => {
  const run = (planted: boolean) => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5), motion = new Motion([512, 180], planted);
    motion.autoIdle = false; motion.autoMotion = false; const values: ReturnType<typeof motion.update>[] = [];
    try { for (let f = 0; f < 900; f++) values.push(motion.update(1 / 60)); return { values, calls: random.mock.calls.length }; }
    finally { random.mockRestore(); }
  };
  const old = run(false), planted = run(true);
  expect(planted.calls).toBe(old.calls);
  for (let f = 0; f < 900; f++) for (const key of Object.keys(old.values[f]))
    if (!['weightShift', 'bodyAngleX', 'bodyAngleZ'].includes(key)) expect(planted.values[f][key]).toBe(old.values[f][key]);
  const values = planted.values.map(p => p.weightShift);
  expect(Math.max(...values)).toBeLessThan(0.701);
  expect(values.slice(300).filter(v => Math.abs(v) > 0.69).length / 600).toBeGreaterThan(0.25);
});
