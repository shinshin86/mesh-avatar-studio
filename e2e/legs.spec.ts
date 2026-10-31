import { test, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';

test('leg handles and tuning update the paused preview without stale layers and persist on reopen', async ({ page }) => {
  test.setTimeout(120000);
  test.skip(!samplePresent, sampleSkipReason);
  await mkdir('projects', { recursive: true });
  const directory = await mkdtemp(join(resolve('projects'), 'legs-check-'));
  try {
    await cp(resolve('samples/miko-qipao'), directory, { recursive: true });
    const rigPath = join(directory, 'rig.json'), rig = JSON.parse(await readFile(rigPath, 'utf8'));
    rig.legs = {
      pelvis: [640, 800], shift: 20, tilt: 0.06, bend: 10, band: [750, 850],
      left: { hip: [520, 850], knee: [530, 1000], ankle: [520, 1200] },
      right: { hip: [740, 850], knee: [730, 1000], ankle: [740, 1200] },
      split: [[630, 840], [630, 1254]],
    };
    await writeFile(rigPath, JSON.stringify(rig));
    const open = async () => {
      await page.goto('/'); await dismissGuide(page); await page.locator('.open-menu > summary').click();
      await page.getByTestId(`project-${basename(directory)}`).click();
      await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
      await page.getByTestId('part-legs').click();
      await page.locator('.inspector details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    };
    await open();
    await page.getByTestId('idle-toggle').click();
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    const slider = page.getByRole('slider', { name: 'Weight shift', exact: true });
    const preview = page.getByTestId('preview');
    const pixels = () => preview.evaluate(node => (node as HTMLCanvasElement).toDataURL());
    const rest = await pixels();
    await slider.fill('0.7');
    await expect.poll(pixels).not.toBe(rest);
    const before = await pixels(), revision = Number(await preview.getAttribute('data-revision'));
    const canvas = page.getByTestId('editor'), box = (await canvas.boundingBox())!;
    const scale = Number(await canvas.getAttribute('data-scale'));
    const x = box.x + Number(await canvas.getAttribute('data-offset-x')) + 530 * scale;
    const y = box.y + Number(await canvas.getAttribute('data-offset-y')) + 1000 * scale;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 20 * scale, y + 10 * scale, { steps: 4 }); await page.mouse.up();
    const knee = page.getByRole('spinbutton', { name: 'legs.left.knee.0', exact: true });
    await expect(knee).toHaveValue('550');
    await expect.poll(async () => Number(await preview.getAttribute('data-revision'))).toBeGreaterThan(revision);
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    await expect.poll(pixels).not.toBe(before);
    await page.getByTestId('part-legs').click();
    await page.locator('.inspector details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    for (const [path, value] of [['shift', '18'], ['tilt', '0.05'], ['bend', '9'], ['band.0', '740'], ['split.0.0', '632']])
      await page.getByRole('spinbutton', { name: `legs.${path}`, exact: true }).fill(value);
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save rig', exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(rigPath, 'utf8')).legs.left.knee).toEqual([550, 1010]);
    await open(); await expect(knee).toHaveValue('550');
    await expect(page.getByRole('spinbutton', { name: 'legs.shift', exact: true })).toHaveValue('18');
    await expect(page.getByRole('spinbutton', { name: 'legs.split.0.0', exact: true })).toHaveValue('632');
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
