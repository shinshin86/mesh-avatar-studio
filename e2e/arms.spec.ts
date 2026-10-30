import { test, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';

test.beforeEach(() => { test.skip(!samplePresent, sampleSkipReason); });

test('bust-up sample explains missing full-body support and has no arm sliders', async ({ page }, testInfo) => {
  await page.goto('/'); await dismissGuide(page);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  const summary = page.getByTestId('full-body-support');
  await summary.scrollIntoViewIfNeeded();
  await expect(summary).toContainText('Full-body support');
  for (const part of ['legs', 'arms', 'cloth']) await expect(page.getByTestId(`support-${part}`)).toHaveAttribute('data-state', 'unset');
  await expect(page.getByTestId('part-arms')).toBeDisabled();
  for (const label of ['Image-left arm swing', 'Image-right arm swing', 'Image-left elbow bend', 'Image-right elbow bend'])
    await expect(page.getByRole('slider', { name: label, exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('bust-support-en.png') });
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(summary).toContainText('全身の対応状況'); await expect(summary).toContainText('未設定の部位は通常の動きのままです。');
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(summary).toContainText('全身支持情况'); await expect(summary).toContainText('未设置的部位保持默认动作。');
});

test('arm joints, split vertices and default tuning edit the preview without rebuild and persist', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await mkdir('projects', { recursive: true });
  const directory = await mkdtemp(resolve('projects/arms-check-'));
  try {
    await cp(resolve('samples/miko-qipao'), directory, { recursive: true });
    const rigPath = join(directory, 'rig.json'), rig = JSON.parse(await readFile(rigPath, 'utf8'));
    rig.arms = {
      left: { shoulder: [250, 650], elbow: [200, 800], wrist: [150, 950], split: [[265, 680], [235, 800], [200, 1030]] },
      right: { shoulder: [1004, 650], elbow: [1054, 800], wrist: [1104, 950], split: [[989, 680], [1019, 800], [1054, 1030]] },
    };
    await writeFile(rigPath, JSON.stringify(rig));
    const open = async () => {
      await page.goto('/'); await dismissGuide(page); await page.locator('.open-menu > summary').click();
      await page.getByTestId(`project-${basename(directory)}`).click();
      await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
      await page.getByTestId('part-arms').click();
      await page.locator('.inspector details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    };
    await open();
    await expect(page.getByTestId('support-arms')).toHaveAttribute('data-state', 'set');
    await expect(page.getByTestId('support-legs')).toHaveAttribute('data-state', 'unset');
    for (const [field, value] of [['swing', '4'], ['bend', '6'], ['inward', '0.4']])
      await expect(page.getByRole('spinbutton', { name: `arms.${field}`, exact: true })).toHaveValue(value);
    // Showing defaults must not silently modify the rig.
    expect(JSON.parse(await readFile(rigPath, 'utf8')).arms.swing).toBeUndefined();
    for (const side of ['left', 'right']) for (const joint of ['shoulder', 'elbow', 'wrist'])
      await expect(page.getByRole('spinbutton', { name: `arms.${side}.${joint}.0`, exact: true })).toBeAttached();
    await page.getByTestId('idle-toggle').click();
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    const preview = page.getByTestId('preview'), pixels = () => preview.evaluate(n => (n as HTMLCanvasElement).toDataURL());
    const rest = await pixels();
    await page.getByRole('slider', { name: 'Image-left arm swing', exact: true }).fill('0.7');
    await page.getByRole('slider', { name: 'Image-right elbow bend', exact: true }).fill('0.5');
    await expect.poll(pixels).not.toBe(rest);
    const editor = page.getByTestId('editor');
    const position = async (px: number, py: number) => {
      const box = (await editor.boundingBox())!, scale = Number(await editor.getAttribute('data-scale'));
      return { x: box.x + Number(await editor.getAttribute('data-offset-x')) + px * scale,
        y: box.y + Number(await editor.getAttribute('data-offset-y')) + py * scale, scale };
    };
    const beforeDrag = await pixels(), revision = Number(await preview.getAttribute('data-revision'));
    const elbow = await position(200, 800);
    await page.mouse.move(elbow.x, elbow.y); await page.mouse.down();
    await page.mouse.move(elbow.x + 10 * elbow.scale, elbow.y + 8 * elbow.scale, { steps: 4 }); await page.mouse.up();
    await expect(page.getByRole('spinbutton', { name: 'arms.left.elbow.0', exact: true })).toHaveValue('210');
    await expect.poll(async () => Number(await preview.getAttribute('data-revision'))).toBeGreaterThan(revision);
    await expect.poll(pixels).not.toBe(beforeDrag);
    await page.getByTestId('part-arms').click();
    const middle = await position(250, 740); await page.mouse.dblclick(middle.x, middle.y);
    await page.locator('.inspector details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    await expect(page.getByRole('spinbutton', { name: 'arms.left.split.3.0', exact: true })).toBeAttached();
    const vertex = await position(250, 740); await page.keyboard.down('Alt'); await page.mouse.click(vertex.x, vertex.y); await page.keyboard.up('Alt');
    await page.getByTestId('part-arms').click();
    await page.locator('.inspector details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    await expect(page.getByRole('spinbutton', { name: 'arms.left.split.3.0', exact: true })).toHaveCount(0);
    for (const [field, value] of [['swing', '3'], ['bend', '4'], ['inward', '0.25'], ['left.split.0.0', '267']])
      await page.getByRole('spinbutton', { name: `arms.${field}`, exact: true }).fill(value);
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save rig', exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(rigPath, 'utf8')).arms.left.elbow).toEqual([210, 808]);
    await expect.poll(async () => JSON.parse(await readFile(rigPath, 'utf8')).arms.inward).toBe(.25);
    await open();
    await expect(page.getByRole('spinbutton', { name: 'arms.swing', exact: true })).toHaveValue('3');
    await expect(page.getByRole('spinbutton', { name: 'arms.left.split.0.0', exact: true })).toHaveValue('267');
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);
    await page.getByTestId('full-body-support').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('arm-editor-en.png') });
    await page.getByRole('button', { name: '日本語', exact: true }).click();
    await expect(page.getByRole('slider', { name: '画像左の腕の振り', exact: true })).toBeAttached();
    await expect(page.getByTestId('full-body-support')).toContainText('設定済み');
    await page.getByRole('button', { name: '简体中文', exact: true }).click();
    await expect(page.getByRole('slider', { name: '图像右肘弯曲', exact: true })).toBeAttached();
    await expect(page.getByTestId('full-body-support')).toContainText('已设置');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
