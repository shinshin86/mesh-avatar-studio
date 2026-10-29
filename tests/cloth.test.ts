import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { parseRig, validateRig, type Cloth, type ClothTuning } from 'mesh-avatar';
import { createCloth } from '../packages/runtime/src/engine/cloth.js';
import { CLOTH_DEFAULTS } from '../packages/runtime/src/engine/cloth-tuning.js';
import { buildOverlay, moveHandle } from '../src/editor/model';
import { layerSignature } from '../src/editor/stale';

const garment = (): Cloth => ({ name: 'skirt', outline: [[0, 0], [100, 0], [100, 100], [0, 100]], waist: [[0, 0], [100, 0]], hem: [[0, 100], [100, 100]], columns: 4, rows: 5, wind: 0 });
function simulation(tuning: Partial<ClothTuning> = {}, parts = [garment()]) {
  const rig = parseRig(fixture); rig.cloth = parts.map(c => ({ ...c, ...tuning }));
  const engine = {
    baseWeights: () => ({}),
    deformBase(x: number, y: number, _w: unknown, P: { shift: number; lift?: number; rotation?: number }, _phys: unknown, out: number[]) {
      const angle = P.rotation ?? 0;
      out[0] = x * Math.cos(angle) - y * Math.sin(angle) + P.shift;
      out[1] = x * Math.sin(angle) + y * Math.cos(angle) + (P.lift ?? 0); return out;
    },
  } as unknown as Parameters<typeof createCloth>[0];
  const { Cloth: Simulator, garments } = createCloth(engine, rig);
  const cloth = new Simulator();
  const step = (shift = 0, frames = 1) => { for (let i = 0; i < frames; i++) cloth.step({ shift }, 1 / 60, {}); };
  return { cloth, garments, step, rig };
}

test('optional cloth/hip/clothCell validate, including all tuning bounds and parent ordering', () => {
  const rig = parseRig(fixture); rig.cloth = [garment()]; rig.body.hip = { shift: 20, band: [700, 1200] }; rig.mesh.clothCell = 8;
  expect(validateRig(rig)).toEqual([]);
  for (const bad of [{ rows: 1 }, { columns: 1 }, { parent: 'later' }, { swing: 0 }, { stiffness: 0 }, { damping: -1 }, { max: 0 }, { follow: 1.1 }, { wind: -1 }, { cohesion: 1.5 }, { cohesion: 9 }, { scale: 0 }, { scale: -1 }, { responseGain: 0 }]) {
    const r = structuredClone(rig); Object.assign(r.cloth![0], bad); expect(validateRig(r).length, JSON.stringify(bad)).toBeGreaterThan(0);
  }
  rig.cloth.push({ ...garment(), name: 'tail', parent: 'skirt' }); expect(validateRig(rig)).toEqual([]);
  rig.cloth[1].name = 'skirt'; expect(validateRig(rig).join()).toContain('unique');
  rig.mesh.clothCell = 0; rig.body.hip.band = [100, 0]; expect(validateRig(rig).join()).toContain('hip.band'); expect(validateRig(rig).join()).toContain('clothCell');
});

test('empty cloth is a no-op and default tuning matches explicit defaults', () => {
  const empty = simulation({}, []); empty.step(100, 60); empty.cloth.deform(); expect(empty.cloth.grids).toEqual([]);
  const a = simulation(), b = simulation({ ...CLOTH_DEFAULTS, wind: 0 });
  for (const s of [0, 20, -10, 0]) { a.step(s, 30); b.step(s, 30); }
  expect(a.cloth.grids[0].nodes).toEqual(b.cloth.grids[0].nodes);
});

test('no-wind cloth converges to rest and is deterministic through motion and release', () => {
  const a = simulation(), b = simulation();
  for (const s of [0, 20, -30, 0]) { a.step(s, 25); b.step(s, 25); }
  expect(a.cloth.grids[0].nodes).toEqual(b.cloth.grids[0].nodes);
  a.step(0, 1200);
  expect(Math.max(...a.garments[0].out.map((v, i) => Math.abs(v - a.garments[0].rest[i])))).toBeLessThan(0.5);
});

test('grid offsets stay within max, including amplified sway', () => {
  for (const gain of [0, 0.5, 1, 3]) {
    const a = simulation({ max: 12, wind: 2 }); a.cloth.gain = gain;
    a.step();
    for (const s of [200, -200, 0]) {
      a.step(s, 60);
      const g = a.garments[0];
      for (let i = 0; i < g.out.length; i += 2) expect(Math.hypot(g.out[i] - g.target[i], g.out[i + 1] - g.target[i + 1])).toBeLessThanOrEqual(12.000001);
    }
  }
});

