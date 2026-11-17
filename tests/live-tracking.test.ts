import { expect, test } from 'vitest';
import { FacePose, mapFace, readFace, smoothParameters, rmsLevel, faceNeutral, type FaceResult } from '../src/live/tracking';
const options = { mirror: false, sensitivity: 1, smoothing: 0 };
function result(yaw = 0, shapes: Record<string, number> = {}): FaceResult {
  const a = yaw * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { faceLandmarks: [[]], facialTransformationMatrixes: [{ data: [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1] }], faceBlendshapes: [{ categories: Object.entries(shapes).map(([categoryName, score]) => ({ categoryName, score })) }] };
}
function looking(elevation: number): FaceResult {
  const input = result(), a = elevation * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  // The third column is the face's forward vector: +Y means looking up.
  input.facialTransformationMatrixes[0].data = [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1];
  return input;
}
test('matrix rotation maps to degrees, neutral calibration and clamped engine limits', () => {
  const face = readFace(result(25))!;
  expect(face.yaw).toBeCloseTo(25);
  expect(mapFace(face, null, options).angleX).toBeCloseTo(25);
  expect(mapFace(face, readFace(result(10)), options).angleX).toBeCloseTo(15);
  expect(mapFace(face, null, { ...options, sensitivity: 2 }).angleX).toBe(30);
  const matrix = result().facialTransformationMatrixes[0].data;
  // 30 degrees around X, then independently around Z.
  const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
  matrix.splice(0, 16, 1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1);
  const input = result(); input.facialTransformationMatrixes[0].data = matrix;
  expect(readFace(input)!.pitch).toBeCloseTo(30);
  input.facialTransformationMatrixes[0].data = [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  expect(readFace(input)!.roll).toBeCloseTo(30);
  input.facialTransformationMatrixes[0].data[0] = NaN; expect(readFace(input)).toBeNull();
});
test.each([{ direction: 'up', elevation: 15 }, { direction: 'down', elevation: -15 }])(
  'face forward vector tilted $direction maps to the matching engine pitch', ({ elevation }) => {
    const face = readFace(looking(elevation))!;
    expect(face.pitch).toBeCloseTo(-elevation);
    for (const mirror of [false, true]) {
      const mapped = mapFace(face, null, { ...options, mirror });
      expect(mapped.angleY).toBeCloseTo(elevation);
      if (elevation > 0) expect(mapped.angleY).toBeGreaterThan(0);
      else expect(mapped.angleY).toBeLessThan(0);
    }
  },
);
test('pitch keeps the calibrated neutral, sensitivity and engine limits', () => {
  const neutral = readFace(looking(10))!;
  expect(mapFace(neutral, neutral, options).angleY).toBeCloseTo(0);
  expect(mapFace(readFace(looking(20))!, neutral, options).angleY).toBeCloseTo(10);
  expect(mapFace(readFace(looking(0))!, neutral, options).angleY).toBeCloseTo(-10);
  expect(mapFace(readFace(looking(20))!, neutral, { ...options, sensitivity: 1.5 }).angleY).toBeCloseTo(15);
  expect(mapFace(readFace(looking(40))!, neutral, { ...options, sensitivity: 2 }).angleY).toBe(30);
  expect(mapFace(readFace(looking(-40))!, neutral, { ...options, sensitivity: 2 }).angleY).toBe(-30);
});
test('mirror flips horizontal pose and gaze, swaps eyes, and blink closes fully', () => {
  const face = readFace(result(20, { eyeBlinkLeft: 0.9, eyeLookOutRight: 0.8 }))!;
  const normal = mapFace(face, null, options), mirror = mapFace(face, null, { ...options, mirror: true });
  expect(normal.eyeLOpen).toBe(0); expect(normal.eyeROpen).toBe(1);
  expect(mirror.eyeROpen).toBe(0); expect(mirror.eyeLOpen).toBe(1);
  expect(mirror.angleX).toBe(-normal.angleX); expect(mirror.gazeX).toBe(-normal.gazeX);
  const pose = new FacePose(); pose.update(result(0, { eyeBlinkLeft: 0.95 }), 0);
  expect(pose.sample(1, 1 / 60, { ...options, smoothing: 1 }).params.eyeLOpen).toBe(0);
});
test('calibration normalizes relaxed eyes, mouth shapes, eyebrows and smile', () => {
  const neutral = readFace(result(0, { eyeBlinkLeft: 0.2, jawOpen: 0.1 }))!;
  const calm = mapFace(neutral, neutral, options);
  expect(calm.eyeLOpen).toBe(1); expect(calm.mouthOpen).toBe(0);
  const face = readFace(result(0, { jawOpen: 0.7, mouthPucker: 0.8, browInnerUp: 0.9, mouthSmileLeft: 0.3, cheekSquintRight: 0.4 }))!;
  const mapped = mapFace(face, neutral, options);
  expect(mapped.mouthOpen).toBeGreaterThan(0.6); expect(mapped.mouthForm).toBeGreaterThan(0);
  expect(mapped.browY).toBeGreaterThan(0); expect(mapped.eyeSmile).toBeGreaterThan(0);
  expect(mapFace(readFace(result(0, { mouthStretchLeft: 1, mouthStretchRight: 1 }))!, null, options).mouthForm).toBe(-1);
  expect(mapFace(readFace(result(0, { jawOpen: 0.5, mouthClose: 1 }))!, null, options).mouthOpen).toBe(0);
});
test('smoothing is time-based and face loss waits 500 ms before easing back to idle', () => {
  const full = smoothParameters({ angleX: 0 }, { angleX: 30 }, 0.1, 0.5);
  const half = smoothParameters(smoothParameters({ angleX: 0 }, { angleX: 30 }, 0.05, 0.5), { angleX: 30 }, 0.05, 0.5);
  expect(full.angleX).toBeCloseTo(half.angleX); expect(full.angleX).toBeGreaterThan(0); expect(full.angleX).toBeLessThan(30);
  const pose = new FacePose(); pose.update(result(30), 0);
  expect(pose.sample(499, 0.016, options)).toMatchObject({ tracking: true, weight: 1 });
  const lost = pose.sample(501, 0.016, options);
  expect(lost.tracking).toBe(false); expect(lost.weight).toBeLessThan(1); expect(lost.params.angleX).toBeGreaterThan(0);
  let last = lost;
  for (let i = 0; i < 200; i++) last = pose.sample(600 + i * 16, 0.016, options);
  expect(last.weight).toBe(0); expect(last.params.angleX).toBeCloseTo(faceNeutral.angleX);
  expect(pose.calibrate(5000)).toBe(false);
  pose.update(result(15), 5001); expect(pose.calibrate(5001)).toBe(true);
  expect(pose.sample(5001, 0.016, options).params.angleX).toBe(0);
});
test('microphone RMS has a noise floor, gain and a finite 0–1 output', () => {
  expect(rmsLevel(new Float32Array(128), 1)).toBe(0);
  const samples = new Float32Array([0.1, -0.1]);
  expect(rmsLevel(samples, 2)).toBeCloseTo(rmsLevel(samples, 1) * 2);
  expect(rmsLevel(new Float32Array([1, -1]), 5)).toBe(1);
  expect(rmsLevel(new Float32Array([NaN]), 1)).toBe(0);
});
