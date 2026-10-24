import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import rigData from '../samples/miko-qipao/rig.json';
import { triangleMetrics, JitterHistogram, reversals, deformTassel } from '../tools/quality-metrics.mjs';
import { seededRandom } from '../tools/motion-scenarios.mjs';

const rest = [0, 0, 1, 0, 0, 1];
const metrics = (pos: number[]) => triangleMetrics({ rest, pos, tris: [0, 1, 2] });

test('affine triangle metrics distinguish scaling, shear, reflection and collapse', () => {
  expect(metrics(rest).areaRatio).toEqual({ min: 1, p1: 1, p99: 1, max: 1 });
  const scale = metrics([0, 0, 2, 0, 0, 0.5]);
  expect(scale.areaRatio.min).toBe(1);
  expect(scale.anisotropy.max).toBe(4);
  expect(scale.stretch.max).toBe(2);
  const shear = metrics([0, 0, 1, 0, 1, 1]);
  expect(shear.stretch.max).toBeCloseTo((1 + Math.sqrt(5)) / 2);
  expect(shear.anisotropy.max).toBeCloseTo((3 + Math.sqrt(5)) / 2);
  const reflection = metrics([0, 0, -1, 0, 0, 1]);
  expect(reflection.flipped).toBe(1);
  expect(reflection.areaRatio.min).toBe(-1);
  expect(reflection.stretch.max).toBe(1);
  expect(metrics([0, 0, 1, 0, 0, 1e-7]).flipped).toBe(1);
  const collapse = metrics([0, 0, 1, 0, 2, 0]);
  expect(collapse.flipped).toBe(1);
  expect(collapse.stretch.max).toBe(Infinity);
  expect(scale.worst.stretch.x).toBeCloseTo(1 / 3);
  expect(scale.worst.stretch.y).toBeCloseTo(1 / 3);
  expect(scale.maxDisplacement).toBe(1);
});

test('jitter histogram bounds percentile error and reversals ignore stationary frames', () => {
  const histogram = new JitterHistogram();
  expect(histogram.summary().p99).toBeNull();
  for (let i = 1; i <= 10000; i++) histogram.add(i / 10000);
  const result = histogram.summary();
  expect(result.max).toBe(1);
  expect(result.p99).toBeGreaterThanOrEqual(0.99);
  expect(result.p99!).toBeLessThanOrEqual(0.99 * 1.001);
  expect(reversals([0, 1, 1, 0, 0, 1], 2)).toBe(1);
  const random = seededRandom(42), again = seededRandom(42);
  expect(Array.from({ length: 100 }, random)).toEqual(Array.from({ length: 100 }, again));
});

test('tassel skinning is a rigid transform when both joints share an angle', () => {
  const angle = 0.3, mesh = { rest: [0, 0, 1, 1, -1, 3], pos: [0, 0, 0, 0, 0, 0] };
  const chain = { t: { pivot: [0, 0] }, dir: [0, 1], L1: 2, phi: [angle, angle],
    pts: [[5, 6], [5 - Math.sin(angle) * 2, 6 + Math.cos(angle) * 2]] };
  deformTassel(chain, mesh);
  for (let i = 0; i < mesh.rest.length; i += 2) {
    expect(mesh.pos[i]).toBeCloseTo(5 + mesh.rest[i] * Math.cos(angle) - mesh.rest[i + 1] * Math.sin(angle), 12);
    expect(mesh.pos[i + 1]).toBeCloseTo(6 + mesh.rest[i] * Math.sin(angle) + mesh.rest[i + 1] * Math.cos(angle), 12);
  }
});

test('headless CLI is reproducible without images and guards paths before writing', () => {
  mkdirSync('work', { recursive: true });
  const folder = mkdtempSync(resolve('work/quality-test-')), external = mkdtempSync(resolve(tmpdir(), 'quality-test-'));
  try {
    const project = resolve(folder, 'project'), first = resolve(folder, 'first'), second = resolve(folder, 'second');
    mkdirSync(project);
    const rig = { ...rigData, image: { width: 21, height: 21 }, strands: [], accessories: [] };
    writeFileSync(resolve(project, 'rig.json'), JSON.stringify(rig));
    const run = (args: string[]) => execFileSync(process.execPath, ['--experimental-strip-types', 'tools/quality.mjs', ...args], { encoding: 'utf8' });
    const output = run([project, '--out', first]);
    expect(output).toContain('layer meshes skipped');
    run([project, '--out', second]);
    const reportText = readFileSync(resolve(first, 'report.json'), 'utf8');
    expect(reportText).toBe(readFileSync(resolve(second, 'report.json'), 'utf8'));
    const report = JSON.parse(reportText);
    expect(report.temporal.map((s: { scenario: string }) => s.scenario)).toEqual(['idle', 'motions', 'speech', 'emotions']);
    expect(report.temporal[0].frames).toBe(1800);
    expect(report.temporal[0].vertexJitter.hair.samples).toBe(0);
    expect(report.temporal[1].schedule).toHaveLength(21);
    expect(report.temporal[1].schedule[0].cut).toBe(true);
    expect(report.temporal[1].schedule.at(-1).cut).toBe(false);
    expect(report.temporal[1].schedule.at(-1).truncated).toBe(true);
    expect(report.temporal[0].eventExclusion.excludedFrames).toBe(0);
    expect(report.temporal[0].vertexJitterExcludingEvents).toEqual(report.temporal[0].vertexJitter);
    expect(report.temporal[1].eventExclusion.excludedFrames).toBeGreaterThan(0);
    expect(report.temporal[1].vertexJitterExcludingEvents.head.samples).toBeLessThan(report.temporal[1].vertexJitter.head.samples);
    expect(report.temporal[1].vertexJitterExcludingEvents.head.max).toBeLessThanOrEqual(report.temporal[1].vertexJitter.head.max);
    symlinkSync(external, resolve(folder, 'escape'));
    symlinkSync(resolve('samples'), resolve(folder, 'sample-output'));
    rmSync(resolve(first, 'report.json'));
    symlinkSync(resolve(project, 'rig.json'), resolve(first, 'report.json'));
    const invalidArgs = [[external], [project, '--out', external], [project, '--out', resolve(folder, 'escape/nested')],
      [project, '--out', 'samples/miko-qipao'], [project, '--out', 'reference'], [project, '--out', 'projects/another/built'],
      [project, '--out', first],
      [project, '--out', resolve(project, 'built/new')], [project, '--out', resolve(folder, 'sample-output/new')],
      [project, '--seconds', 'NaN'], [project, '--seed', '-1'], [project, '--unknown', '1']];
    for (const args of invalidArgs) {
      const result = spawnSync(process.execPath, ['--experimental-strip-types', 'tools/quality.mjs', ...args], { encoding: 'utf8' });
      expect(result.status, args.join(' ')).toBe(1);
      expect(result.stderr).toContain('quality:');
    }
  } finally { rmSync(folder, { recursive: true, force: true }); rmSync(external, { recursive: true, force: true }); }
}, 30000);
