import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import type { MeshAvatarElement } from '../packages/element/src/index';
import { samplePresent, sampleSkipReason } from './sample';

const sample = `http://127.0.0.1:${process.env.PLAYWRIGHT_SITE_PORT ?? 5174}/mesh-avatar-studio/miko.mavatar`;
const defaultSrc = 'https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar';
const outside = new WeakMap<Page, string[]>();

test.beforeEach(async ({ context, page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const requests: string[] = [];
  outside.set(page, requests);
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url === defaultSrc) return route.fetch({ url: sample }).then(response => route.fulfill({ response }));
    if (new URL(url).hostname !== '127.0.0.1') {
      requests.push(url);
      return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(({ page }) => { expect(outside.get(page) ?? []).toEqual([]); });

async function open(page: Page) {
  await page.goto('/e2e/fixtures/embed.html');
  await expect.poll(() => page.evaluate(() => document.querySelector('mesh-avatar')?.avatar !== null &&
    !!document.querySelector('mesh-avatar')?.avatar)).toBe(true);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'loads'))).toBe(1);
}
async function drawn(page: Page) {
  const png = PNG.sync.read(await page.locator('mesh-avatar canvas').screenshot({ omitBackground: true }));
  expect(png.data.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
}

test('default sample renders, emits load and follows expression attributes', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(async () => {
    const el = document.querySelector('mesh-avatar')!;
    return await el.ready === el.avatar && el.avatar === Reflect.get(window, 'loadedAvatar');
  })).toBe(true);
  await drawn(page);
  expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('smile');
  await page.locator('mesh-avatar').evaluate(el => el.setAttribute('expression', 'wink'));
  expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('wink');
  await page.screenshot({ path: 'test-results/embed-element.png' });
});

test('switching src replaces ready and destroys the old avatar; failed loads emit errors and recover', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  expect(await page.evaluate(async src => {
    const el = document.querySelector('mesh-avatar')!;
    const old = el.avatar!, ready = el.ready;
    let destroyed = 0;
    const destroy = old.destroy.bind(old);
    old.destroy = () => { destroyed++; destroy(); };
    el.src = src;
    const current = el.ready;
    const avatar = await current;
    return ready !== current && avatar !== old && el.avatar === avatar && destroyed === 1;
  }, sample + '?replacement')).toBe(true);
  for (const src of ['/missing-avatar.mavatar', '/broken-avatar.mavatar']) {
    await page.route('**' + src, route => route.fulfill({ status: src.includes('missing') ? 404 : 200, body: 'broken' }));
    const previous = await page.evaluate(() => Reflect.get(window, 'errors'));
    await page.locator('mesh-avatar').evaluate((el, src) => { (el as MeshAvatarElement).src = src; }, src);
    await expect.poll(() => page.evaluate(() => Reflect.get(window, 'errors'))).toBe(previous + 1);
    expect(await page.evaluate(async () => {
      try { await document.querySelector('mesh-avatar')!.ready; return false; } catch { return true; }
    })).toBe(true);
  }
  await page.locator('mesh-avatar').evaluate((el, src) => { (el as MeshAvatarElement).src = src; }, sample);
  await expect.poll(() => page.evaluate(() => !!document.querySelector('mesh-avatar')!.avatar)).toBe(true);
  expect(errors).toEqual([]);
});

test('offscreen and paused elements stop advancing and resume on return', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const avatar = document.querySelector('mesh-avatar')!.avatar!;
    const advance = avatar.advance.bind(avatar);
    Reflect.set(window, 'embedFrames', 0);
    avatar.advance = (...args) => { Reflect.set(window, 'embedFrames', Reflect.get(window, 'embedFrames') + 1); advance(...args); };
  });
  const frames = () => page.evaluate(() => Reflect.get(window, 'embedFrames') as number);
  const resumes = async () => { const count = await frames(); await expect.poll(frames).toBeGreaterThan(count); };
  const stops = async () => {
    // Allow the IntersectionObserver or pending animation frame to settle.
    await page.waitForTimeout(200);
    const count = await frames();
    await page.waitForTimeout(250);
    expect(await frames()).toBe(count);
  };
  await resumes();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await stops();
  await page.evaluate(() => window.scrollTo(0, 0));
  await resumes();
  await page.locator('mesh-avatar').evaluate(el => el.setAttribute('paused', ''));
  await stops();
  await page.locator('mesh-avatar').evaluate(el => el.removeAttribute('paused'));
  await resumes();
});

test('moving preserves the avatar; removal destroys it and reconnecting reloads it', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(async () => {
    const el = document.querySelector('mesh-avatar')!, avatar = el.avatar;
    document.querySelector('#second')!.appendChild(el);
    await Promise.resolve();
    return el.avatar === avatar;
  })).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, 'loads'))).toBe(1);
  expect(await page.evaluate(async () => {
    const el = document.querySelector('mesh-avatar')!, old = el.avatar!;
    let destroyed = 0;
    const destroy = old.destroy.bind(old);
    old.destroy = () => { destroyed++; destroy(); };
    el.remove();
    await Promise.resolve();
    const unloaded = el.avatar === null && destroyed === 1;
    document.querySelector('#first')!.appendChild(el);
    return unloaded && await el.ready !== old;
  })).toBe(true);
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'loads'))).toBe(2);
});

