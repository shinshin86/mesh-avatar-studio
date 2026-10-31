import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, validateRig } from 'mesh-avatar';
import { buildOverlay, changeVertex, moveHandle, nearestHandle, getAt, setAt } from '../src/editor/model';

const view = { scale: 0.5, x: 20, y: 10 };
test('hit-testing finds the nearest handle within eight screen pixels', () => {
  const handles = buildOverlay(parseRig(fixture)).handles.filter(h => h.id === 'head.center');
  expect(nearestHandle(handles, [615 * 0.5 + 27, 400 * 0.5 + 10], view)?.id).toBe('head.center');
  expect(nearestHandle(handles, [615 * 0.5 + 29, 400 * 0.5 + 10], view)).toBeUndefined();
  const competing = [...handles, { ...handles[0], id: 'nearer', point: [625, 400] as [number, number] }];
  expect(nearestHandle(competing, [625 * 0.5 + 20, 210], view)?.id).toBe('nearer');
});
test('dragging a center updates exactly its coordinates and radius handles preserve the center', () => {
  const rig = parseRig(fixture);
  const handles = buildOverlay(rig).handles;
  const next = moveHandle(rig, handles.find(h => h.id === 'head.center')!, [635, 420]);
  expect(next.head.cx).toBe(635);
  expect(next.head.cy).toBe(420);
  expect(rig.head.cx).toBe(615);
  const wider = moveHandle(rig, handles.find(h => h.id === 'head.rx')!, [1100, 400]);
  expect(wider.head.rx).toBe(485);
  expect(wider.head.cx).toBe(615);
});
test('vertex insertion and deletion preserve polygon and polyline minimum sizes', () => {
  let rig = parseRig(fixture);
  rig = changeVertex(rig, 'eyes.0.opening', 1, [448, 480], true);
  expect(getAt(rig, 'eyes.0.opening.1')).toEqual([448, 480]);
  while (rig.eyes[0].opening.length > 3) rig = changeVertex(rig, 'eyes.0.opening', 0, null, true);
  expect(changeVertex(rig, 'eyes.0.opening', 0, null, true).eyes[0].opening).toHaveLength(3);
  while (rig.strands![0].nodes.length > 2) rig = changeVertex(rig, 'strands.0.nodes', 0, null, false);
  expect(changeVertex(rig, 'strands.0.nodes', 0, null, false).strands![0].nodes).toHaveLength(2);
  expect(validateRig(rig)).toEqual([]);
});


test('integer rectangles and cells round in both handle moves and numeric edits without rounding other geometry', () => {
  const rig = parseRig(fixture), handles = buildOverlay(rig).handles;
  const box = moveHandle(rig, handles.find(h => h.id === 'accessories.1.box.end')!, [1075.9, 482.7]);
  expect(box.accessories![1].box.slice(2)).toEqual([1076, 483]);
  expect(moveHandle(rig, handles.find(h => h.id === 'accessories.1.box.end')!, [1075.49, 482.49]).accessories![1].box.slice(2)).toEqual([1075, 482]);
  const fine = moveHandle(rig, handles.find(h => h.id === 'mesh.fine.end')!, [880.3, 760.8]);
  expect(fine.mesh.fine).toMatchObject({ x1: 880, y1: 761 });
  for (const path of ['mesh.baseCell', 'mesh.handCell', 'mesh.fine.cell', 'accessories.0.box.0']) expect(getAt(setAt(rig, path, 14.7), path)).toBe(15);
  expect(setAt(rig, 'head.cx', 615.4).head.cx).toBe(615.4);
  expect(moveHandle(rig, handles.find(h => h.id === 'head.center')!, [615.35, 400.24]).head).toMatchObject({ cx: 615.4, cy: 400.2 });
  expect(validateRig(box)).toEqual([]); expect(validateRig(fine)).toEqual([]);
});

