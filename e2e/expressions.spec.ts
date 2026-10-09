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
    // Keep every message: another Live page on the shared development server may relay too.
    Object.assign(window, { seen: [] });
    receiveLiveParameters((data: { params: Record<string, number> }) => (window as unknown as { seen: Record<string, number>[] }).seen.push(data.params));
  });
  const seen = () => stream.evaluate(() => (window as unknown as { seen: Record<string, number>[] }).seen);
  const section = page.getByTestId('expression-section'), group = page.getByRole('group', { name: 'Expression' });
  // Closed by default; keys still work while it is closed.
  await expect(section).not.toHaveAttribute('open', '');
  await page.locator('body').press('8');
  await expect(section.locator('.expression-on')).toHaveText('Wink');
  await page.locator('body').press('1');
  await expect(section.locator('.expression-on')).toHaveCount(0);
  await section.locator('summary').click();
  await expect(group.getByRole('button')).toHaveCount(8);
  await expect(group.getByRole('button', { name: /Neutral/ })).toHaveAttribute('aria-pressed', 'true');

  await page.locator('body').press('2');
  await expect(group.getByRole('button', { name: /Smile/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await seen()).some(p => p.eyeSmile > 0.9 && p.blush > 0.3)).toBe(true);

  // Pressing the shown expression's key keeps it; key 1 returns to neutral. (Whether updates stop
  // after the fade is covered by unit tests: another Live page on the shared development server
  // may be relaying at the same time.)
  await page.locator('body').press('2');
  await expect(group.getByRole('button', { name: /Smile/ })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('body').press('1');
  await expect(group.getByRole('button', { name: /Neutral/ })).toHaveAttribute('aria-pressed', 'true');

  // Keys typed into form fields do not switch expressions.
  await page.getByRole('textbox', { name: 'Copy OBS URL' }).press('4');
  await expect(group.getByRole('button', { name: /Neutral/ })).toHaveAttribute('aria-pressed', 'true');

  await group.getByRole('button', { name: /Wink/ }).click();
  await expect.poll(async () => (await seen()).some(p => p.eyeLOpen < 0.05 && p.eyeROpen > 0.5)).toBe(true);
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByRole('group', { name: '表情' }).getByRole('button', { name: /ウインク/ })).toHaveAttribute('aria-pressed', 'true');
  expect(outside).toEqual([]);
});

test('other apps switch expressions with the token, and requests without it are refused', async ({ page, request }) => {
  await page.goto('/live.html'); await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
  const section = page.getByTestId('expression-section'); await section.locator('summary').click();
  const token = await section.getByRole('textbox', { name: /Token/ }).inputValue();
  const url = await section.getByRole('textbox', { name: 'Request URL' }).inputValue();
  expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/); expect(new URL(url).pathname).toBe('/__live/expression');
  const send = (body: unknown, headers: Record<string, string> = { 'X-Studio-Token': token }) => request.post(url, { data: body, headers });

  expect((await send({ expression: 'surprise' })).status()).toBe(200);
  await expect(section.locator('.expression-on')).toHaveText('Surprised');
  await page.waitForTimeout(60);
  // Sending the shown expression again keeps it; neutral returns to the normal face.
  expect((await send({ expression: 'surprise' })).status()).toBe(200);
  await page.waitForTimeout(200); await expect(section.locator('.expression-on')).toHaveText('Surprised');
  expect((await send({ expression: 'neutral' })).status()).toBe(200);
  await expect(section.locator('.expression-on')).toHaveCount(0);
  await page.waitForTimeout(60);
  await page.waitForTimeout(60);
  expect((await send({ expression: 'smile', project: 'sample-miko-qipao' }, { Authorization: `Bearer ${token}` })).status()).toBe(200);
  await expect(section.locator('.expression-on')).toHaveText('Smile');
  await page.waitForTimeout(60);
  expect((await send({ expression: 'wink', project: 'another-project' })).status()).toBe(200);
  await page.waitForTimeout(200); await expect(section.locator('.expression-on')).toHaveText('Smile');

  expect((await send({ expression: 'smile' }, {})).status()).toBe(401);
  expect((await send({ expression: 'smile' }, { 'X-Studio-Token': 'x'.repeat(32) })).status()).toBe(401);
  await page.waitForTimeout(60);
  for (const body of [{ expression: 'toString' }, { expression: 'smile', extra: 1 }, ['smile'], { expression: 'smile', project: '../x' }]) expect((await send(body)).status()).toBe(400);
  expect((await request.get(url, { headers: { 'X-Studio-Token': token } })).status()).toBe(405);
  // The token is readable only with the Live page's own request header, and no CORS is granted.
  const tokenResponse = await request.get(new URL('/__live/expression-token', url).href);
  expect(tokenResponse.status()).toBe(403); expect(tokenResponse.headers()['access-control-allow-origin']).toBeUndefined();
});

test('a second Live tab for the same project shows a warning on both, and closing one clears it', async ({ context, page }) => {
  await page.goto('/live.html'); await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId('duplicate-live-page')).toHaveCount(0);
  const second = await context.newPage(); await second.goto('/live.html'); await expect(second.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await expect(second.getByTestId('duplicate-live-page')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('duplicate-live-page')).toBeVisible({ timeout: 5000 });
  await second.close();
  await expect(page.getByTestId('duplicate-live-page')).toHaveCount(0, { timeout: 8000 });
});
