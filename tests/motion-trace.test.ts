// Regenerate intentionally with: UPDATE_MOTION_TRACE=1 npx vitest run tests/motion-trace.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import rigData from '../samples/miko-qipao/rig.json';
import { parseRig } from '../packages/runtime/src/rig/validate';
import { createRig } from '../packages/runtime/src/engine/rig.js';
import { SCENARIOS, createScenario, seededRandom, traceValues } from '../tools/motion-scenarios.mjs';

function compareFixture(expected: unknown, actual: unknown, path: string, tolerance: number, added: Set<string>) {
  if (typeof expected === 'number') {
    expect(typeof actual, path).toBe('number');
    if (tolerance) expect(Math.abs(Number(actual) - expected), path).toBeLessThanOrEqual(tolerance);
    else expect(actual, path).toBe(expected);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true);
    const values = actual as unknown[];
    expected.forEach((value, i) => compareFixture(value, values[i], `${path}[${i}]`, tolerance, added));
    if (values.length > expected.length) added.add(`${path}[${expected.length}..]`);
  } else if (expected && typeof expected === 'object') {
    expect(actual !== null && typeof actual === 'object', path).toBe(true);
    const values = actual as Record<string, unknown>;
    for (const [key, value] of Object.entries(expected)) compareFixture(value, values[key], `${path}.${key}`, tolerance, added);
    for (const key of Object.keys(values)) if (!Object.hasOwn(expected, key)) added.add(`${path}.${key}`);
  } else expect(actual, path).toEqual(expected);
}

test('default motion and physics retain the seeded legacy trace', () => {
  const rig = parseRig(rigData), engine = createRig(rig);
  const seed = 173, seconds = 20, stride = 60;
  const random = vi.spyOn(Math, 'random');
  const scenarios = [];
  try {
    for (const name of SCENARIOS) {
      random.mockImplementation(seededRandom(seed));
      const scenario = createScenario(name, rig, engine, seconds);
      const samples = [];
      for (let frame = 0; frame < scenario.frames; frame++) {
        const { parameters, offsets } = scenario.step(frame);
        if (frame % stride === 0 || frame === scenario.frames - 1)
          samples.push({ frame, ...traceValues(parameters, offsets, scenario.physics, rig) });
      }
      scenarios.push({ name, samples });
    }
  } finally { random.mockRestore(); }
  const current = { seed, seconds, stride, scenarios };
  const path = new URL('./fixtures/motion-trace-miko.json', import.meta.url);
  if (process.env.UPDATE_MOTION_TRACE === '1') writeFileSync(path, JSON.stringify(current) + '\n');
  const fixture: typeof current = JSON.parse(readFileSync(path, 'utf8'));
  expect({ seed, seconds, stride }).toEqual({ seed: fixture.seed, seconds: fixture.seconds, stride: fixture.stride });
  expect(scenarios.map(s => s.name)).toEqual(fixture.scenarios.map(s => s.name));
  const added = new Set<string>();
  scenarios.forEach((scenario, i) => {
    const expected = fixture.scenarios[i];
    expect(scenario.samples.length).toBe(expected.samples.length);
    scenario.samples.forEach((sample, j) => {
      expect(sample.frame).toBe(expected.samples[j].frame);
      compareFixture(expected.samples[j].parameters, sample.parameters, `${scenario.name}.parameters`, 0, added);
      compareFixture(expected.samples[j].physics, sample.physics, `${scenario.name}.physics`, 1.000001e-6, added);
    });
  });
  if (added.size) console.info('New motion trace keys (existing fixture keys still match):', [...added].sort().join(', '));
});
