import { test, expect } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { PNG } from 'pngjs';
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';

test('cloth defaults edit the preview, persist on reopen, and outline edits require rebuilding', async ({ page }) => {
  test.setTimeout(90000);
  test.skip(!samplePresent, sampleSkipReason);
  await mkdir('projects', { recursive: true });
  const directory = await mkdtemp(join(resolve('projects'), 'cloth-check-'));
  try {
    await cp(resolve('samples/miko-qipao'), directory, { recursive: true });
    const rigPath = join(directory, 'rig.json'), rig = JSON.parse(await readFile(rigPath, 'utf8'));
    rig.cloth = [{ name: 'skirt', outline: [[0, 900], [100, 900], [100, 1000], [0, 1000]], waist: [[0, 900], [100, 900]], hem: [[0, 1000], [100, 1000]] }];
    await writeFile(rigPath, JSON.stringify(rig));
    await cp(join(directory, 'built/base.png'), join(directory, 'built/base_cloth.png'));
    const metaPath = join(directory, 'built/layers.json'), meta = JSON.parse(await readFile(metaPath, 'utf8'));
    meta.layers.cloth_skirt = [0, 900, 100, 100]; await writeFile(metaPath, JSON.stringify(meta));
    const image = new PNG({ width: 100, height: 100 }); image.data.fill(160);
    await writeFile(join(directory, 'built/cloth_skirt.png'), PNG.sync.write(image));
    const open = async () => {
      await page.goto('/'); await dismissGuide(page); await page.locator('.open-menu > summary').click();
      await page.getByTestId(`project-${basename(directory)}`).click();
      await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
      await page.getByTestId('part-cloth').click();
      await page.locator('.inspector details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    };
    await open();
    const swing = page.getByRole('spinbutton', { name: 'cloth.0.swing', exact: true });
    await expect(swing).toHaveValue('1');
    const preview = page.getByTestId('preview'), revision = Number(await preview.getAttribute('data-revision'));
    await swing.fill('0.5');
    await expect.poll(async () => Number(await preview.getAttribute('data-revision'))).toBeGreaterThan(revision);
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);
    await page.getByRole('spinbutton', { name: 'cloth.0.cohesion', exact: true }).fill('4.7');
    await expect(page.getByRole('spinbutton', { name: 'cloth.0.cohesion', exact: true })).toHaveValue('5');
    await page.getByRole('button', { name: 'Save rig', exact: true }).click();
    await expect.poll(async () => JSON.parse(await readFile(rigPath, 'utf8')).cloth[0].swing).toBe(0.5);
    await open(); await expect(swing).toHaveValue('0.5');
    await page.locator('.inspector details').evaluateAll(nodes => nodes.forEach(node => { (node as HTMLDetailsElement).open = true; }));
    await page.getByRole('spinbutton', { name: 'cloth.0.outline.0.0', exact: true }).fill('1');
    await expect(page.getByTestId('stale-banner')).toBeVisible();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
