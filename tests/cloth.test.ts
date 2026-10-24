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
    deformBase(x: number, y: number, _w: unknown, P: { shift: number }, _phys: unknown, out: number[]) {
      out[0] = x + P.shift; out[1] = y; return out;
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
  for (const bad of [{ rows: 1 }, { columns: 1 }, { parent: 'later' }, { swing: 0 }, { stiffness: 0 }, { damping: -1 }, { max: 0 }, { follow: 1.1 }, { wind: -1 }, { cohesion: 1.5 }, { cohesion: 9 }]) {
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
