import { test, expect, type Page } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import fixture from '../samples/miko-qipao/rig.json' with { type: 'json' };
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';
import { runTool } from '../src/server/project-jobs';

let directory: string, name: string;
test.beforeEach(async () => {
  test.skip(!samplePresent, sampleSkipReason);
  await mkdir(resolve('projects'), { recursive: true });
  directory = await mkdtemp(join(resolve('projects'), 'workflow-check-')); name = basename(directory);
  await cp(resolve('samples/miko-qipao'), directory, { recursive: true,
    filter: path => !['review', 'variants', 'variant-masks', join('built', 'sprites')].some(folder => path.startsWith(join(resolve('samples/miko-qipao'), folder))) });
});
test.afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
async function open(page: Page) {
  await page.goto('/'); await dismissGuide(page); await page.locator('.open-menu > summary').click();
  await page.getByTestId(`project-${name}`).click();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('idle-toggle').click();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
}
async function editEye(page: Page) {
  await page.getByTestId('part-eyes').click();
  await page.getByText(`1 · Opening (${fixture.eyes[0].opening.length})`, { exact: true }).click();
  await page.getByRole('spinbutton', { name: 'eyes.0.opening.0.0', exact: true }).fill('451');
  await expect(page.getByTestId('stale-banner')).toBeVisible();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
}
async function pixels(page: Page) {
  return createHash('sha256').update(await page.getByTestId('preview').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).digest('hex');
}
async function drop(page: Page, bytes: Buffer, filename: string) {
  await page.getByTestId('variant-drop').evaluate((element, file) => {
    const transfer = new DataTransfer(); transfer.items.add(new File([new Uint8Array(file.bytes)], file.filename, { type: 'image/png' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { bytes: Array.from(bytes), filename });
}
test('rebuild runs the real local tool, reloads changed pixels and keeps selection, zoom and undo history', async ({ page }) => {
  test.setTimeout(90000); await open(page); await editEye(page);
  const editor = page.getByTestId('editor'); const point = page.getByRole('spinbutton', { name: 'eyes.0.opening.0.0', exact: true });
  const initialScale = Number(await editor.getAttribute('data-scale'));
  await editor.hover(); await page.mouse.wheel(0, -200);
  await expect.poll(async () => Number(await editor.getAttribute('data-scale'))).toBeCloseTo(initialScale * Math.exp(0.2));
  const zoomText = await page.getByTestId('zoom-value').textContent();
  const before = await pixels(page), base = await readFile(join(directory, 'built/base.png'));
  const beforeSize = await page.getByTestId('preview').evaluate(canvas => [(canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height]);
  const button = page.getByRole('button', { name: 'Save and rebuild layers', exact: true });
  await button.click(); await expect(page.getByTestId('stale-banner')).toHaveCount(0, { timeout: 60000 });
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  expect(await page.getByTestId('preview').evaluate(canvas => [(canvas as HTMLCanvasElement).width, (canvas as HTMLCanvasElement).height])).toEqual(beforeSize);
  expect(await pixels(page)).not.toBe(before); expect(await readFile(join(directory, 'built/base.png'))).not.toEqual(base);
  await expect(editor).toHaveAttribute('data-focus-group', 'eyes'); await expect(page.getByTestId('zoom-value')).toHaveText(zoomText!);
  await expect(point).toHaveValue('451'); await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(point).toHaveValue('446');
  await expect(page.getByTestId('stale-banner')).toBeVisible();
});
test('a failed build leaves the previous layers and view, with a useful reason and expandable log', async ({ page }) => {
  test.setTimeout(90000); await open(page); await editEye(page);
  const old = await readFile(join(directory, 'built/base.png')), before = await pixels(page);
  const tiny = new PNG({ width: 1, height: 1 }); tiny.data.fill(255); await writeFile(join(directory, 'source.png'), PNG.sync.write(tiny));
  await page.getByRole('button', { name: 'Save and rebuild layers', exact: true }).click();
  await expect(page.getByTestId('stale-banner').getByRole('alert')).toContainText('Previous layers were kept.', { timeout: 60000 });
  expect(await readFile(join(directory, 'built/base.png'))).toEqual(old); expect(await pixels(page)).toBe(before);
  await page.getByTestId('stale-banner').getByText('Show log', { exact: true }).click();
  await expect(page.getByTestId('stale-banner').locator('pre')).toContainText('rig.image must match source.png');
  await expect(page.getByRole('button', { name: 'Save and rebuild layers', exact: true })).toBeEnabled();
});
test('requests provide masks, root handoff and prompts; drops accept valid drawings and reject outside changes atomically', async ({ page, context }) => {
  test.setTimeout(120000); await context.grantPermissions(['clipboard-read', 'clipboard-write']); await open(page);
  const panel = page.getByTestId('variants-panel'); await expect(panel.getByRole('checkbox')).toHaveCount(3);
  await expect(panel.getByTestId('ask-agent-variants')).toHaveCount(0);
  await expect(panel.locator('.manual-variants')).not.toHaveAttribute('open', '');
  await panel.getByRole('checkbox', { name: 'Mouth', exact: true }).check();
  const agent = page.getByTestId('ask-agent-variants'); await agent.getByRole('button', { name: 'Copy folder path', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(resolve('.'));
  await agent.getByRole('button', { name: 'Copy message', exact: true }).click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText()); expect(prompt).toContain(`projects/${name}`); expect(prompt).toContain('Step 6'); expect(prompt).toContain('mouth drawn variants');
  expect(prompt).toContain('The user has already consented to Codex image generation'); expect(prompt).toContain('Do not use other external services');
  await expect(agent.getByRole('button', { name: '✓ Copied', exact: true })).toHaveCount(2);
  await expect(agent.getByRole('button', { name: 'Copy message', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(agent.locator('ol')).toHaveCount(0); await expect(panel.locator('select')).toHaveCount(0);
  await expect(agent.getByRole('button', { name: 'Reload project', exact: true })).toHaveCount(0);
  await panel.locator('.manual-variants > summary').click();
  await page.getByRole('button', { name: 'Export masks and prompts', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Local masks and prompts are ready.' })).toBeVisible({ timeout: 60000 });
  expect((await readFile(join(directory, 'variant-requests/mouth_a/prompt.md'), 'utf8'))).toContain('full-size RGBA PNG');
  const manual = panel.locator('.variant-requests'); await manual.getByText('Mouth あ · mouth_a.png', { exact: true }).click();
  await expect(manual.locator('img').first()).toBeVisible(); await expect(manual.locator('img').first()).toHaveJSProperty('naturalWidth', fixture.image.width);
  await manual.getByRole('button', { name: 'Copy image prompt', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('full-size RGBA PNG');
  await manual.getByRole('button', { name: 'Copy file paths', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`projects/${name}/variant-requests/mouth_a/mask.png`);
  await expect(manual.getByRole('button', { name: '✓ Copied', exact: true })).toHaveCount(2);
  await expect(manual.getByRole('button', { name: 'Copy file paths', exact: true })).toBeVisible({ timeout: 5000 });
  const source = PNG.sync.read(await readFile(join(directory, 'source.png')));
  const { cx, cy } = fixture.mouth.area;
  for (let y = Math.round(cy) - 3; y <= Math.round(cy) + 3; y++) for (let x = Math.round(cx) - 6; x <= Math.round(cx) + 6; x++) { const index = (y * source.width + x) * 4; source.data.set([170, 38, 65, 255], index); }
  await page.getByRole('tab', { name: 'Lip sync', exact: true }).click(); await page.getByRole('button', { name: 'あ', exact: true }).click(); await page.waitForTimeout(300);
  const before = await pixels(page); await drop(page, PNG.sync.write(source), 'mouth_a.png');
  await expect(panel.getByRole('status').filter({ hasText: 'Accepted; preview updated.' })).toBeVisible({ timeout: 60000 });
  await expect(panel.locator('.variant-count').last()).toHaveText('1 of 4 images');
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready'); await page.waitForTimeout(300);
  expect(await pixels(page)).not.toBe(before);
  const savedVariant = await readFile(join(directory, 'variants/mouth_a.png')), savedManifest = await readFile(join(directory, 'built/sprites/sprites.json'));
  // Redraw the whole picture (the sample's skin is not fully opaque, so test every visible pixel).
  for (let index = 0; index < source.data.length; index += 4) if (source.data[index + 3] > 0) source.data.set([255, 255, 255, 255], index);
  await drop(page, PNG.sync.write(source), 'mouth_a.png');
  await expect(panel.getByRole('alert')).toContainText('Pixels outside the edit mask changed.', { timeout: 60000 });
  expect(await readFile(join(directory, 'variants/mouth_a.png'))).toEqual(savedVariant); expect(await readFile(join(directory, 'built/sprites/sprites.json'))).toEqual(savedManifest);
  await panel.getByText('Measured comparison outside the mask', { exact: true }).click(); await expect(panel.locator('.job-feedback')).toContainText('Maximum difference');
  await expect(page.getByTestId('project-location')).toContainText(name);
});
test('empty workspace offers folder actions and a single prompt copy without a visible repository path', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.route('**/miko-qipao/**/*.png', route => route.fulfill({ status: 404, body: '' }));
  await page.route('**/miko-qipao/source.png', route => route.fulfill({ status: 404, body: '' }));
  await page.goto('/'); const card = page.getByTestId('ask-agent-new'); await expect(card).toBeVisible();
  await expect(card.locator('.root-path')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Copy folder path', exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Open folder', exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Copy message', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('projects/my-avatar');
  await expect(card.getByRole('button', { name: '✓ Copied', exact: true })).toHaveAttribute('aria-live', 'polite');
  await expect(card.getByRole('button', { name: 'Copy message', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(card.getByRole('button')).toHaveCount(3); await expect(card.locator('ol')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Reload project', exact: true })).toHaveCount(0);
});
test('eye and mouth checkboxes immediately adapt the prompt and lip fallback opens the mouth request', async ({ page }) => {
  await open(page); const panel = page.getByTestId('variants-panel');
  const prompt = panel.getByRole('textbox', { name: 'Copy message', exact: true });
  await panel.getByRole('checkbox', { name: 'Eyes', exact: true }).check(); await expect(prompt).toContainText('eye drawn variants');
  await panel.getByRole('checkbox', { name: 'Mouth', exact: true }).check(); await expect(prompt).toContainText('eye and mouth drawn variants');
  await panel.getByRole('checkbox', { name: 'Expressions', exact: true }).check();
  await expect(prompt).toContainText('eye, expression (sad and surprised eyes, angry and sad closed mouths) and mouth drawn variants');
  await panel.getByRole('checkbox', { name: 'Expressions', exact: true }).uncheck();
  await panel.getByRole('checkbox', { name: 'Eyes', exact: true }).uncheck(); await expect(prompt).toContainText('mouth drawn variants');
  await panel.getByRole('checkbox', { name: 'Mouth', exact: true }).uncheck(); await expect(prompt).toHaveCount(0);
  await panel.locator(':scope > summary').click();
  await page.getByRole('tab', { name: 'Lip sync', exact: true }).click();
  await expect(page.locator('.mouth-fallback')).toContainText('using mesh deformation');
  await page.locator('.mouth-fallback button').click();
  await expect(panel).toHaveAttribute('open', ''); await expect(panel.getByRole('checkbox', { name: 'Mouth', exact: true })).toBeChecked();
  await expect(prompt).toContainText(name); await expect(prompt).toBeVisible();
});
test('the read-only sample still gives a mouth request and keeps its source protected', async ({ page }) => {
  await page.goto('/'); await dismissGuide(page);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('variants-panel').getByRole('checkbox', { name: 'Mouth', exact: true }).check();
  const prompt = page.getByTestId('ask-agent-variants').getByRole('textbox');
  await expect(prompt).toContainText('samples/miko-qipao'); await expect(prompt).toContainText('projects/miko-qipao-variants');
  await expect(prompt).toContainText('Keep the original project unchanged'); await expect(prompt).toContainText('mouth drawn variants');
});
test('external sprite updates load automatically while keeping edited outlines, selection, zoom and undo', async ({ page, request }) => {
  test.setTimeout(90000); await page.setViewportSize({ width: 1440, height: 900 }); await open(page); await editEye(page);
  const mouth = page.getByTestId('variants-panel').getByRole('checkbox', { name: 'Mouth', exact: true });
  await mouth.check();
  const point = page.getByRole('spinbutton', { name: 'eyes.0.opening.0.0', exact: true });
  const initialScale = Number(await page.getByTestId('editor').getAttribute('data-scale'));
  await page.getByTestId('editor').hover(); await page.mouse.wheel(0, -200);
  await expect.poll(async () => Number(await page.getByTestId('editor').getAttribute('data-scale'))).toBeCloseTo(initialScale * Math.exp(0.2));
  const zoomText = await page.getByTestId('zoom-value').textContent();
  await page.getByRole('tab', { name: 'Lip sync', exact: true }).click(); await page.getByRole('button', { name: 'あ', exact: true }).click(); await page.waitForTimeout(300);
  const before = await pixels(page);
  await page.screenshot({ path: 'docs/screenshots/ui4-auto-before-en-1440x900.png' });
  const result = await request.post(`/__studio/projects/${name}/variant-requests`, { data: { rig: fixture } }); expect(result.ok()).toBe(true);
  const image = PNG.sync.read(await readFile(join(directory, 'source.png'))), { cx, cy } = fixture.mouth.area;
  for (let y = Math.round(cy) - 3; y <= Math.round(cy) + 3; y++) for (let x = Math.round(cx) - 6; x <= Math.round(cx) + 6; x++) image.data.set([170, 38, 65, 255], (y * image.width + x) * 4);
  await mkdir(join(directory, 'variants'), { recursive: true }); await writeFile(join(directory, 'variants/mouth_a.png'), PNG.sync.write(image));
  await runTool(resolve('.'), directory, 'build-sprites');
  await expect(page.getByTestId('variants-panel').locator('.variant-count').last()).toHaveText('1 of 4 images', { timeout: 20000 });
  await expect(page.getByRole('status').filter({ hasText: 'Drawn variants loaded.' })).toBeVisible();
  await expect(mouth).toBeChecked();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready'); await page.waitForTimeout(300);
  expect(await pixels(page)).not.toBe(before); await expect(page.locator('.mouth-fallback')).toHaveCount(0);
  await page.screenshot({ path: 'docs/screenshots/ui4-auto-after-en-1440x900.png' });
  // Notices expire. Check Japanese on a new update, not by translating an old notice.
  await expect(page.locator('.save-notice')).toHaveCount(0, { timeout: 10000 });
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  const manifest = join(directory, 'built/sprites/sprites.json');
  await writeFile(manifest, await readFile(manifest));
  await expect(page.getByRole('status').filter({ hasText: '描き分け画像を読み込みました' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/ui4-auto-after-ja-1440x900.png' });
  await page.getByRole('button', { name: '英語', exact: true }).click();
  await expect(point).toHaveValue('451'); await expect(page.getByTestId('stale-banner')).toBeVisible();
  await expect(page.getByTestId('editor')).toHaveAttribute('data-focus-group', 'eyes'); await expect(page.getByTestId('zoom-value')).toHaveText(zoomText!);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(point).toHaveValue('446');
  await page.locator('.open-menu > summary').click(); await page.getByTestId('project-sample-miko-qipao').click();
  await expect(page.getByTestId('project-location').locator('strong')).toHaveText('Sample project');
  await expect(mouth).not.toBeChecked();
});
test('pose and lip tabs keep a large preview at 1440 by 900 in both languages', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page);
  for (const language of ['en', 'ja']) {
    if (language === 'ja') await page.getByRole('button', { name: '日本語', exact: true }).click();
    for (const tab of language === 'en' ? ['Pose test', 'Lip sync'] : ['ポーズ確認', '口の動き']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      expect((await page.getByTestId('preview').boundingBox())!.height).toBeGreaterThanOrEqual(420);
      await expect(page.getByRole('tabpanel')).toHaveCount(1);
      if (tab === 'Lip sync' || tab === '口の動き') {
        const pane = page.locator('#lip-panel'); await pane.evaluate(element => { element.scrollTop = 0; });
        const bounds = (await pane.boundingBox())!;
        for (const locator of [pane.locator('.lip-text-row')]) {
          const box = (await locator.boundingBox())!;
          expect(box.y).toBeGreaterThanOrEqual(bounds.y); expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height);
        }
      }
      expect((await page.locator('.preview-panel').boundingBox())!.y + (await page.locator('.preview-panel').boundingBox())!.height).toBeLessThanOrEqual(900);
    }
  }
});
