import { expect, test, vi } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import { jobReason } from '../src/editor/job-reason';
import { workflowEn, workflowJa } from '../src/editor/workflow-i18n';
import { runProjectJob, type LocalProject } from '../src/editor/project';
import { parseRig } from 'mesh-avatar';

test('tool geometry failures name the part and correction in each language, ignoring successful rounding logs', () => {
  const rig = parseRig(fixture), en = { ...workflowEn, accessory: 'Accessory' }, ja = { ...workflowJa, accessory: '飾り' };
  const outside = 'Invalid rig: rig.accessories[1].box: rectangle must stay inside the image';
  expect(jobReason(outside, en, rig)).toContain('Accessory 2 (tassel_r)');
  expect(jobReason(outside, ja, rig)).toContain('飾り 2 (tassel_r) の切り抜き範囲が画像の外');
  expect(jobReason('build-layers: accessories[1].box must be an integer rectangle inside the image', ja, rig)).toContain('4つの整数座標');
  expect(jobReason('build-layers: accessories[1].box has no area inside the image', ja, rig)).toContain('幅や高さがありません');
  expect(jobReason('accessories[1].box rounded outward and clipped: [1,2,3.4,5] -> [1,2,4,5]', ja, rig)).toBeUndefined();
  expect(jobReason('build-layers: accessory tassel_r: no pixels match its box and color thresholds', ja)).toContain('色の条件');
  expect(jobReason('build-layers: eyes[0].opening: points must be within source.png', ja)).toContain('目 1');
  expect(jobReason('build-layers: rig.image must match source.png dimensions', ja)).toContain('元画像の大きさ');
});


test('rebuild validation errors remain geometry failures rather than image-import failures', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'Invalid rig: rig.accessories[1].box: rectangle must stay inside the image' }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  try {
    const project = { name: 'nova' } as LocalProject;
    await expect(runProjectJob(project, 'rebuild', parseRig(fixture))).rejects.toMatchObject({ code: 'toolFailed', log: expect.stringContaining('accessories[1].box') });
  } finally { vi.unstubAllGlobals(); }
});
