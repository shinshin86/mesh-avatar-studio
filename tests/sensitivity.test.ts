import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, type Rig, PARAMS } from 'mesh-avatar';
import { createRig } from '../packages/runtime/src/engine/rig.js';
import { Motion } from '../packages/runtime/src/engine/motion.js';

const parameters: Record<string, number> = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const physics = {
  gain: 1,
  bunL: [0, 0],
  bunR: [0, 0],
  strands: fixture.strands.map(() => [[0, 0], [4, -2], [7, 3], [8, -4]]),
};

const cases: { name: string; edit: (rig: Rig) => void; bounds: number[]; hand?: boolean }[] = [
  { name: 'head turn center', edit: r => { r.head.cx += 20; }, bounds: [800, 950, 200, 550] },
  { name: 'strand node', edit: r => { r.strands![0].nodes[2][0] += 20; }, bounds: [400, 490, 280, 450] },
  { name: 'mouth Gaussian', edit: r => { r.face.mouth.cy += 10; }, bounds: [590, 680, 535, 600] },
  { name: 'wrist bone', edit: r => { r.hand!.wrist[0] += 30; }, bounds: [450, 560, 610, 750], hand: true },
];

for (const item of cases) test(`${item.name} changes the expected region by more than 0.5px`, () => {
  const original = parseRig(fixture);
  const edited = parseRig(fixture);
  item.edit(edited);
  const a = createRig(original), b = createRig(edited);
  const P = { ...parameters, angleX: 30, handAngle: 10 };
  const fa = a.handFrame(P), fb = b.handFrame(P);
  let maximum = 0;
  const [x0, x1, y0, y1] = item.bounds;
  for (let y = y0; y <= y1; y += 7) for (let x = x0; x <= x1; x += 7) {
    const first = item.hand
      ? a.deformHand(x, y, a.handWeights(x, y), P, fa, [0, 0])
      : a.deformBase(x, y, a.baseWeights(x, y), P, physics, [0, 0]);
    const second = item.hand
      ? b.deformHand(x, y, b.handWeights(x, y), P, fb, [0, 0])
      : b.deformBase(x, y, b.baseWeights(x, y), P, physics, [0, 0]);
    maximum = Math.max(maximum, Math.abs(first[0] - second[0]), Math.abs(first[1] - second[1]));
  }
  console.log(`Sensitivity ${item.name}: ${maximum} px`);
  expect(maximum).toBeGreaterThan(0.5);
});

test('gaze center comes from the rig or head center', () => {
  const rig = parseRig(fixture);
  expect(new Motion(rig.view.gazeCenter ?? [rig.head.cx, rig.head.cy]).faceCenter).toEqual([615, 470]);
  delete rig.view.gazeCenter;
  expect(new Motion(rig.view.gazeCenter ?? [rig.head.cx, rig.head.cy]).faceCenter).toEqual([615, 400]);
});
