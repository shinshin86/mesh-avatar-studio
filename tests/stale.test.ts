import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig } from 'mesh-avatar';
import { layerSignature } from '../src/editor/stale';

test('cut-out changes mark layers stale without altering precut eye curves', () => {
  const rig = parseRig(fixture);
  const original = layerSignature(rig);
  rig.head.shiftX += 20;
  rig.hand!.wrist[0] += 10;
  expect(layerSignature(rig)).toBe(original);
  rig.eyes[0].opening[0][0] += 5;
  expect(layerSignature(rig)).not.toBe(original);
  expect(rig.eyes[0].top).toEqual(fixture.eyes[0].top);
  expect(rig.eyes[0].bot).toEqual(fixture.eyes[0].bot);
});

test('hair sampling and skin regions require rebuilding but physics strength does not', () => {
  const original = layerSignature(parseRig(fixture));
  for (const edit of [
    (rig: ReturnType<typeof parseRig>) => { rig.strands![0].nodes[0][0] += 1; },
    (rig: ReturnType<typeof parseRig>) => { rig.strands![0].sigma += 1; },
    (rig: ReturnType<typeof parseRig>) => { rig.strands![0].max += 1; },
    (rig: ReturnType<typeof parseRig>) => { rig.face.brow.cx += 1; },
    (rig: ReturnType<typeof parseRig>) => { rig.head.rx += 1; },
    (rig: ReturnType<typeof parseRig>) => { rig.buns!.bunL!.cx += 1; },
    (rig: ReturnType<typeof parseRig>) => { rig.body.chest.cy += 1; },
  ]) {
    const rig = parseRig(fixture);
    edit(rig);
    expect(layerSignature(rig)).not.toBe(original);
  }
  const rig = parseRig(fixture);
  rig.strands![0].k += 0.1;
  expect(layerSignature(rig)).toBe(original);
});
