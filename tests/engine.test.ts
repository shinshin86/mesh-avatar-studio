import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, PARAMS } from 'mesh-avatar';
import { createRig } from '../packages/runtime/src/engine/rig.js';
import { createPhysics } from '../packages/runtime/src/engine/physics.js';

test('rig instances have isolated coordinates and physics state', () => {
  const a = parseRig(fixture);
  const b = parseRig(fixture);
  b.head.shiftX += 100;
  const first = createRig(a);
  const second = createRig(b);
  const P = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
  P.angleX = 30;
  const x = [600, 400];
  const y = [...x];
  first.applyHead(x, 1, P);
  second.applyHead(y, 1, P);
  expect(x).not.toEqual(y);
  const { Physics } = createPhysics(first, a);
  expect(new Physics()).not.toBe(new Physics());
});

test('missing optional parts and variable strand lengths stay finite', () => {
  const rig = parseRig(fixture);
  delete rig.hand;
  delete rig.buns;
  rig.accessories = [];
  rig.strands = [rig.strands![0]];
  rig.strands[0].nodes.splice(1, 1);
  const engine = createRig(rig);
  const { Physics } = createPhysics(engine, rig);
  const physics = new Physics();
  const P = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
  const phys = physics.step(P, 1 / 60);
  const out = engine.deformBase(500, 300, engine.baseWeights(500, 300), P, phys, [0, 0]);
  expect(out.every(Number.isFinite)).toBe(true);
  expect(physics.chains).toHaveLength(0);
});

test('head.weightOutline fades head influence outside the outline and keeps it inside', () => {
  const plain = createRig(parseRig(fixture));
  const rig = parseRig(fixture);
  // a box around the head and neck: a hand raised beside it at x 1150 stays with the body
  rig.head.weightOutline = [[200, 0], [1030, 0], [1030, 800], [200, 800]];
  rig.head.weightFeather = 20;
  const outlined = createRig(rig);
  for (const [x, y] of [[615, 400], [300, 700], [1000, 100]]) {
    expect(outlined.headWeight(x, y)).toBe(plain.headWeight(x, y));
    expect(outlined.turnWeight(x, y)).toBe(plain.turnWeight(x, y));
  }
  expect(plain.headWeight(1150, 400)).toBe(1);
  expect(outlined.headWeight(1150, 400)).toBe(0);
  expect(outlined.turnWeight(1150, 400)).toBe(0);
  const edge = outlined.headWeight(1040, 400);
  expect(edge).toBeGreaterThan(0);
  expect(edge).toBeLessThan(1);
  // the default feather is 16 px
  delete rig.head.weightFeather;
  expect(createRig(rig).headWeight(1047, 400)).toBe(0);
  expect(createRig(rig).headWeight(1040, 400)).toBeGreaterThan(0);
});

test('a non-positive or missing head.weightFeather falls back to the default instead of NaN', () => {
  const rig = parseRig(fixture);
  rig.head.weightOutline = [[200, 0], [1030, 0], [1030, 800], [200, 800]];
  const reference = createRig(rig);
  for (const feather of [0, -3, NaN]) {
    rig.head.weightFeather = feather;
    const guarded = createRig(rig);
    for (const [x, y] of [[615, 400], [1030, 0], [1040, 400], [1150, 400]]) {
      expect(Number.isFinite(guarded.headWeight(x, y))).toBe(true);
      expect(guarded.headWeight(x, y)).toBe(reference.headWeight(x, y));
      expect(guarded.turnWeight(x, y)).toBe(reference.turnWeight(x, y));
    }
  }
});
