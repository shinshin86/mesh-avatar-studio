import { expect, test } from '@playwright/test';
import { samplePresent, sampleSkipReason } from './sample';

test.beforeEach(() => test.skip(!samplePresent, sampleSkipReason));

test('expression keys and buttons drive the stream view without camera or microphone', async ({ context, page }) => {
  const outside: string[] = [];
  await context.route('**/*', route => { const url = route.request().url(); if (new URL(url).hostname !== '127.0.0.1') { outside.push(url); return route.abort(); } return route.continue(); });
  await page.goto('/live.html'); await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
  const stream = await context.newPage(); await stream.goto('/stream.html'); await expect(stream.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await stream.evaluate(async () => {
    const path = '/src/live/relay.ts', { receiveLiveParameters } = await import(path);
    Object.assign(window, { latest: null });
    receiveLiveParameters((data: { params: Record<string, number> }) => Object.assign(window, { latest: data.params }));
  });
  const latest = () => stream.evaluate(() => (window as unknown as { latest: Record<string, number> | null }).latest);
  const group = page.getByRole('group', { name: 'Expression' });
  await expect(group.getByRole('button')).toHaveCount(8);
  await expect(group.getByRole('button', { name: /Neutral/ })).toHaveAttribute('aria-pressed', 'true');

  await page.locator('body').press('2');
  await expect(group.getByRole('button', { name: /Smile/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await latest())?.eyeSmile ?? 0).toBeGreaterThan(0.9);
  expect((await latest())!.blush).toBeGreaterThan(0.3);

  // The same key returns to neutral; the fade-out reaches the stream before updates stop.
  await page.locator('body').press('2');
  await expect(group.getByRole('button', { name: /Neutral/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await latest())?.eyeSmile ?? 1).toBeLessThan(0.05);

  // Keys typed into form fields do not switch expressions.
  await page.getByRole('textbox', { name: 'Copy OBS URL' }).press('4');
  await expect(group.getByRole('button', { name: /Neutral/ })).toHaveAttribute('aria-pressed', 'true');

  await group.getByRole('button', { name: /Wink/ }).click();
  await expect.poll(async () => (await latest())?.eyeLOpen ?? 1).toBeLessThan(0.05);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByRole('group', { name: '表情' }).getByRole('button', { name: /ウインク/ })).toHaveAttribute('aria-pressed', 'true');
  expect(outside).toEqual([]);
});
