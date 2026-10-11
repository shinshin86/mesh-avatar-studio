import { test, expect } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { buildOverlay, imagePoint, nearestHandle, screen } from '../src/editor/model';
import { parseRig } from 'mesh-avatar';
import { zoomAt, fitBounds, partBounds } from '../src/editor/viewport';

test('zoom keeps the image coordinate under the cursor even at both scale limits', () => {
  const view = { scale: 0.6, x: -100, y: 45 }, cursor: [number, number] = [190, 235];
  const origin = imagePoint(cursor, view);
  for (const scale of [0.001, 0.5, 2, 100]) {
    const next = zoomAt(view, scale, cursor);
    expect(next.scale).toBeGreaterThanOrEqual(0.1); expect(next.scale).toBeLessThanOrEqual(16);
    expect(imagePoint(cursor, next)[0]).toBeCloseTo(origin[0], 10);
    expect(imagePoint(cursor, next)[1]).toBeCloseTo(origin[1], 10);
  }
});
test('part fitting includes rotated ellipses and excludes bands across the entire image', () => {
  const bounds = partBounds('head', [{ item: 'head', group: 'head', kind: 'ellipse', points: [[100, 100]], radius: [40, 10], angle: Math.PI / 4 }, { item: 'head.weightBand', group: 'head', kind: 'line', band: true, points: [[0, 0], [2000, 0]] }], []);
  expect(bounds!.width).toBeCloseTo(Math.sqrt(850) * 2); expect(bounds!.height).toBeCloseTo(Math.sqrt(850) * 2);
  const size = { width: 700, height: 500 }, view = fitBounds(bounds!, size, 28);
  const low = screen([bounds!.x, bounds!.y], view), high = screen([bounds!.x + bounds!.width, bounds!.y + bounds!.height], view);
  expect(low[0]).toBeGreaterThanOrEqual(28); expect(low[1]).toBeCloseTo(28);
  expect(high[0]).toBeLessThanOrEqual(672); expect(high[1]).toBeCloseTo(472);
});
test('handle hit distance stays eight CSS pixels across the supported zoom range', () => {
  const handles = buildOverlay(parseRig(fixture)).handles.filter(handle => handle.id === 'head.center');
  for (const scale of [0.1, 1, 16]) {
    const view = { scale, x: 40, y: -90 }, center = screen(handles[0].point, view);
    expect(nearestHandle(handles, [center[0] + 7, center[1]], view)?.id).toBe('head.center');
    expect(nearestHandle(handles, [center[0] + 9, center[1]], view)).toBeUndefined();
  }
});
