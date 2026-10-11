import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { PNG } from 'pngjs';
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';

test.beforeEach(() => test.skip(!samplePresent, sampleSkipReason));
async function guard(context: BrowserContext) {
  const outside: string[] = [];
  await context.route('**/*', route => { const url = route.request().url(); if (new URL(url).hostname !== '127.0.0.1') { outside.push(url); return route.abort(); } return route.continue(); });
  const watch = (page: Page) => page.on('websocket', socket => { if (new URL(socket.url()).hostname !== '127.0.0.1') outside.push(socket.url()); });
  context.pages().forEach(watch); context.on('page', watch);
  return outside;
}
async function freeze(page: Page) {
  await page.addInitScript(() => {
    let clock = 0, next = 0; const frames = new Map<number, FrameRequestCallback>();
    performance.now = () => clock;
    window.requestAnimationFrame = fn => { frames.set(++next, fn); return next; }; window.cancelAnimationFrame = id => { frames.delete(id); };
    Object.assign(window, { stepFrames: (count: number) => { for (let i = 0; i < count; i++) { clock += 1000 / 60; const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(clock)); } } });
  });
}
const image = async (page: Page, selector: string) => PNG.sync.read(Buffer.from(await page.locator(selector).evaluate(c => (c as HTMLCanvasElement).toDataURL().split(',')[1]), 'base64'));
const hash = (png: PNG) => createHash('sha256').update(png.data).digest('hex');

test('off preview and stream hashes match the local pre-lighting capture', async ({ context, page }) => {
  const baseline = 'projects/.lighting-review/before-preview.png';
  test.skip(!existsSync(baseline), 'Local visual baseline is intentionally excluded from version control.');
  const outside = await guard(context); await freeze(page);
  for (const file of readdirSync('projects/.lighting-review').filter(name => /^before-stream-[A-Za-z0-9][A-Za-z0-9._-]*\.png$/.test(name))) {
    const project = file.slice('before-stream-'.length, -4);
    const path = `projects/.lighting-review/before-stream-${project}.png`;
    if (!existsSync(path)) continue;
    await page.goto(`/stream.html?project=${project}&idle=0`);
    await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
    await page.evaluate(() => (window as unknown as { stepFrames: (n: number) => void }).stepFrames(120));
    expect(hash(await image(page, 'canvas'))).toBe(hash(PNG.sync.read(readFileSync(path))));
  }
  await page.goto('/'); await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready'); await dismissGuide(page);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  const revision = await page.getByTestId('preview').getAttribute('data-revision');
  await page.getByTestId('idle-toggle').click();
  await expect(page.getByTestId('preview')).not.toHaveAttribute('data-revision', revision!);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  expect(hash(await image(page, '[data-testid="preview"]'))).toBe(hash(PNG.sync.read(readFileSync(baseline))));
  expect(outside).toEqual([]);
});

test('lighting is lazy, changes brightness with position, preserves alpha, shadows opposite, and off restores pixels', async ({ context, page }) => {
  const outside = await guard(context), errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.requestAnimationFrame = () => 0; });
  await page.goto('/stream.html?idle=0'); await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await page.evaluate(async () => {
    const path = '/src/live/avatar-view.ts', { createAvatarView, neutralParameters } = await import(path);
    const settingsPath = '/packages/runtime/src/index.ts', { DEFAULT_LIGHTING } = await import(settingsPath);
    const canvas = document.createElement('canvas'); canvas.id = 'test-avatar'; canvas.style.cssText = 'width:640px;height:640px'; document.body.append(canvas);
    const view = await createAvatarView(canvas, { project: 'sample-miko-qipao', fit: 'contain', idle: false });
    view.avatar.setParameters(neutralParameters); view.avatar.advance(1);
    Object.assign(window, { testAvatar: view.avatar, defaultLight: DEFAULT_LIGHTING });
  });
  const light = (settings: Record<string, unknown>) => page.evaluate(settings => {
    const w = window as unknown as { testAvatar: import('mesh-avatar').MeshAvatar; defaultLight: import('mesh-avatar').LightingSettings };
    w.testAvatar.setLighting({ ...w.defaultLight, ...settings }); w.testAvatar.advance(0); return w.testAvatar.getLightingStats();
  }, settings);
  const off = await image(page, '#test-avatar');
  expect(await light({ enabled: false })).toEqual({ computedLayers: 0, cachedLayers: 0, normalMs: 0 });
  const initial = await light({ enabled: true, x: 0, y: 0.5, strength: 0.8 });
  expect(initial.computedLayers).toBeGreaterThan(1);
  const left = await image(page, '#test-avatar');
  await light({ enabled: true, x: 1, y: 0.5, strength: 0.8 }); const right = await image(page, '#test-avatar');
  const delta = [0, 0], count = [0, 0]; let alphaChanged = 0;
  for (let y = 0; y < left.height; y++) for (let x = 0; x < left.width; x++) {
    const i = (y * left.width + x) * 4;
    if (left.data[i + 3] !== off.data[i + 3]) alphaChanged++;
    if (left.data[i + 3] < 250) continue;
    const half = x < left.width / 2 ? 0 : 1;
    delta[half] += left.data[i] + left.data[i + 1] + left.data[i + 2] - right.data[i] - right.data[i + 1] - right.data[i + 2]; count[half]++;
  }
  expect(alphaChanged).toBe(0);
  expect(delta[0] / count[0]).toBeGreaterThan(1); expect(delta[1] / count[1]).toBeLessThan(-1);
  const shadowCentres = [];
  for (const x of [0, 1]) {
    await light({ enabled: true, x, y: 0.5, shadow: true }); const shadow = await image(page, '#test-avatar');
    let mass = 0, centre = 0;
    for (let y = 0; y < shadow.height; y++) for (let px = 0; px < shadow.width; px++) {
      const i = (y * shadow.width + px) * 4;
      if (off.data[i + 3] > 0) continue;
      const alpha = shadow.data[i + 3]; mass += alpha; centre += alpha * px;
    }
    expect(mass).toBeGreaterThan(1000); shadowCentres.push(centre / mass);
  }
  expect(shadowCentres[0]).toBeGreaterThan(shadowCentres[1] + 50);
  expect(await light({ enabled: false })).toEqual(initial);
  expect(hash(await image(page, '#test-avatar'))).toBe(hash(off));
  expect(errors).toEqual([]); expect(outside).toEqual([]);
});

