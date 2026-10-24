import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { readFile } from 'node:fs/promises';
import { samplePresent, sampleSkipReason } from './sample';

const site = `http://127.0.0.1:${process.env.PLAYWRIGHT_SITE_PORT ?? 5174}/mesh-avatar-studio/`;
const defaultSource = 'https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar';
const outside = new WeakMap<Page, string[]>();

test.beforeEach(async ({ context, page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const requests: string[] = [];
  outside.set(page, requests);
  const archive = await (await page.request.get(`${site}miko.mavatar`)).body();
  await context.route('**/*', route => {
    if (route.request().url() === defaultSource) {
      return route.fulfill({ contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: archive });
    }
    if (new URL(route.request().url()).hostname !== '127.0.0.1') {
      requests.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(({ page }) => { expect(outside.get(page) ?? []).toEqual([]); });

async function checkMouthStyles(page: Page, language = 'en') {
  const selector = page.getByRole('combobox', { name: language === 'ja' ? '口の動きのタイプ' : 'Mouth style', exact: true });
  await expect(selector).toHaveValue('default');
  await expect(selector.locator('option:not([disabled])')).toHaveText(language === 'ja'
    ? ['ゆったり', '標準', 'キビキビ', '控えめ', 'はっきり']
    : ['Relaxed', 'Standard', 'Snappy', 'Subtle', 'Expressive']);
  expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.lipSync)).toEqual({});
  const styles = {
    calm: { granularity: 0, openness: 0.5, closeSpeed: 0 },
    default: { granularity: 0.5, openness: 0.5, closeSpeed: 0.5 },
    lively: { granularity: 1, openness: 0.5, closeSpeed: 1 },
    subtle: { granularity: 0.5, openness: 0, closeSpeed: 0.5 },
    big: { granularity: 0.5, openness: 1, closeSpeed: 0.5 },
  };
  for (const [name, settings] of Object.entries(styles)) {
    await selector.selectOption(name);
    expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.lipSync)).toEqual(settings);
    if (name === 'subtle' || name === 'big') {
      const opening = await page.evaluate(() => {
        const el = document.querySelector('mesh-avatar')!, avatar = el.avatar!;
        el.paused = true; avatar.holdMouth('a');
        for (let i = 0; i < 60; i++) avatar.advance(1 / 60);
        const value = avatar.getParameters().mouthOpen;
        avatar.stopLipSync(); el.paused = false;
        return value;
      });
      if (name === 'subtle') { expect(opening).toBeGreaterThan(0.45); expect(opening).toBeLessThan(0.55); }
      else expect(opening).toBeGreaterThan(0.95);
    }
  }
}

for (const language of ['en', 'ja']) {
  test(`embed demo works in ${language} without outside requests`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${site}${language === 'ja' ? 'ja/' : ''}embed/`);
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await checkMouthStyles(page, language);
    await expect(page.locator('#mouth-style-code')).toContainText('el.setLipSync({ granularity: 0.5, openness: 1, closeSpeed: 0.5 });');
    const image = PNG.sync.read(await page.locator('mesh-avatar canvas').screenshot({ omitBackground: true }));
    expect(image.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    await page.locator('[data-expression="smile"]').click();
    expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('smile');
    await expect(page.locator('#expression-code')).toHaveText('<mesh-avatar expression="smile"></mesh-avatar>');
    await page.locator('[data-expression="neutral"]').click();
    await expect(page.locator('#expression-code')).toHaveText('<mesh-avatar></mesh-avatar>');
    expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('neutral');
    await expect(page.locator('mesh-avatar')).not.toHaveAttribute('src');
    const box = await page.locator('mesh-avatar').boundingBox();
    expect(box!.width).toBeCloseTo(box!.height);
    await expect(page.locator('#emotion, #paused, #no-idle, #audio-file, #microphone')).toHaveCount(0);
    await page.locator('#speech-text').fill('こんにちは、よろしくお願いします。');
    await page.locator('#speech-form button').click();
    expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getLipSyncState().active)).toBe(true);
    await expect(page.locator('#speech-code')).toHaveText("const el = document.querySelector('mesh-avatar');\nel.speak('こんにちは、よろしくお願いします。');");
    await page.locator('#speech-text').fill("a'\\b</script>");
    await expect(page.locator('#speech-code')).toHaveText("const el = document.querySelector('mesh-avatar');\nel.speak('a\\'\\\\b\\x3c/script>');");

    await page.evaluate(() => Reflect.set(window, 'previousAvatar', document.querySelector('mesh-avatar')!.avatar));
    const archive = await (await page.request.get(`${site}miko.mavatar`)).body();
    await page.locator('#avatar-file').setInputFiles({
      name: 'chosen.mavatar', mimeType: 'application/octet-stream', buffer: archive,
    });
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#source-name')).toHaveText('chosen.mavatar');
    await expect(page.locator('#mouth-style')).toHaveValue('big');
    await expect(page.locator('#selected-file')).toContainText('chosen.mavatar');
    await expect(page.locator('#file-code')).toHaveText('<mesh-avatar src="/path/to/your-avatar.mavatar"></mesh-avatar>');
    expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar !== Reflect.get(window, 'previousAvatar'))).toBe(true);
    await page.locator('#restore-miko').click();
    await expect(page.locator('#source-name')).toHaveText('Miko');
    await expect(page.locator('#file-code')).toHaveText('<mesh-avatar></mesh-avatar>');
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');

    await page.locator('#avatar-file').setInputFiles({
      name: 'broken.mavatar', mimeType: 'application/octet-stream', buffer: Buffer.from('broken'),
    });
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
    await page.locator('#restore-miko').click();
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.language-switch')).toHaveAttribute('href', language === 'ja' ? '../../embed/' : '../ja/embed/');
    expect(errors).toEqual([]);
  });
}

for (const example of ['basic', 'playground']) {
  test(`standalone ${example} example opens directly from disk`, async ({ page }) => {
    // Use the unpublished build at the real CDN URL, without sending any requests outside.
    const bundle = await readFile(new URL('../packages/element/dist/standalone.js', import.meta.url));
    const archive = await (await page.request.get(`${site}miko.mavatar`)).body();
    await page.route('https://cdn.jsdelivr.net/npm/mesh-avatar-element@0/dist/standalone.js', route => route.fulfill({
      contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' }, body: bundle,
    }));
    await page.route('https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar', route => route.fulfill({
      contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body: archive,
    }));
    // Local file navigation is the feature under test, so it bypasses the HTTP-only guard.
    await page.route('file://**', route => route.continue());
    await page.goto(new URL(`../packages/element/examples/${example}.html`, import.meta.url).href);
    await expect.poll(() => page.evaluate(() => !!document.querySelector('mesh-avatar')?.avatar)).toBe(true);
    if (example === 'playground') {
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
      await checkMouthStyles(page);
      await page.locator('[data-expression="wink"]').click();
      expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('wink');
      await page.locator('#avatar-file').setInputFiles({ name: 'chosen.mavatar', mimeType: 'application/octet-stream', buffer: archive });
      await expect(page.locator('#source-name')).toHaveText('chosen.mavatar');
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
      await page.locator('#restore-miko').click();
      await expect(page.locator('#source-name')).toHaveText('Miko');
      await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    }
  });
}
