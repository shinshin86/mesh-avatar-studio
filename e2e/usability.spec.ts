import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import fixture from '../samples/miko-qipao/rig.json' with { type: 'json' };
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';

async function openEditor(page: Page) {
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
}
async function canvasPoint(page: Page, x: number, y: number) {
  const canvas = page.getByTestId('editor'), box = (await canvas.boundingBox())!;
  const scale = Number(await canvas.getAttribute('data-scale'));
  return { x: box.x + Number(await canvas.getAttribute('data-offset-x')) + x * scale,
    y: box.y + Number(await canvas.getAttribute('data-offset-y')) + y * scale };
}
test('part selection focuses its overlay and visibility toggles do not select a different part', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await openEditor(page);
  const canvas = page.getByTestId('editor');
  await expect(canvas).toHaveAttribute('data-inactive-opacity', '0.6');
  await expect(page.getByText('Pick a part on the left, or click a dot', { exact: true })).toBeVisible();
  await page.getByTestId('part-head').click();
  await expect(canvas).toHaveAttribute('data-focus-group', 'head');
  await expect(canvas).toHaveAttribute('data-inactive-opacity', '0.2');
  await expect(canvas).toHaveAttribute('data-dimmed-groups', /eyes/);
  const other = await canvasPoint(page, 445, 340);
  await page.mouse.move(other.x, other.y);
  await page.mouse.down(); await page.mouse.move(other.x + 20, other.y + 20); await page.mouse.up();
  await expect(canvas).toHaveAttribute('data-focus-group', 'head');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save rig', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await downloadPromise).path())!, 'utf8'));
  expect(saved.strands).toEqual(fixture.strands);
  await page.getByTestId('visibility-eyes').click();
  await expect(page.locator('[data-part="eyes"]')).toHaveAttribute('data-visible', 'false');
  await expect(canvas).toHaveAttribute('data-visible-groups', /^(?!.*eyes)/);
  await expect(page.getByTestId('part-head')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('part-eyes').click();
  await expect(page.locator('[data-part="eyes"]')).toHaveAttribute('data-visible', 'true');
  await expect(page.getByText('Drag dots · double-click a line to add a dot · Alt-click a dot to remove it', { exact: true })).toBeVisible();
});
test('language switches labels and persists across reload', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await openEditor(page);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByTestId('part-head')).toContainText('頭の向き');
  await expect(page.getByText('ポーズ確認', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('part-head')).toContainText('頭の向き');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  await page.getByRole('button', { name: '英語', exact: true }).click();
  await expect(page.getByTestId('part-head')).toContainText('Head turn');
  await page.reload();
  await expect(page.getByTestId('part-head')).toContainText('Head turn');
});
test('first-run guide appears once, is dismissible, and can be reopened from help', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/');
  await expect(page.getByTestId('first-guide')).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/ui-first-guide.png' });
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  await page.reload();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('first-guide')).toHaveCount(0);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/ui-help.png' });
  await page.getByRole('button', { name: 'Show the guide again' }).click();
  await expect(page.getByTestId('first-guide')).toBeVisible();
});
test('blocked browser storage does not prevent editing or language changes', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openEditor(page);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await page.getByTestId('part-head').click();
  await expect(page.getByRole('spinbutton', { name: 'head.cx', exact: true })).toHaveValue('615');
  expect(errors).toEqual([]);
});
test('handles have human names and line editing, zoom, pan and fit remain available', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await openEditor(page);
  const canvas = page.getByTestId('editor');
  await page.getByTestId('part-head').click();
  const center = await canvasPoint(page, 615, 400);
  await page.mouse.move(center.x, center.y);
  await expect(page.getByRole('tooltip')).toHaveText('Head turn · Centre');
  await expect(canvas).toHaveCSS('cursor', 'grab');
  await page.screenshot({ path: 'docs/screenshots/ui-handle-tooltip.png' });
  await page.getByTestId('part-strands').click();
  const middle = await canvasPoint(page, 485, 190);
  await page.mouse.dblclick(middle.x, middle.y);
  await expect(page.getByText('Nodes (5)', { exact: true })).toBeVisible();
  const inserted = await canvasPoint(page, 485, 190);
  await page.keyboard.down('Alt'); await page.mouse.click(inserted.x, inserted.y); await page.keyboard.up('Alt');
  await expect(page.getByText('Nodes (4)', { exact: true })).toBeVisible();
  // The stale notice changes canvas size; wait for ResizeObserver and the fitted view.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const scale = Number(await canvas.getAttribute('data-scale'));
  await page.mouse.wheel(0, -200);
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeCloseTo(scale * Math.exp(0.2));
  const offset = Number(await canvas.getAttribute('data-offset-x'));
  const panStart = await canvasPoint(page, 485, 190);
  await page.mouse.move(panStart.x, panStart.y);
  await page.mouse.down({ button: 'middle' }); await page.mouse.move(panStart.x + 30, panStart.y + 20); await page.mouse.up({ button: 'middle' });
  await expect.poll(async () => Number(await canvas.getAttribute('data-offset-x'))).toBeGreaterThan(offset);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeCloseTo(scale);
});
test('optional parts absent from an opened rig stay visible but disabled', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await openEditor(page);
  const rig = structuredClone(fixture) as Partial<typeof fixture>;
  delete rig.hand; delete rig.buns; delete rig.strands; delete rig.accessories;
  await page.getByLabel('Open rig file', { exact: true }).setInputFiles({ name: 'rig.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(rig)) });
  for (const group of ['hand', 'buns', 'strands', 'accessories']) {
    await expect(page.getByTestId(`part-${group}`)).toBeDisabled();
    await expect(page.getByTestId(`part-${group}`)).toContainText('Not in this rig');
    await expect(page.getByTestId(`visibility-${group}`)).toBeDisabled();
  }
});
test('narrow layout moves the right column below the canvas and parts can be collapsed', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.setViewportSize({ width: 1100, height: 800 });
  await openEditor(page);
  const editor = (await page.locator('.editor-panel').boundingBox())!;
  const right = (await page.locator('.right-column').boundingBox())!;
  expect(right.y).toBeGreaterThanOrEqual(editor.y + editor.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1100);
  await page.locator('.parts-disclosure > summary').click();
  await expect(page.getByTestId('part-head')).toBeHidden();
  await page.locator('.parts-disclosure > summary').click();
  await expect(page.getByTestId('part-head')).toBeVisible();
});
for (const [width, height] of [[1440, 900], [1280, 800]]) for (const language of ['en', 'ja']) {
  test(`desktop layout fits ${width}×${height} in ${language}`, async ({ page }) => {
    test.skip(!samplePresent, sampleSkipReason);
    await page.setViewportSize({ width, height });
    await openEditor(page);
    if (language === 'ja') await page.getByRole('button', { name: '日本語', exact: true }).click();
    await page.getByTestId('part-head').click();
    await page.getByTestId('idle-toggle').click();
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.part-tip')).toBeVisible();
    await expect(page.getByRole('tab', { name: language === 'ja' ? 'ポーズ確認' : 'Pose test', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    for (const selector of ['.parts-panel', '.editor-panel', '.preview-panel']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
    }
    const preview = (await page.getByTestId('preview').boundingBox())!;
    expect(preview.height).toBeGreaterThanOrEqual(width === 1440 ? 360 : 300);
    const pose = (await page.locator('.pose-test').boundingBox())!;
    expect(pose.y + pose.height).toBeLessThanOrEqual(height);
    await expect(page.locator('.inspector select')).toHaveCount(0);
    const field = page.getByRole('spinbutton', { name: 'head.cx', exact: true });
    await expect(field.locator('..').locator('span')).toHaveText(language === 'ja' ? '中心の横位置' : 'Centre X');
    if (language === 'ja') {
      const english = await page.locator('main').evaluate(main => {
        const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        const found: string[] = [];
        let node;
        while ((node = walker.nextNode())) {
          const parent = node.parentElement!;
          if (!parent.checkVisibility() || parent.closest('select, .field-path, .point-field > small')) continue;
          const text = node.textContent!.trim();
          // The archive filename extension is identical in every language.
          if (/[a-z]{2}/i.test(text.replace(/\.mavatar\b/g, '')) && text !== 'Mesh Avatar Studio') found.push(text);
        }
        return found;
      });
      expect(english).toEqual([]);
    }
    await page.screenshot({ path: `docs/screenshots/ui-${language}-${width}x${height}.png` });
    await field.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `docs/screenshots/ui-${language}-${width}x${height}-fields.png` });
  });
}
