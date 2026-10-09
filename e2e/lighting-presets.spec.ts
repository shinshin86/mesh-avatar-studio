import { expect, test } from '@playwright/test';
import { samplePresent, sampleSkipReason } from './sample';

test.beforeEach(() => test.skip(!samplePresent, sampleSkipReason));

test('lighting presets are saved per slot, applied with Shift+digits and other apps, and reach the stream view', async ({ context, page, request }) => {
  const outside: string[] = [];
  await context.route('**/*', route => { const url = route.request().url(); if (new URL(url).hostname !== '127.0.0.1') { outside.push(url); return route.abort(); } return route.continue(); });
  await page.goto('/live.html'); await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
  const stream = await context.newPage(); await stream.goto('/stream.html'); await expect(stream.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await stream.evaluate(async () => {
    const path = '/src/live/relay.ts', { receiveLighting } = await import(path);
    Object.assign(window, { colors: [] });
    receiveLighting('sample-miko-qipao', (value: { color: number }) => (window as unknown as { colors: number[] }).colors.push(value.color));
  });
  const streamColor = () => stream.evaluate(() => (window as unknown as { colors: number[] }).colors.at(-1));

  const section = page.getByTestId('lighting-section'); await section.locator('summary').click();
  const slots = page.getByRole('group', { name: 'Presets' }), color = section.getByLabel('Light color', { exact: true });
  const slot = (n: number) => slots.getByRole('button', { name: new RegExp(`^Preset ${n}`) });
  await expect(slots.getByRole('button', { name: /^Preset/ })).toHaveCount(8);
  await expect(slot(1)).toBeDisabled(); await expect(slot(1)).toHaveAccessibleName('Preset 1 (Empty)'); await expect(slot(1)).toHaveText('⇧1Empty');

  await section.getByLabel('Enable lighting').check();
  await color.fill('#ff2000'); await section.getByRole('button', { name: 'Save: Preset 1' }).click();
  await expect(slot(1)).toHaveAttribute('aria-pressed', 'true');
  await color.fill('#2060ff'); await section.getByRole('button', { name: 'Save: Preset 2' }).click();
  await expect(slot(1)).toHaveAttribute('aria-pressed', 'false'); await expect(slot(2)).toHaveAttribute('aria-pressed', 'true');

  await page.locator('body').press('Shift+Digit1');
  await expect(color).toHaveValue('#ff2000'); await expect(slot(1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(streamColor).toBe(0xff2000);
  // Shift+digits leave the expression alone, and an empty slot changes nothing.
  await expect(page.getByTestId('expression-section').locator('.expression-on')).toHaveCount(0);
  await page.locator('body').press('Shift+Digit5');
  await expect(color).toHaveValue('#ff2000');
  await slot(2).click(); await expect(color).toHaveValue('#2060ff');
  await page.locator('body').press('Shift+Digit1'); await expect(color).toHaveValue('#ff2000');

  const expression = page.getByTestId('expression-section'); await expression.locator('summary').click();
  const token = await expression.getByRole('textbox', { name: /Token/ }).inputValue();
  const url = await section.getByRole('textbox', { name: 'Preset request URL' }).inputValue();
  expect(new URL(url).pathname).toBe('/__live/lighting');
  const send = (body: unknown) => request.post(url, { data: body, headers: { 'X-Studio-Token': token } });
  expect((await send({ preset: 2, project: 'sample-miko-qipao' })).status()).toBe(200);
  await expect(color).toHaveValue('#2060ff'); await expect.poll(streamColor).toBe(0x2060ff);
  await page.waitForTimeout(60);
  expect((await send({ preset: 1, project: 'another-project' })).status()).toBe(200);
  await page.waitForTimeout(200); await expect(color).toHaveValue('#2060ff');
  expect((await send({ preset: 9 })).status()).toBe(400);

  // Presets stay in this browser for the project.
  await page.reload(); await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('lighting-section').locator('summary').click();
  await expect(slot(1)).toBeEnabled(); await expect(slot(2)).toBeEnabled(); await expect(slot(3)).toBeDisabled();
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByRole('group', { name: 'プリセット' }).getByRole('button', { name: 'プリセット 3 (未保存)' })).toHaveText('⇧3未保存');
  expect(outside).toEqual([]);
});
