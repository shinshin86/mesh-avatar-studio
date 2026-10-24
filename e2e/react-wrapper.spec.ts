import { expect, test, type Page } from '@playwright/test';
import { samplePresent, sampleSkipReason } from './sample';
import type { MeshAvatarElement, MeshAvatarProps } from '../packages/react/src/index';

const sample = `http://127.0.0.1:${process.env.PLAYWRIGHT_SITE_PORT ?? 5174}/mesh-avatar-studio/miko.mavatar`;
const defaultSrc = 'https://shinshin86.github.io/mesh-avatar-studio/miko.mavatar';
type Harness = { ref: { current: MeshAvatarElement | null }; log: { version: number; event: string; value: unknown }[];
  reactVersion: string; update: (props: MeshAvatarProps) => void; unmount: () => void };
declare global { interface Window { harness: Harness } }
const requests = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page, context }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const urls: string[] = [];
  requests.set(page, urls);
  await context.route('**/*', route => {
    const url = route.request().url();
    urls.push(url);
    if (url === defaultSrc) return route.fetch({ url: sample }).then(response => route.fulfill({ response }));
    if (new URL(url).hostname !== '127.0.0.1') return route.abort();
    return route.continue();
  });
});
test.afterEach(({ page }) => {
  expect(requests.get(page)!.filter(url => new URL(url).hostname !== '127.0.0.1')).toEqual([]);
});
async function open(page: Page, fixture = 'react', strict = false) {
  await page.goto(`/e2e/fixtures/${fixture}.html?src=${encodeURIComponent(sample)}${strict ? '&strict' : ''}`);
  await expect.poll(() => page.evaluate(() => !!window.harness?.ref.current?.avatar)).toBe(true);
  expect(await page.evaluate(() => window.harness.log.filter(x => x.event === 'load').length)).toBe(1);
  expect(requests.get(page)!.filter(url => url === sample)).toHaveLength(1);
  expect(requests.get(page)).not.toContain(defaultSrc);
}

test('loads only the supplied src and forwards HTML props and ref', async ({ page }) => {
  await open(page);
  await expect(page.locator('mesh-avatar')).toHaveAttribute('aria-label', 'Character');
  await expect(page.locator('mesh-avatar')).toHaveCSS('width', '300px');
  await page.locator('mesh-avatar').screenshot({ path: 'test-results/react-avatar.png', omitBackground: true });
});

test('updates and removes controlled attributes', async ({ page }) => {
  await open(page);
  await page.evaluate(src => window.harness.update({ src, expression: 'smile', emotion: 'happy', noIdle: true, paused: true, label: 'Miko' }), sample);
  const el = page.locator('mesh-avatar');
  for (const [name, value] of Object.entries({ expression: 'smile', emotion: 'happy', 'no-idle': '', paused: '', label: 'Miko' })) {
    await expect(el).toHaveAttribute(name, value);
  }
  expect(await page.evaluate(() => window.harness.ref.current!.avatar!.getExpression().name)).toBe('smile');
  await page.evaluate(src => window.harness.update({ src }), sample);
  for (const name of ['expression', 'emotion', 'no-idle', 'paused', 'label']) await expect(el).not.toHaveAttribute(name);
  expect(await page.evaluate(() => window.harness.ref.current!.avatar!.getExpression().name)).toBe('neutral');
});

async function fileAndRestore(page: Page) {
  await page.evaluate(async src => {
    const data = await (await fetch(src)).arrayBuffer();
    window.harness.update({ src, source: new File([data], 'chosen.mavatar'), paused: true });
  }, sample);
  await expect.poll(() => page.evaluate(() => window.harness.log.filter(x => x.event === 'load').length)).toBe(2);
  await page.evaluate(src => window.harness.update({ src, paused: true }), sample);
  await expect.poll(() => page.evaluate(() => window.harness.log.filter(x => x.event === 'load').length)).toBe(3);
  await expect.poll(() => page.evaluate(() => !!window.harness.ref.current!.avatar)).toBe(true);
}
test('loads a File and restores the unchanged src when source is removed', async ({ page }) => {
  await open(page);
  await fileAndRestore(page);
});

test('delivers load, error and motion once to the latest callbacks', async ({ page }) => {
  await open(page);
  await page.evaluate(src => window.harness.update({ src, paused: true, label: 'Updated callbacks' }), sample);
  await expect(page.locator('mesh-avatar')).toHaveAttribute('label', 'Updated callbacks');
  await page.evaluate(() => {
    window.harness.ref.current!.dispatchEvent(new CustomEvent('motion', { detail: { id: 'wave' } }));
  });
  expect(await page.evaluate(() => window.harness.log.filter(x => x.event === 'motion'))).toEqual([{ version: 1, event: 'motion', value: 'wave' }]);
  await page.evaluate(src => window.harness.update({ src, source: new Blob(['broken']) }), sample);
  await expect.poll(() => page.evaluate(() => window.harness.log.filter(x => x.event === 'error'))).toEqual([{ version: 2, event: 'error', value: expect.any(String) }]);
  await page.evaluate(src => window.harness.update({ src }), sample);
  await expect.poll(() => page.evaluate(() => window.harness.log.filter(x => x.event === 'load').map(x => x.version))).toEqual([0, 3]);
});

test('StrictMode loads once and destroys the avatar on unmount', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await open(page, 'react', true);
  await page.evaluate(() => {
    const el = window.harness.ref.current!;
    Reflect.set(window, 'removedElement', el);
    window.harness.unmount();
  });
  await expect.poll(() => page.evaluate(() => (Reflect.get(window, 'removedElement') as MeshAvatarElement).avatar)).toBe(null);
  expect(await page.evaluate(() => window.harness.ref.current)).toBe(null);
  expect(errors).toEqual([]);
});

