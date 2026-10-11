import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { samplePresent, sampleSkipReason } from './sample';

const name = `archive-check-${randomUUID()}.mavatar`, path = `projects/${name}`;
test.beforeAll(async () => {
  if (!samplePresent) return;
  await mkdir('projects', { recursive: true });
  execFileSync(process.execPath, ['--experimental-strip-types', 'tools/pack-avatar.mjs', 'samples/miko-qipao', '-o', path]);
});
test.afterAll(async () => { if (samplePresent) await unlink(path); });

test('stored archive renders the same stream as its folder, with local requests and project precedence', async ({ page, baseURL }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const outside: string[] = [], errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = route.request().url(); requests.push(url);
    if (new URL(url).origin !== baseURL) { outside.push(url); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(() => {
    Math.random = () => 0.5;
    let time = 0, id = 0; const frames = new Map<number, FrameRequestCallback>();
    performance.now = () => time;
    window.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
    window.cancelAnimationFrame = key => { frames.delete(key); };
    Object.assign(window, { stepFrames(count: number) {
      for (let i = 0; i < count; i++) {
        time += 1000 / 60;
        const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(time));
      }
    } });
  });
  const hashes: string[] = [];
  for (const query of ['', `&avatar=${encodeURIComponent(`/__studio/projects/${name}`)}`, '&project=sample-miko-qipao&avatar=/must-not-load.mavatar', '&avatar=https%3A%2F%2Fexample.com%2Fexternal.mavatar']) {
    await page.goto(`/stream.html?idle=0${query}`);
    await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
    await page.evaluate(() => (window as unknown as { stepFrames: (count: number) => void }).stepFrames(120));
    const bytes = Buffer.from(await page.locator('canvas').evaluate(element => (element as HTMLCanvasElement).toDataURL().split(',')[1]), 'base64');
    const png = PNG.sync.read(bytes);
    expect(png.data.some((value, i) => i % 4 === 3 && value > 0)).toBe(true);
    hashes.push(createHash('sha256').update(png.data).digest('hex'));
    if (query.includes(name)) {
      await mkdir('work/runtime-r3', { recursive: true });
      await writeFile('work/runtime-r3/archive-canvas.png', bytes);
      await page.screenshot({ path: 'work/runtime-r3/archive-stream.png' });
    }
  }
  expect(new Set(hashes).size).toBe(1);
  expect(requests.some(url => url.includes(name))).toBe(true);
  expect(requests.some(url => new URL(url).pathname === '/must-not-load.mavatar')).toBe(false);
  expect(outside).toEqual([]); expect(errors).toEqual([]);
});
