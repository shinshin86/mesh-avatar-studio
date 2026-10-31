import { expect, test, vi } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { ARM_DEFAULTS, parseRig, validateRig, type Arms } from 'mesh-avatar';
import { createArms } from '../packages/runtime/src/engine/arms.js';
import { createRig, PARAMS } from '../packages/runtime/src/engine/rig.js';
import { Motion } from '../packages/runtime/src/engine/motion.js';

const arms: Arms = {
  left: { shoulder: [250, 650], elbow: [200, 800], wrist: [150, 950], split: [[265, 680], [235, 800], [200, 1030]] },
  right: { shoulder: [1004, 650], elbow: [1054, 800], wrist: [1104, 950], split: [[989, 680], [1019, 800], [1054, 1030]] },
};
const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const phys = { gain: 0, bunL: [0, 0], bunR: [0, 0], strands: [] };
function rigWithArms() { const rig = parseRig(fixture); rig.arms = structuredClone(arms); return rig; }

test('optional arms accept defaults and boundary settings; reject malformed geometry and tuning', () => {
  expect(ARM_DEFAULTS).toEqual({ swing: 4, bend: 6, inward: 0.4 });
  expect(validateRig(rigWithArms())).toEqual([]);
  for (const [swing, bend, inward] of [[0, 0, 0], [10, 12, 1]]) {
    const rig = rigWithArms(); Object.assign(rig.arms!, { swing, bend, inward });
    expect(validateRig(rig)).toEqual([]);
  }
  for (const change of [
    (a: Arms) => { a.left.elbow[1] = a.left.shoulder[1]; },
    (a: Arms) => { a.right.wrist[1] = a.right.elbow[1]; },
    (a: Arms) => { a.left.split[1][1] = a.left.split[0][1]; },
    (a: Arms) => { a.right.split = [[900, 680]]; },
    (a: Arms) => { a.left.split[1][0] = 190; },
    (a: Arms) => { a.right.split[1][0] = 1060; },
    (a: Arms) => { a.left.wrist[0] = -1; },
    (a: Arms) => { a.right.shoulder[0] = fixture.image.width; },
    (a: Arms) => { a.left.split[0][1] = -1; },
    (a: Arms) => { a.swing = -1; },
    (a: Arms) => { a.swing = 10.01; },
    (a: Arms) => { a.bend = 12.01; },
    (a: Arms) => { a.bend = -0.01; },
    (a: Arms) => { a.inward = 1.01; },
    (a: Arms) => { a.inward = -0.01; },
    (a: Arms) => { a.left.elbow[0] = NaN; },
  ]) {
    const rig = rigWithArms(); change(rig.arms!);
    expect(validateRig(rig).join()).toContain('rig.arms');
  }
});

test('legacy avatars ignore all new parameters and zero arms preserve every original point exactly', () => {
  const old = createRig(parseRig(fixture)), newer = createRig(rigWithArms());
  let maximum = 0;
  for (const pose of [{}, { bodyAngleZ: 8, bodyAngleX: -7, breath: 0.8, angleZ: 15 }, { angleX: -30, angleY: 15 }]) {
    const P = { ...defaults, ...pose };
    for (let y = 0; y <= fixture.image.height; y += 13) for (let x = 0; x <= fixture.image.width; x += 13) {
      const expected = old.deformBase(x, y, old.baseWeights(x, y, 0), P, phys, [0, 0]);
      expect(old.deformBase(x, y, old.baseWeights(x, y, 0), { ...P, armSwingL: 1, armSwingR: -1, elbowBendL: 1, elbowBendR: 1 }, phys, [0, 0])).toEqual(expected);
      const actual = newer.deformBase(x, y, newer.baseWeights(x, y, 0), P, phys, [0, 0]);
      maximum = Math.max(maximum, Math.hypot(actual[0] - expected[0], actual[1] - expected[1]));
    }
  }
  console.log(`Arms neutral regression: max delta ${maximum} px`);
  expect(maximum).toBe(0);
});

test('image sides swing outwards, inward swing is reduced, flex never hyperextends and controls clamp', () => {
  const model = createArms(arms, fixture.body)!;
  for (const [index, side] of (['L', 'R'] as const).entries()) {
    const rest = index ? arms.right : arms.left;
    const w = model.weights(...rest.wrist);
    const point = (value: number, bend = 0) => {
      const p = [...rest.wrist]; model.apply(p, ...rest.wrist, w, { [`armSwing${side}`]: value, [`elbowBend${side}`]: bend }); return p;
    };
    const outward = point(1), inward = point(-1);
    expect(index ? outward[0] > rest.wrist[0] : outward[0] < rest.wrist[0]).toBe(true);
    expect(index ? inward[0] < rest.wrist[0] : inward[0] > rest.wrist[0]).toBe(true);
    expect(Math.hypot(outward[0] - rest.wrist[0], outward[1] - rest.wrist[1]))
      .toBeGreaterThan(Math.hypot(inward[0] - rest.wrist[0], inward[1] - rest.wrist[1]) * 2);
    expect(point(10, 10)).toEqual(point(1, 1));
    expect(point(-10, -10)).toEqual(point(-1, 0));
    const f = model.frame({ [`armSwing${side}`]: 1, [`elbowBend${side}`]: 1 })[index];
    expect(Math.abs(f.swing)).toBeCloseTo(4 * Math.PI / 180, 12);
    expect(Math.abs(f.bend)).toBeCloseTo(6 * Math.PI / 180, 12);
    const bent = point(0, 1);
    expect(index ? bent[0] < rest.wrist[0] : bent[0] > rest.wrist[0]).toBe(true);
    // Forearm rotation retains its length, and the opposite side is untouched.
    expect(Math.hypot(bent[0] - rest.elbow[0], bent[1] - rest.elbow[1])).toBeCloseTo(Math.hypot(rest.wrist[0] - rest.elbow[0], rest.wrist[1] - rest.elbow[1]), 10);
    const other = index ? arms.left.wrist : arms.right.wrist, p = [...other];
    model.apply(p, ...other, model.weights(...other), { [`armSwing${side}`]: 1, [`elbowBend${side}`]: 1 });
    expect(p).toEqual(other);
  }
});

