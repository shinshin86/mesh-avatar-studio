import { expect, test, vi } from 'vitest';
import { Motion } from '../packages/runtime/src/engine/motion.js';
import { kanaToMoras, sampleMoras } from '../packages/runtime/src/engine/kana.js';
import type { LipSyncSettings } from 'mesh-avatar';

type Settings = LipSyncSettings;
function audio(settings: Settings) {
  const motion = new Motion([0, 0]); motion.mode = 'manual'; motion.setLipSync(settings);
  motion.setSpeaking(true);
  const trace: { open: number; form: number }[] = [];
  for (let f = 0; f < 240; f++) {
    motion.setVoiceLevel(f < 15 || f > 220 ? 0 : f % 20 < 5 ? 0.4 : 0.8);
    const p = motion.update(1 / 60); trace.push({ open: p.mouthOpen, form: p.mouthForm });
  }
  return trace;
}
const cycles = (trace: { open: number }[]) => trace.filter((p, i) => p.open > 0.3 && (!i || trace[i - 1].open <= 0.3)).length;
const mean = (trace: { open: number }[]) => trace.reduce((sum, p) => sum + p.open, 0) / trace.length;

test('movement settings change loudness cycles and amplitude', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.1);
  try {
    const calm = audio({ granularity: 0, closeSpeed: 0 }), lively = audio({ granularity: 1, closeSpeed: 1 });
    expect(cycles(lively)).toBeGreaterThanOrEqual(2 * cycles(calm));
    const subtle = audio({ openness: 0 }), big = audio({ openness: 1 });
    expect(mean(big)).toBeGreaterThan(mean(subtle) * 1.8);
    expect(Math.max(...big.map(p => p.open))).toBeLessThanOrEqual(1);
  } finally { random.mockRestore(); }
});

test('closing speed changes release after the same audio and held kana opening', () => {
  for (const kana of [false, true]) {
    const run = (closeSpeed: number) => {
      const m = new Motion([0, 0]); m.mode = 'manual'; m.setLipSync({ closeSpeed });
      if (kana) m.holdMouth('a'); else { m.setSpeaking(true); m.setVoiceLevel(0.8); }
      for (let f = 0; f < 60; f++) m.update(1 / 60);
      if (kana) m.holdMouth('n'); else m.setVoiceLevel(0);
      for (let f = 0; f < 6; f++) m.update(1 / 60);
      return m.P.mouthOpen;
    };
    expect(run(0)).toBeGreaterThan(0.3); expect(run(1)).toBeLessThan(0.03);
  }
});

test('kana sensitivity groups short morae, strengthens high-sensitivity closures and keeps long pauses', () => {
  const moras = kanaToMoras('まみむめもまみむめも。', 0.14);
  const forms = (g: number) => Array.from({ length: 95 }, (_, f) => sampleMoras(moras, f / 60, g)?.form);
  const count = (values: (number | null | undefined)[]) => values.slice(1).filter((x, i) => x !== null && x !== undefined && x !== values[i]).length;
  expect(count(forms(1))).toBeGreaterThanOrEqual(count(forms(0)) * 2);
  expect(sampleMoras(moras, 0.14 + 0.005, 0)!.open).toBeGreaterThan(sampleMoras(moras, 0.14 + 0.005, 1)!.open);
  expect(sampleMoras(moras, 1.5, 0)!.open).toBe(0);
  for (const openness of [0, 1]) {
    const m = new Motion([0, 0]); m.mode = 'manual'; m.setLipSync({ openness }); m.holdMouth('a');
    for (let f = 0; f < 60; f++) m.update(1 / 60);
    expect(m.P.mouthOpen).toBeCloseTo(openness ? 1 : 0.495, 5);
  }
});

test('new options reject out-of-range inputs and partial updates retain the other values', () => {
  const m = new Motion([0, 0]); m.setLipSync({ openness: 0.7 });
  for (const key of ['granularity', 'openness', 'closeSpeed'])
    for (const value of [-0.01, 1.01, NaN, Infinity, '0.5', null])
      expect(() => m.setLipSync({ [key]: value })).toThrow(RangeError);
  m.setLipSync({ granularity: 0.2 });
  expect(m.lipSync.openness).toBe(0.7); expect(m.lipSync.closeSpeed).toBe(0.5);
});

test('explicit center settings preserve every parameter and random draw in audio and kana paths', () => {
  const random = vi.spyOn(Math, 'random');
  const run = (explicit: boolean) => {
    let state = 42; random.mockImplementation(() => { state = Math.imul(state, 1664525) + 1013904223 >>> 0; return state / 4294967296; });
    const m = new Motion([0, 0]), trace = [];
    if (explicit) m.setLipSync({ granularity: 0.5, openness: 0.5, closeSpeed: 0.5 });
    m.setSpeaking(true);
    for (let f = 0; f < 900; f++) {
      m.setVoiceLevel(Math.max(0, Math.sin(f * 0.2)) * 0.8);
      if (f === 300) { m.setSpeaking(false); m.speakKana('まみむめも、あいうえお'); }
      if (f === 600) m.holdMouth('o');
      trace.push({ ...m.update(1 / 60) });
    }
    return { trace, state };
  };
  try { expect(run(true)).toEqual(run(false)); } finally { random.mockRestore(); }
});


test('preset metadata alone leaves movement at its defaults', () => {
  const motion = new Motion([0, 0]);
  motion.setLipSync({ preset: 'big' });
  expect(motion.lipSync).toEqual({ granularity: 0.5, openness: 0.5, closeSpeed: 0.5 });
  expect(() => motion.setLipSync({ openness: 0.1, closeSpeed: 2 })).toThrow(RangeError);
  expect(motion.lipSync).toEqual({ granularity: 0.5, openness: 0.5, closeSpeed: 0.5 });
});