test('live tuning targets one or all garments, validates atomically and never edits rig', () => {
  const a = simulation({}, [garment(), { ...garment(), name: 'tail', parent: 'skirt' }]); const before = structuredClone(a.rig);
  a.cloth.setTuning('tail', { swing: 0.5 }); expect(a.garments.map(g => g.tuning.swing)).toEqual([1, 0.5]);
  a.cloth.setTuning(null, { wind: 0.2, cohesion: 0 }); expect(a.garments.map(g => g.tuning.wind)).toEqual([0.2, 0.2]);
  expect(() => a.cloth.setTuning(null, { swing: 2, follow: 10 })).toThrow(); expect(a.garments[0].tuning.swing).toBe(1);
  expect(() => a.cloth.setTuning('missing', {})).toThrow(); expect(a.rig).toEqual(before);
});

test('frequency changes oscillation and damping changes release amplitude', () => {
  const trace = (tuning: Partial<ClothTuning>) => {
    const s = simulation(); s.step(); s.step(20, 20); s.cloth.setTuning(null, tuning);
    const values: number[] = []; for (let i = 0; i < 240; i++) { s.step(); values.push(s.cloth.grids[0].nodes.at(-2)! - 100); }
    return values;
  };
  const slow = trace({ swing: 0.5 }), fast = trace({ swing: 2 });
  const crossings = (values: number[]) => values.slice(1).filter((v, i) => v * values[i] < 0).length;
  expect(crossings(fast)).toBeGreaterThan(crossings(slow));
  const light = trace({ damping: 0.3 }), heavy = trace({ damping: 2 });
  const energy = (v: number[]) => v.slice(120).reduce((s, x) => s + x * x, 0);
  expect(energy(heavy)).toBeLessThan(energy(light));
});

test('cloth geometry has editable handles and only cut-out changes stale layers', () => {
  const s = simulation(); const initial = layerSignature(s.rig);
  s.rig.cloth![0].swing = 0.5; expect(layerSignature(s.rig)).toBe(initial);
  const h = buildOverlay(s.rig).handles.find(h => h.id === 'cloth.0.waist.0')!;
  expect(h.vertex?.closed).toBe(false);
  const moved = moveHandle(s.rig, h, [10, 5]); expect(moved.cloth![0].waist[0]).toEqual([10, 5]); expect(layerSignature(moved)).toBe(initial);
  s.rig.cloth![0].outline[0][0]++; expect(layerSignature(s.rig)).not.toBe(initial);
});

test('both physical links retain length while the lower link can lag', () => {
  const s = simulation({ wind: 0, follow: 1, cohesion: 0 }); s.step(); s.step(10);
  let maxDifference = 0, lift = 0;
  for (let f = 0; f < 120; f++) {
    s.step(10); const g = s.garments[0];
    maxDifference = Math.max(maxDifference, Math.abs(g.angle[0] - g.lowerAngle[0]));
    for (let k = 0; k < g.cols; k++) {
      const top = k * 2, joint = (2 * g.cols + k) * 2, hem = (4 * g.cols + k) * 2;
      expect(Math.hypot(g.out[joint] - g.out[top], g.out[joint + 1] - g.out[top + 1])).toBeCloseTo(50, 8);
      expect(Math.hypot(g.out[hem] - g.out[joint], g.out[hem + 1] - g.out[joint + 1])).toBeCloseTo(50, 8);
      lift = Math.max(lift, g.target[hem + 1] - g.out[hem + 1]);
    }
  }
  expect(maxDifference).toBeGreaterThan(0.001);
  expect(lift).toBeGreaterThan(0.001);
});

test('a physical 13px step settles within two to three significant cycles', () => {
  const s = simulation({ swing: 1, stiffness: 1, damping: 1, max: 35, follow: 0.95 }); s.step();
  const values: number[] = [];
  for (let f = 0; f < 600; f++) { s.step(13); const g = s.garments[0]; values.push(g.out.at(-2)! - g.target.at(-2)!); }
  // The conventional2% settling band excludes infinitesimal damping tails.
  const significant = values.filter(v => Math.abs(v) > 13 * 0.02);
  const crossings = significant.slice(1).filter((v, i) => v * significant[i] < 0).length;
  expect(crossings).toBeGreaterThanOrEqual(3);
  expect(crossings).toBeLessThanOrEqual(6);
  expect(Math.max(...values.slice(240).map(Math.abs))).toBeLessThan(13 * 0.02);
});