test('body-side vertices, shoulder seam and points below the arm stay fixed, elbow band is continuous', () => {
  const model = createArms(arms, fixture.body)!;
  const P = { armSwingL: 1, armSwingR: 1, elbowBendL: 1, elbowBendR: 1 };
  for (const rest of [[500, 850], arms.left.shoulder, arms.right.shoulder, [150, 1200]]) {
    const p = [...rest]; model.apply(p, rest[0], rest[1], model.weights(rest[0], rest[1]), P); expect(p).toEqual(rest);
  }
  const points = [799.999, 800, 800.001].map(y => {
    const p = [200, y]; model.apply(p, 200, y, model.weights(200, y), P); return p;
  });
  expect(Math.hypot(points[0][0] - points[2][0], points[0][1] - points[2][1])).toBeLessThan(0.003);
  const bad = structuredClone(arms); bad.left.elbow = [...bad.left.shoulder]; bad.left.wrist = [...bad.left.shoulder]; bad.left.split[1] = [...bad.left.split[0]];
  const degenerate = createArms(bad, fixture.body)!;
  const p = [200, 800]; degenerate.apply(p, 200, 800, degenerate.weights(200, 800), { ...P, armSwingL: NaN, elbowBendL: Infinity });
  expect(p.every(Number.isFinite)).toBe(true);
});

test('arms ride the deformed shoulder, including planted legs, with exact identity when disabled', () => {
  const rig = rigWithArms();
  rig.legs = { pelvis: [627, 900], band: [700, 940], shift: 12, tilt: 0.04, bend: 4,
    left: { hip: [570, 930], knee: [560, 1080], ankle: [550, 1210] },
    right: { hip: [680, 930], knee: [690, 1080], ankle: [700, 1210] }, split: [[627, 950], [627, 1250]] };
  const engine = createRig(rig), plainRig = structuredClone(rig); delete plainRig.arms;
  const plain = createRig(plainRig);
  for (let f = 0; f < 60; f++) {
    const P = { ...defaults, bodyAngleZ: 8, breath: 0.7, weightShift: f / 60 };
    engine.stepBody(P, 1 / 60); plain.stepBody(P, 1 / 60);
    const [x, y] = arms.left.shoulder;
    expect(engine.deformBase(x, y, engine.baseWeights(x, y, 0), { ...P, armSwingL: 1, elbowBendL: 1 }, phys, [0, 0]))
      .toEqual(plain.deformBase(x, y, plain.baseWeights(x, y, 0), P, phys, [0, 0]));
    for (const [px, py] of [arms.left.wrist, arms.right.wrist])
      expect(engine.deformBase(px, py, engine.baseWeights(px, py, 0), P, phys, [0, 0]))
        .toEqual(plain.deformBase(px, py, plain.baseWeights(px, py, 0), P, phys, [0, 0]));
  }
});

test('idle arms follow the torso with lag, consume no RNG, preserve legacy tracks, and respect manual rest', () => {
  const run = (withArms: boolean) => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const m = new Motion([512, 180], false, withArms ? rigWithArms() : null);
      m.autoIdle = false; m.autoMotion = false;
      const samples = Array.from({ length: 600 }, () => m.update(1 / 60));
      return { samples, calls: random.mock.calls.length, m };
    } finally { random.mockRestore(); }
  };
  const old = run(false), newer = run(true);
  expect(newer.calls).toBe(old.calls);
  for (let i = 0; i < 600; i++) for (const key of Object.keys(old.samples[i]))
    if (!/^(armSwing|elbowBend)/.test(key)) expect(newer.samples[i][key]).toBe(old.samples[i][key]);
  expect(old.samples.every(p => p.armSwingL === 0 && p.elbowBendR === 0)).toBe(true);
  expect(newer.samples.some(p => Math.abs(p.armSwingL) > 0.02)).toBe(true);
  expect(newer.samples.every(p => Math.abs(p.armSwingL) <= 1 && p.elbowBendR >= 0 && p.elbowBendR <= 1)).toBe(true);
  newer.m.mode = 'manual';
  const rest = newer.m.update(1 / 60);
  for (const id of ['armSwingL', 'armSwingR', 'elbowBendL', 'elbowBendR']) expect(rest[id]).toBe(0);
  // Start within a planted hold: gravity follow approaches the fixed torso tilt
  // gradually instead of snapping on its first frame.
  const rig = rigWithArms(); rig.body.maxRoll = 0;
  rig.legs = { pelvis: [627, 900], band: [700, 940], shift: 12, tilt: 0.04, bend: 4,
    left: { hip: [570, 930], knee: [560, 1080], ankle: [550, 1210] },
    right: { hip: [680, 930], knee: [690, 1080], ankle: [700, 1210] }, split: [[627, 950], [627, 1250]] };
  const m = new Motion([512, 180], true, rig);
  m.autoIdle = false; m.autoMotion = false; m.t = 1;
  m.update(1 / 60); const initial = Math.abs(m.armFollow);
  for (let i = 0; i < 60; i++) m.update(1 / 60);
  const target = -rig.legs.tilt * 0.3 * 0.7 * 0.65;
  expect(initial).toBeLessThan(Math.abs(target) * 0.1);
  expect(m.armFollow).toBeCloseTo(target, 4);
  expect(Number.isFinite(m.update(1).armSwingL)).toBe(true);
});