test('editor remembers lighting, keeps the section closed by default, hides the handle while closed, and resets in all languages', async ({ context, page }) => {
  const outside = await guard(context);
  await page.goto('/'); await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready'); await dismissGuide(page);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await expect(page.getByRole('button', { name: 'Light position', exact: true })).toHaveCount(0);
  const section = page.getByTestId('lighting-section');
  await expect(section).not.toHaveAttribute('open', '');
  await expect(page.getByRole('tab', { name: 'Lighting' })).toHaveCount(0);
  await section.locator('summary').click();
  await page.getByRole('checkbox', { name: 'Enable lighting' }).check();
  const handle = page.getByRole('button', { name: 'Light position', exact: true });
  await handle.focus(); await handle.press('ArrowRight');
  await expect(handle).toHaveCSS('left', /px$/);
  await page.getByLabel('Shading', { exact: true }).selectOption('cel');
  await expect(section.locator('.lighting-on')).toBeVisible();
  await section.locator('summary').click(); await expect(handle).toHaveCount(0);
  await page.reload(); await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await expect(section).not.toHaveAttribute('open', '');
  await section.locator('summary').click();
  await expect(page.getByRole('checkbox', { name: 'Enable lighting' })).toBeChecked();
  await expect(page.getByLabel('Shading', { exact: true })).toHaveValue('cel');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'ライティングを有効にする' })).toBeVisible();
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await page.getByRole('button', { name: '重置光照', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '启用光照' })).not.toBeChecked();
  expect(outside).toEqual([]);
});

test('live drag updates matching streams without a camera, and OBS URLs carry every lighting option', async ({ context, page }) => {
  const outside = await guard(context);
  await page.goto('/live.html'); await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
  const stream = await context.newPage(); await stream.goto('/stream.html?idle=0'); await expect(stream.locator('canvas')).toHaveAttribute('data-state', 'ready');
  await stream.evaluate(async () => {
    const path = '/src/live/relay.ts', { receiveLighting } = await import(path);
    Object.assign(window, { latestLighting: null, wrongProject: false });
    receiveLighting('sample-miko-qipao', (value: unknown) => Object.assign(window, { latestLighting: value }));
    receiveLighting('unrelated-project', () => Object.assign(window, { wrongProject: true }));
  });
  const before = hash(await image(stream, 'canvas'));
  await expect(page.getByRole('button', { name: 'Light position', exact: true })).toHaveCount(0);
  await page.getByTestId('lighting-section').locator('summary').click();
  await page.getByRole('checkbox', { name: 'Enable lighting' }).check();
  const handle = page.getByRole('button', { name: 'Light position', exact: true }), bounds = await page.locator('canvas').boundingBox();
  await handle.hover(); await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.9, bounds!.y + bounds!.height * 0.3, { steps: 12 }); await page.mouse.up();
  await page.getByLabel('Shading', { exact: true }).selectOption('cel');
  await page.getByRole('checkbox', { name: 'Drop shadow' }).check();
  await expect.poll(() => stream.evaluate(() => (window as unknown as { latestLighting: unknown }).latestLighting)).toMatchObject({ enabled: true, mode: 'cel', shadow: true });
  await expect.poll(async () => hash(await image(stream, 'canvas'))).not.toBe(before);
  expect(await stream.evaluate(() => (window as unknown as { wrongProject: boolean }).wrongProject)).toBe(false);
  const url = new URL(await page.getByRole('textbox', { name: 'Copy OBS URL' }).inputValue());
  expect(url.searchParams.get('light')).toBe('1'); expect(Number(url.searchParams.get('lx'))).toBeCloseTo(0.9, 2); expect(url.searchParams.get('lm')).toBe('cel'); expect(url.searchParams.get('shadow')).toBe('1');
  expect(await page.getByRole('link', { name: 'Open stream view' }).getAttribute('href')).toBe(url.href);
  expect(outside).toEqual([]);
});