test('leg joints and the editable split update weights without invalidating image layers', async () => {
  const { layerSignature } = await import('../src/editor/stale');
  let rig = parseRig(fixture);
  rig.legs = {
    pelvis: [640, 800], shift: 20, tilt: 0.06, bend: 10, band: [750, 850],
    left: { hip: [520, 850], knee: [530, 1000], ankle: [520, 1200] },
    right: { hip: [740, 850], knee: [730, 1000], ankle: [740, 1200] },
    split: [[630, 840], [630, 1254]],
  };
  const baseline = layerSignature(rig), overlay = buildOverlay(rig);
  for (const id of ['legs.pelvis', ...['left', 'right'].flatMap(side => ['hip', 'knee', 'ankle'].map(joint => `legs.${side}.${joint}`))])
    expect(overlay.handles.some(handle => handle.id === id)).toBe(true);
  expect(overlay.shapes.filter(shape => /^legs\.(left|right)$/.test(shape.item))).toHaveLength(2);
  const knee = overlay.handles.find(handle => handle.id === 'legs.left.knee')!;
  rig = moveHandle(rig, knee, [540, 1010]);
  expect(rig.legs!.left.knee).toEqual([540, 1010]);
  expect(overlay.handles.find(handle => handle.id === 'legs.split.0')!.vertex).toMatchObject({ path: 'legs.split', closed: false });
  rig = changeVertex(rig, 'legs.split', 1, [635, 1000], false);
  expect(rig.legs!.split).toHaveLength(3);
  expect(layerSignature(rig)).toBe(baseline);
  expect(validateRig(rig)).toEqual([]);
});

test('arm handles, bone chains and editable splits preserve validation and image-layer signatures', async () => {
  const { layerSignature } = await import('../src/editor/stale');
  const { fieldTitle } = await import('../src/editor/i18n');
  const { partPresent } = await import('../src/editor/parts');
  let rig = parseRig(fixture);
  expect(partPresent(rig, 'arms')).toBe(false);
  rig.arms = {
    left: { shoulder: [250, 650], elbow: [200, 800], wrist: [150, 950], split: [[265, 680], [235, 800], [200, 1030]] },
    right: { shoulder: [1004, 650], elbow: [1054, 800], wrist: [1104, 950], split: [[989, 680], [1019, 800], [1054, 1030]] },
  };
  expect(partPresent(rig, 'arms')).toBe(true);
  const signature = layerSignature(rig), overlay = buildOverlay(rig);
  for (const side of ['left', 'right']) for (const joint of ['shoulder', 'elbow', 'wrist'])
    expect(overlay.handles.some(h => h.id === `arms.${side}.${joint}`)).toBe(true);
  expect(overlay.shapes.filter(s => /^arms\.(left|right)$/.test(s.item))).toHaveLength(2);
  expect(overlay.handles.find(h => h.id === 'arms.left.split.0')?.vertex).toEqual({ path: 'arms.left.split', index: 0, closed: false });
  rig = moveHandle(rig, overlay.handles.find(h => h.id === 'arms.left.elbow')!, [210, 808]);
  rig = changeVertex(rig, 'arms.left.split', 1, [250, 740], false);
  expect(rig.arms!.left.elbow).toEqual([210, 808]); expect(rig.arms!.left.split).toHaveLength(4);
  while (rig.arms!.left.split.length > 2) rig = changeVertex(rig, 'arms.left.split', 1, null, false);
  expect(changeVertex(rig, 'arms.left.split', 0, null, false).arms!.left.split).toHaveLength(2);
  expect(layerSignature(rig)).toBe(signature); expect(validateRig(rig)).toEqual([]);
  expect(fieldTitle('arms.left.split', 'en')).toBe('Arms · Image-left arm · Arm boundary');
  expect(fieldTitle('arms.swing', 'en')).toBe('Arms · Upper-arm swing limit (degrees)');
  expect(fieldTitle('arms.bend', 'ja')).toContain('肘の曲げの上限 (度)');
  expect(fieldTitle('arms.right.shoulder', 'zh')).toContain('图像右臂');
  // Contextual labels must not replace the existing cloth or leg meanings.
  expect(fieldTitle('cloth.0.swing', 'en')).toContain('Frequency multiplier');
  expect(fieldTitle('legs.left', 'en')).toContain('Image-left leg');
});
