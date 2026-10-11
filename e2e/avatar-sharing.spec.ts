import { expect, test, type Page } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { zipSync, unzipSync } from 'fflate';
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';

const imported: string[] = [];
test.beforeEach(async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/'); await dismissGuide(page);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
});
test.afterEach(async () => { for (const name of imported.splice(0)) await rm(resolve('projects', name), { recursive: true, force: true }); });

async function download(page: Page, includeSource = true, button = 'Download .mavatar') {
  const menu = page.getByTestId('export-menu');
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  await menu.getByRole('checkbox').setChecked(includeSource);
  const result = page.waitForEvent('download');
  await menu.getByRole('button', { name: button, exact: true }).click();
  const file = await result;
  return readFile((await file.path())!);
}
async function importFile(page: Page, bytes: Buffer) {
  await page.locator('.open-menu > summary').click();
  const response = page.waitForResponse(response => response.url().endsWith('/__studio/import'));
  await page.getByLabel('Avatar archive file').setInputFiles({ name: 'avatar.mavatar', mimeType: 'application/octet-stream', buffer: bytes });
  const result = await response; expect(result.ok()).toBe(true);
  const entry = await result.json(); imported.push(entry.name);
  await expect(page.getByTestId('project-location')).toContainText(entry.name);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  return entry.name as string;
}

test('sample export imports as a listed, rendered project and reexports the same files', async ({ page, baseURL }) => {
  const outside: string[] = [];
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== baseURL) { outside.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.getByTestId('export-menu').locator('summary').click();
  await expect(page.getByRole('checkbox', { name: 'Include source image' })).toBeChecked();
  const first = await download(page), name = await importFile(page, first);
  await expect(page.getByTestId('preview')).toBeVisible();
  const image = await page.getByTestId('preview').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  expect(image.length).toBeGreaterThan(10000);
  await page.locator('.open-menu > summary').click();
  await expect(page.getByTestId(`project-${name}`)).toBeVisible();
  await page.locator('.open-menu > summary').click();
  const before = unzipSync(first), after = unzipSync(await download(page));
  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
  for (const name of Object.keys(before)) expect(Buffer.from(after[name]).equals(Buffer.from(before[name])), name).toBe(true);
  expect(outside).toEqual([]);
});

test('source-free import renders in playback-only mode and a bad path dropped in the import area shows the ZIP error', async ({ page }) => {
  const bytes = await download(page, false);
  const name = await importFile(page, bytes);
  await expect(page.getByText('Source image missing: playback only. Editing and rebuilding are unavailable.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save rig', exact: true })).toBeDisabled();
  await expect(page.locator('.editor-panel')).toHaveCount(0);
  await expect(page.getByTestId('preview')).toBeVisible();
  await page.locator('.open-menu > summary').click();
  await expect(page.getByTestId(`project-${name}`)).toContainText('Playback only');
  const bad = zipSync({ ...unzipSync(bytes), '../escape.txt': new Uint8Array([1]) }, { level: 0 });
  const transfer = await page.evaluateHandle(values => {
    const data = new DataTransfer(); data.items.add(new File([new Uint8Array(values)], 'bad.mavatar', { type: 'application/octet-stream' })); return data;
  }, Array.from(bad));
  await page.getByTestId('archive-import').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByRole('alert')).toContainText('ZIP entry "../escape.txt": path must be relative');
  await expect(page.getByTestId('project-location')).toContainText(name);
});

test('browser-picked folders export in memory, and writable projects save current edits before exporting', async ({ page }) => {
  let exports = 0;
  page.on('request', request => { if (request.url().endsWith('/__studio/export')) exports++; });
  await page.getByLabel('Open project folder files', { exact: true }).setInputFiles(resolve('samples/miko-qipao'));
  await expect(page.getByTestId('project-location')).toContainText('miko-qipao');
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  const bytes = await download(page); expect(exports).toBe(0);
  const name = await importFile(page, bytes);
  await page.getByTestId('part-mouth').click();
  const field = page.getByRole('spinbutton', { name: 'mouth.area.cx', exact: true });
  const next = Number(await field.inputValue()) + 1; await field.fill(String(next)); await field.blur();
  const edited = unzipSync(await download(page, true, 'Save and export'));
  const rig = JSON.parse(new TextDecoder().decode(edited['rig.json'])); expect(rig.mouth.area.cx).toBe(next);
  expect(JSON.parse(await readFile(resolve('projects', name, 'rig.json'), 'utf8'))).toEqual(rig);
});
