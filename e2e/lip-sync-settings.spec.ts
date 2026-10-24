import { expect, test } from '@playwright/test';
import { readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';

function tone() {
  const rate = 16000, samples = rate * 2, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 150 / rate) * 3000), 44 + i * 2);
  return bytes;
}

test('presets preview immediately, fine-tuning becomes custom and user kana keeps its playback position', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/'); await dismissGuide(page);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('idle-toggle').click();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('tab', { name: 'Lip sync', exact: true }).click();
  const settings = page.getByTestId('audio-lip-settings');
  await expect(page.locator('#lip-panel').getByTestId('audio-lip-settings')).toBeVisible();
  await expect(settings.locator('.audio-lip-advanced')).not.toHaveAttribute('open', '');
  await expect(settings.getByRole('button', { name: 'Preview a local audio file', exact: true })).toBeHidden();
  const stop = page.locator('.lip-text-row').getByRole('button', { name: 'Stop', exact: true });
  await expect(stop).toBeDisabled();
  await expect(settings.getByRole('combobox')).toHaveCount(0);
  await expect(settings.locator('input[type=checkbox]')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: 'Standard', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await settings.getByRole('button', { name: 'Relaxed', exact: true }).click();
  await expect(stop).toBeEnabled();
  await expect(page.locator('#lip-panel .lip-live input')).toBeDisabled();
  await expect.poll(() => page.locator('#lip-panel .lip-live input').inputValue().then(Number)).toBeGreaterThan(0.3);
  await expect(settings.getByLabel('Mouth movement', { exact: true })).toHaveValue('0');
  await expect(settings.getByLabel('Closing', { exact: true })).toHaveValue('0');
  await settings.getByRole('button', { name: 'Standard', exact: true }).click();
  await expect(settings.getByLabel('Mouth movement', { exact: true })).toHaveValue('0.5');
  await stop.click();
  await settings.locator('.audio-lip-advanced > summary').click();
  for (const label of ['Mouth movement', 'Mouth size', 'Closing'])
    await expect(settings.getByLabel(label, { exact: true })).toBeEnabled();
  await page.getByLabel('Kana text', { exact: true }).fill('あーーーーいーーーー');
  await page.getByRole('checkbox', { name: 'Loop', exact: true }).check();
  await page.locator('.lip-text-row').getByRole('button', { name: 'Play', exact: true }).click();
  const revision = await page.getByTestId('preview').getAttribute('data-revision');
  const peak = () => page.evaluate(async () => {
    const input = document.querySelector<HTMLInputElement>('#lip-panel .lip-live input')!;
    const end = performance.now() + 1700; let max = 0;
    while (performance.now() < end) { await new Promise(requestAnimationFrame); max = Math.max(max, Number(input.value)); }
    return max;
  });
  await settings.getByLabel('Mouth size', { exact: true }).fill('0');
  await page.waitForTimeout(250);
  const subtle = await peak(); expect(subtle).toBeLessThan(0.55); expect(subtle).toBeGreaterThan(0.2);
  await settings.getByLabel('Mouth size', { exact: true }).fill('1');
  expect(await peak()).toBeGreaterThan(0.8);
  await settings.getByLabel('Mouth movement', { exact: true }).fill('0');
  await settings.getByLabel('Closing', { exact: true }).fill('0');
  await settings.getByLabel('Closing', { exact: true }).dispatchEvent('pointerup');
  await expect(settings.locator('.audio-lip-custom')).toHaveText('Custom');
  await expect(settings.locator('.audio-lip-presets button[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByTestId('preview')).toHaveAttribute('data-revision', revision!);
  await expect(page.locator('.lip-text-row').getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
  await page.locator('.lip-text-row').getByRole('button', { name: 'Stop', exact: true }).click();
  await settings.getByLabel('Mouth movement', { exact: true }).fill('0.1');
  await expect(stop).toBeDisabled();
  await settings.getByLabel('Mouth movement', { exact: true }).dispatchEvent('pointerup');
  await expect(stop).toBeEnabled();
  await stop.click();
  // A two-second user phrase must finish on its original timeline after a preset click.
  await page.getByLabel('Kana text', { exact: true }).fill('あーーーーーーー');
  await page.getByLabel('Morae per second', { exact: true }).fill('4');
  await page.getByRole('checkbox', { name: 'Loop', exact: true }).uncheck();
  await page.locator('.lip-text-row').getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(1000);
  await settings.getByRole('button', { name: 'Expressive', exact: true }).click();
  await expect(stop).toBeDisabled({ timeout: 1600 });
  await page.getByRole('tab', { name: 'Pose test', exact: true }).click();
  await expect(settings).toBeHidden();
});

test('editor previews local audio, exports preferences, saves them and Live/Player load the saved settings', async ({ page, context }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const errors: string[] = [], outside: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) { outside.push(url.href); return route.abort(); }
    return route.continue();
  });
  let name: string | undefined;
  try {
    await page.goto('/'); await dismissGuide(page);
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    await page.getByTestId('idle-toggle').click();
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    await page.getByRole('tab', { name: 'Lip sync', exact: true }).click();
    const section = page.getByTestId('audio-lip-settings');
    await section.locator('.audio-lip-advanced > summary').click();
    await section.getByLabel('Mouth movement', { exact: true }).fill('0.2');
    await section.getByLabel('Mouth size', { exact: true }).fill('0.75');
    await section.getByLabel('Closing', { exact: true }).fill('0.15');
    const canvas = page.getByTestId('preview'), before = await canvas.screenshot();
    await section.getByLabel('Preview a local audio file').setInputFiles({ name: 'synthetic.wav', mimeType: 'audio/wav', buffer: tone() });
    await expect(section.locator('.audio-file-picker')).toContainText('synthetic.wav');
    await section.locator('audio').evaluate((audio: HTMLAudioElement) => audio.play());
    await expect.poll(() => canvas.screenshot().then(image => image.equals(before))).toBe(false);
    await section.getByRole('button', { name: 'Stop audio preview' }).click();
    await expect.poll(() => section.locator('audio').evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);

    const menu = page.getByTestId('export-menu'); await menu.locator('summary').click();
    const downloaded = page.waitForEvent('download'); await menu.getByRole('button', { name: 'Download .mavatar', exact: true }).click();
    const bytes = await readFile((await (await downloaded).path())!);
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(bytes)['avatar.json']));
    expect(manifest.lipSync).toEqual({ preset: 'custom', granularity: 0.2, openness: 0.75, closeSpeed: 0.15 });
    expect(Object.keys(unzipSync(bytes)).some(path => path.endsWith('.wav'))).toBe(false);
    await page.locator('.open-menu > summary').click();
    const imported = page.waitForResponse(response => response.url().endsWith('/__studio/import'));
    await page.getByLabel('Avatar archive file').setInputFiles({ name: 'settings.mavatar', mimeType: 'application/octet-stream', buffer: bytes });
    const response = await imported; expect(response.ok()).toBe(true); name = (await response.json()).name;
    await expect(page.getByTestId('project-location')).toContainText(name!);
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    await page.getByRole('tab', { name: 'Lip sync', exact: true }).click();
    await expect(section.getByLabel('Mouth size', { exact: true })).toHaveValue('0.75');
    await section.locator('.audio-lip-advanced > summary').click();
    await section.getByLabel('Mouth size', { exact: true }).fill('0.8');
    const saved = page.waitForResponse(response => response.url().endsWith('/lip-sync') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Save rig', exact: true }).click();
    expect((await saved).ok()).toBe(true);
    expect(JSON.parse(await readFile(resolve('projects', name!, 'avatar.json'), 'utf8')).lipSync.openness).toBe(0.8);
    await page.reload(); await expect(page.getByTestId('project-location')).toContainText(name!);
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
    await page.getByRole('tab', { name: 'Lip sync', exact: true }).click();
    await expect(section.getByLabel('Mouth movement', { exact: true })).toHaveValue('0.2');
    await section.locator('.audio-lip-advanced > summary').click();
    await expect(section.getByLabel('Mouth size', { exact: true })).toHaveValue('0.8');
    await expect(section.locator('.audio-lip-custom')).toHaveText('Custom');
    const saveAndReload = async () => {
      const response = page.waitForResponse(response => response.url().endsWith('/lip-sync') && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Save rig', exact: true }).click();
      expect((await response).ok()).toBe(true);
      await page.reload();
      await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
      await page.getByRole('tab', { name: 'Lip sync', exact: true }).click();
    };
    await section.getByRole('button', { name: 'Relaxed', exact: true }).click();
    await saveAndReload();
    await expect(section.getByRole('button', { name: 'Relaxed', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(section.getByLabel('Mouth movement', { exact: true })).toHaveValue('0');
    await expect(section.getByLabel('Mouth size', { exact: true })).toHaveValue('0.5');
    await expect(section.getByLabel('Closing', { exact: true })).toHaveValue('0');
    await section.locator('.audio-lip-advanced > summary').click();
    // Returning a slider to the preset's exact value still preserves the explicit Custom selection.
    await section.getByLabel('Mouth movement', { exact: true }).fill('0.05');
    await section.getByLabel('Mouth movement', { exact: true }).fill('0');
    await saveAndReload();
    await expect(section.locator('.audio-lip-custom')).toHaveText('Custom');
    await expect(section.locator('.audio-lip-presets button[aria-pressed="true"]')).toHaveCount(0);
    expect(JSON.parse(await readFile(resolve('projects', name!, 'avatar.json'), 'utf8')).lipSync.preset).toBe('custom');

    await page.goto(`/live.html?project=${encodeURIComponent(name!)}&idle=0`);
    await expect(page.locator('canvas[data-state="ready"]')).toBeVisible();
    await page.getByRole('combobox', { name: 'Framing', exact: true }).selectOption('cover');
    await expect(page.locator('canvas[data-state="ready"]')).toBeVisible();
    const site = `http://127.0.0.1:${process.env.PLAYWRIGHT_SITE_PORT ?? 5174}/mesh-avatar-studio/play/`;
    await page.goto(site);
    await expect(page.getByTestId('player-status')).toContainText('Avatar ready');
    await page.getByTestId('player-file').setInputFiles({ name: 'settings.mavatar', mimeType: 'application/octet-stream', buffer: bytes });
    await expect(page.getByTestId('player-status')).toHaveText('Avatar ready · settings.mavatar');
    await page.getByRole('combobox', { name: 'Framing', exact: true }).selectOption('cover');
    await expect(page.getByTestId('player-status')).toHaveText('Avatar ready · settings.mavatar');
    expect(outside).toEqual([]); expect(errors).toEqual([]);
  } finally { if (name) await rm(resolve('projects', name), { recursive: true, force: true }); }
});