test('wind has no column phase offset and follows the moving parent attachment', () => {
  const s = simulation({ wind: 0.4, cohesion: 0 }, [garment(), { ...garment(), name: 'tail', parent: 'skirt', waist: [[0, 100], [100, 100]], hem: [[0, 200], [100, 200]] }]);
  for (let f = 0; f < 600; f++) {
    s.step(); const g = s.garments[0];
    for (let k = 1; k < g.cols; k++) expect(g.angle[k]).toBeCloseTo(g.angle[0], 12);
  }
  const [parent, tail] = s.garments;
  for (let k = 0; k < parent.cols; k++) for (let axis = 0; axis < 2; axis++)
    expect(tail.out[k * 2 + axis]).toBeCloseTo(parent.out[((parent.rows - 1) * parent.cols + k) * 2 + axis], 10);
});

test('paused redraw updates waist attachment without advancing pendulum time', () => {
  const s = simulation(); s.step();
  s.cloth.step({ shift: 13 }, 0, {});
  expect(s.cloth.time).toBe(1 / 60);
  expect(s.garments[0].out[0]).toBe(13);
  expect(s.garments[0].angle.every(v => v === 0)).toBe(true);
});

test('source scale and gravity set the pendulum period, and vertical acceleration changes it', () => {
  const s = simulation({ swing: 1, stiffness: 1, damping: 1, cohesion: 0 }, [{ ...garment(), scale: 2 }]); s.step();
  // Equal half-links at2mm/px: the low coupled mode is1.306Hz
  // after zeta0.25 damping (the high mode is3.152Hz).
  s.step(3); const crossings: number[] = []; let previous = s.garments[0].angle[0];
  for (let f = 0; f < 240; f++) { s.step(3); const angle = s.garments[0].angle[0]; if (angle > 0 && previous <= 0) crossings.push((f + 1) / 60); previous = angle; }
  expect(crossings.length).toBeGreaterThanOrEqual(3);
  const measured = 1 / (crossings[2] - crossings[1]);
  expect(measured).toBeCloseTo(1.306, 1);
  expect(s.garments[0].gravity).toBeCloseTo(4903.325, 5);
  const up = simulation({ swing: 1, stiffness: 1, damping: 1, cohesion: 0 }, [{ ...garment(), scale: 2 }]); up.step();
  const upCrossings: number[] = []; previous = 0;
  for (let f = 0; f < 240; f++) {
    const t = (f + 1) / 60;
    up.cloth.step({ shift: 3, lift: -0.5 * 4903.325 * t * t }, 1 / 60, {});
    const angle = up.garments[0].angle[0];
    if (angle > 0 && previous <= 0) upCrossings.push(t);
    previous = angle;
  }
  expect(1 / (upCrossings[2] - upCrossings[1])).toBeCloseTo(measured * Math.sqrt(2), 1);
});


test('a tilted waist leaves each column hanging in its world-rest orientation', () => {
  const s = simulation({ wind: 0 });
  s.cloth.step({ shift: 0, rotation: 0.3 }, 1 / 60, {});
  const g = s.garments[0];
  for (let k = 0; k < g.cols; k++) {
    const top = k * 2, hem = ((g.rows - 1) * g.cols + k) * 2;
    expect(g.out[hem] - g.out[top]).toBeCloseTo(0, 10);
    expect(g.out[hem + 1] - g.out[top + 1]).toBeCloseTo(100, 10);
  }
});


test('cloth exaggeration changes only rendered angles, not dynamics or link lengths', () => {
  const a = simulation({ responseGain: 1, follow: 1 }), b = simulation({ responseGain: 1.6, follow: 1 });
  a.step(); b.step(); a.step(2, 12); b.step(2, 12);
  const ga = a.garments[0], gb = b.garments[0];
  expect(gb.angle).toEqual(ga.angle); expect(gb.lowerAngle).toEqual(ga.lowerAngle);
  const offset = (g: typeof ga) => g.out.at(-2)! - g.target.at(-2)!;
  expect(Math.abs(offset(gb) / offset(ga))).toBeGreaterThan(1.5);
  expect(Math.abs(offset(gb) / offset(ga))).toBeLessThan(1.7);
});

test('parent exaggeration does not feed back into child dynamics', () => {
  const parts: Cloth[] = [garment(), { ...garment(), name: 'tail', parent: 'skirt', waist: [[0, 100], [100, 100]], hem: [[0, 200], [100, 200]] }];
  const a = simulation({ responseGain: 1 }, parts), b = simulation({ responseGain: 1.6 }, parts);
  for (let f = 0; f < 180; f++) { const x = Math.sin(f / 60 * 5) * 5; a.step(x); b.step(x); }
  for (let g = 0; g < 2; g++) {
    expect(b.garments[g].angle).toEqual(a.garments[g].angle);
    expect(b.garments[g].lowerAngle).toEqual(a.garments[g].lowerAngle);
    expect(b.garments[g].physicalOut).toEqual(a.garments[g].physicalOut);
  }
});