test('standalone bundle renders with one module script and no dev-server transformation', async ({ page }) => {
  const bundle = await readFile(new URL('../packages/element/dist/standalone.js', import.meta.url)).catch(error => {
    if (error.code === 'ENOENT') {
      throw new Error('Standalone bundle is missing. Run `npm run build:element` before running this test.', { cause: error });
    }
    throw error;
  });
  await page.route('**/element-standalone.js', route => route.fulfill({ contentType: 'text/javascript', body: bundle }));
  await page.route('**/e2e/fixtures/embed.html', async route => {
    const fixture = await readFile(new URL('./fixtures/embed.html', import.meta.url), 'utf8');
    await route.fulfill({ contentType: 'text/html', body: fixture.replace('/packages/element/src/index.ts', '/element-standalone.js') });
  });
  await open(page);
  expect(await page.evaluate(async () => await document.querySelector('mesh-avatar')!.ready ===
    Reflect.get(window, 'loadedAvatar'))).toBe(true);
  await drawn(page);
});

test('unknown expression warns once without throwing or changing the expression', async ({ page }) => {
  const warnings: string[] = [], errors: string[] = [];
  page.on('console', message => { if (message.type() === 'warning' && message.text().includes('<mesh-avatar>')) warnings.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await page.locator('mesh-avatar').evaluate(el => {
    el.setAttribute('expression', 'grin');
    el.setAttribute('expression', 'smile');
    el.setAttribute('expression', 'grin');
  });
  await expect.poll(() => warnings.length).toBe(1);
  // Console events can arrive asynchronously; repeated values must not warn again.
  await page.waitForTimeout(250);
  expect(warnings).toEqual(['<mesh-avatar> ignores expression="grin".']);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.querySelector('mesh-avatar')!.avatar!.getExpression().name)).toBe('smile');
});

test('load accepts a File, retains it for fit and reconnection, and src restores URL loading', async ({ page }) => {
  await open(page);
  const before = await page.evaluate(() => Reflect.get(window, 'loads'));
  expect(await page.evaluate(async url => {
    const el = document.querySelector('mesh-avatar')!;
    const old = el.avatar;
    const blob = await (await fetch(url)).blob();
    const pending = el.load(new File([blob], 'chosen.mavatar'));
    return pending === el.ready && await pending !== old && el.getAttribute('src') === null;
  }, sample)).toBe(true);
  await drawn(page);
  // If fit or reconnection forgets the File, a fallback URL load will now fail.
  await page.route(defaultSrc, route => route.abort());
  await page.locator('mesh-avatar').evaluate(async el => {
    const avatar = el as MeshAvatarElement;
    avatar.fit = 'cover';
    await avatar.ready;
    avatar.remove();
    await Promise.resolve();
    document.querySelector('#first')!.appendChild(avatar);
    await avatar.ready;
  });
  await expect.poll(() => page.evaluate(() => Reflect.get(window, 'loads'))).toBe(before + 3);
  expect(await page.evaluate(async url => {
    const el = document.querySelector('mesh-avatar')!;
    const old = el.avatar;
    el.src = url;
    return await el.ready !== old && el.src === url;
  }, sample + '?after-file')).toBe(true);
  await drawn(page);
});

test('load rejects broken archive data, emits error and recovers from a subsequent load', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page);
  expect(await page.evaluate(async url => {
    const el = document.querySelector('mesh-avatar')!;
    let rejected = false;
    try { await el.load(new Blob(['broken'])); } catch { rejected = true; }
    const empty = el.avatar === null;
    await el.load(new URL(url));
    return rejected && empty && !!el.avatar;
  }, sample)).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, 'errors'))).toBe(1);
  expect(errors).toEqual([]);
  await drawn(page);
});

test('coalesces connection, src and fit changes and exposes a pending ready immediately', async ({ page }) => {
  await open(page);
  let defaults = 0;
  let explicit = 0;
  page.on('request', request => {
    if (request.url() === defaultSrc) defaults++;
    if (request.url() === sample + '?coalesced') explicit++;
  });
  expect(await page.evaluate(async url => {
    const el = document.createElement('mesh-avatar');
    let loads = 0;
    el.addEventListener('load', () => loads++);
    document.querySelector('#second')!.append(el);
    el.src = url;
    el.fit = 'cover';
    await el.ready;
    const old = el.avatar;
    el.src = url + '&again';
    el.fit = 'contain';
    const pending = el.ready;
    const avatar = await pending;
    return loads === 2 && avatar !== old && avatar === el.avatar;
  }, sample + '?coalesced')).toBe(true);
  expect(defaults).toBe(0);
  expect(explicit).toBe(1);
});


test('mouth settings apply before loading, merge partial updates and survive fit and source reloads', async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async src => {
    const el = document.createElement('mesh-avatar');
    el.paused = true;
    el.lipSync = { granularity: 0, openness: 0 };
    el.setLipSync({ closeSpeed: 0 });
    document.body.append(el);
    const opening = async () => {
      const avatar = await el.ready;
      avatar.setAutoIdle(false); avatar.setAutoMotion(false); avatar.holdMouth('a');
      for (let i = 0; i < 60; i++) avatar.advance(1 / 60);
      return avatar.getParameters().mouthOpen;
    };
    const before = await opening();
    el.setLipSync({ openness: 1 });
    const large = await opening();
    const overrides = el.lipSync;
    overrides.openness = 0; // The getter must not expose retained mutable state.
    let rejected = false;
    try { el.setLipSync({ openness: 2 }); } catch { rejected = true; }
    const retained = el.lipSync;
    el.fit = 'cover';
    const fit = await opening();
    el.src = src + '?settings-reload';
    const source = await opening();
    el.remove();
    return { before, large, fit, source, rejected, retained };
  }, sample);
  expect(result.before).toBeCloseTo(0.495, 5);
  for (const value of [result.large, result.fit, result.source]) expect(value).toBeCloseTo(1, 5);
  expect(result.rejected).toBe(true);
  expect(result.retained).toEqual({ granularity: 0, openness: 1, closeSpeed: 0 });
});
