#!/usr/bin/env node
// Capture only the bundled sample, using disposable copies for writable UI states.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createServer } from 'vite';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const sample = join(root, 'samples/miko-qipao');
const output = join(root, 'docs/images');
const sampleId = 'sample-miko-qipao';
const aliases = new Map();
const temporary = [];
let server, browser, cleanupPromise;

async function cleanup() {
  cleanupPromise ??= (async () => {
    try { await browser?.close(); }
    finally {
      try { await server?.close(); }
      finally { for (const directory of temporary) await rm(directory, { recursive: true, force: true }); }
    }
  })();
  return cleanupPromise;
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(code)); });
}

async function sampleCopy(alias, sprites) {
  const directory = await mkdtemp(join(root, 'projects/.readme-tmp-'));
  temporary.push(directory);
  await cp(sample, directory, { recursive: true, filter: source => {
    const path = relative(sample, source).replaceAll('\\', '/');
    return !['review', ...(!sprites ? ['built/sprites', 'variants', 'variant-requests', 'variant-masks'] : [])].some(prefix => path === prefix || path.startsWith(`${prefix}/`));
  } });
  aliases.set(alias, { directory, sprites });
}
function projectEntry(name, sprites, readOnly = false) {
  return { name, relativePath: readOnly ? 'samples/miko-qipao' : `projects/${name}`,
    absolutePath: `/path/to/mesh-avatar-studio/projects/${name}`, updatedAt: '2000-01-01T00:00:00Z',
    hasSprites: sprites, hasVariants: sprites, readOnly, rigFile: 'rig.json' };
}
function captureApi() {
  return { name: 'readme-capture-only', enforce: 'pre', configureServer(vite) {
    // Intercept before the normal local-project API: never enumerate real projects.
    vite.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith('/__studio/')) { next(); return; }
      const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
      if (request.method !== 'GET') { json(403, { error: 'Screenshot capture is read-only.' }); return; }
      const path = request.url.split('?')[0];
      if (path === '/__studio/context') { json(200, { rootPath: '/path/to/mesh-avatar-studio' }); return; }
      if (path === '/__studio/projects') {
        json(200, [projectEntry(sampleId, true, true), ...[...aliases].map(([name, copy]) => projectEntry(name, copy.sprites))]); return;
      }
      const match = path.match(/^\/__studio\/projects\/([^/]+)\//);
      if (match?.[1] === sampleId) { next(); return; }
      const copy = aliases.get(match?.[1]);
      if (copy) {
        request.url = request.url.replace(`/projects/${match[1]}/`, `/projects/${basename(copy.directory)}/`);
        next(); return;
      }
      json(403, { error: 'Only the bundled sample and screenshot copies are available.' });
    });
  } };
}

// Keep pixel data and structural PNG chunks, excluding text, EXIF, dates and profiles.
function pixelsOnly(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!png.subarray(0, 8).equals(signature)) throw new Error('Expected a PNG screenshot.');
  const chunks = [signature];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), end = offset + length + 12;
    if (end > png.length) throw new Error('Incomplete PNG screenshot.');
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR' && (png.readUInt32BE(offset + 8) !== 1440 || png.readUInt32BE(offset + 12) !== 900)) throw new Error('Screenshots must be 1440×900.');
    if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(type)) chunks.push(png.subarray(offset, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}

async function open(page, project) {
  await page.goto(server.resolvedUrls.local[0]);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await page.locator('.open-menu > summary').click();
  await page.getByTestId(`project-${project}`).click();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  await page.getByTestId('idle-toggle').click();
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
}
async function closeCards(page) {
  await page.getByTestId('variants-panel').evaluate(element => { element.open = false; });
  await page.locator('.right-column').evaluate(element => { element.scrollTop = 0; });
}
async function prepare(page, language, scene) {
  const ja = language === 'ja';
  if (scene === '07-live') {
    await page.goto(new URL(`/live.html?project=${sampleId}`, server.resolvedUrls.local[0]).href);
    await expect(page.getByRole('status').first()).toContainText(ja ? 'アバターの準備完了' : 'Avatar ready');
    // The real URL contains this run's random port; show the usual dev-server address instead.
    await page.locator('.obs-url').evaluate((input, value) => { input.value = value; }, `http://127.0.0.1:5173/stream.html?project=${sampleId}&bg=transparent&fit=contain&idle=1`);
    return;
  }
  if (scene === '08-stream') {
    await page.goto(new URL(`/stream.html?project=${sampleId}&bg=green&idle=0`, server.resolvedUrls.local[0]).href);
    await page.waitForFunction(() => { const canvas = document.querySelector('canvas'); return !!canvas && canvas.width > 0; });
    await page.waitForTimeout(1500);
    return;
  }
  if (scene === '06-new-project') {
    await page.route('**/__studio/projects', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
    for (const path of ['source.png', 'built/base.png']) await page.route(`**/miko-qipao/${path}`, route => route.fulfill({ status: 404, body: '' }));
    await page.goto(server.resolvedUrls.local[0]);
    await expect(page.getByTestId('ask-agent-new')).toBeVisible();
    await expect(page.getByRole('heading', { name: ja ? 'プロジェクトを開く' : 'Open a project', exact: true })).toBeVisible();
    return;
  }
  await open(page, scene === '04-rebuild' ? 'miko-editing' : scene === '05-variants' ? 'miko-variants' : sampleId);
  await closeCards(page);
  if (scene === '02-edit-handles') {
    await page.getByTestId('part-eyes').click();
    await page.getByRole('button', { name: ja ? '選択中のパーツに合わせる' : 'Fit selected part', exact: true }).click();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus-group', 'eyes');
  } else if (scene === '03-lip-sync') {
    await page.getByRole('tab', { name: ja ? '口の動き' : 'Lip sync', exact: true }).click();
    const style = page.getByTestId('audio-lip-settings').getByRole('button', { name: ja ? 'はっきり' : 'Expressive', exact: true });
    await style.click();
    await expect(style).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'あ', exact: true }).click();
    await expect(page.getByRole('button', { name: 'あ', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => Number(await page.getByRole('slider', { name: ja ? '口の開き' : 'Mouth open', exact: true }).inputValue())).toBeGreaterThan(0.98);
    await page.locator('#lip-panel').evaluate(element => { element.scrollTop = 0; });
    await expect(page.locator('.lip-text-row')).toBeInViewport();
    await expect(style).toBeInViewport();
  } else if (scene === '04-rebuild') {
    await page.getByTestId('part-eyes').click();
    await page.locator('summary').filter({ hasText: ja ? /^1 · 開口部 \(\d+\)$/ : /^1 · Opening \(\d+\)$/ }).click();
    await page.getByRole('spinbutton', { name: 'eyes.0.opening.0.0', exact: true }).fill('451');
    await page.getByRole('button', { name: ja ? '選択中のパーツに合わせる' : 'Fit selected part', exact: true }).click();
    await expect(page.getByTestId('editor')).toHaveAttribute('data-focus-group', 'eyes');
    await expect(page.getByTestId('stale-banner').locator('small')).toHaveText(ja ? '変更されたパーツ: 目' : 'Changed parts: Eyes');
    await expect(page.getByRole('button', { name: ja ? '保存してレイヤーを作り直す' : 'Save and rebuild layers', exact: true })).toBeVisible();
    await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  } else if (scene === '05-variants') {
    const panel = page.getByTestId('variants-panel');
    await panel.evaluate(element => { element.open = true; });
    await panel.getByRole('checkbox', { name: ja ? '口' : 'Mouth', exact: true }).check();
    const card = page.getByTestId('ask-agent-variants');
    await card.getByRole('button', { name: 'Codex', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Codex', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(panel.locator('.variant-count').last()).toHaveText(ja ? 'なし' : 'Missing');
    await page.locator('.right-column').evaluate(element => { element.scrollTop += element.querySelector('.variants-panel').getBoundingClientRect().top - element.getBoundingClientRect().top; });
    await expect(card.getByRole('button', { name: ja ? '依頼文をコピー' : 'Copy message', exact: true })).toBeInViewport();
    return;
  }
  await page.locator('.right-column').evaluate(element => { element.scrollTop = 0; });
}
async function capture(language, scene) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: language === 'ja' ? 'ja-JP' : 'en-US', timezoneId: 'UTC' });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(language => {
      localStorage.clear();
      localStorage.setItem('mesh-avatar-language', language);
      localStorage.setItem('mesh-avatar-guide-seen', '1');
      localStorage.setItem('mesh-avatar-reopen-project', '0');
      localStorage.setItem('mesh-avatar-agent-recipient', 'codex');
    }, language);
    await prepare(page, language, scene);
    const editor = !['07-live', '08-stream'].includes(scene);
    if (editor) {
      await page.locator('.open-menu').evaluate(element => { element.open = false; });
      await expect(page.getByTestId('first-guide')).toHaveCount(0);
      await expect(page.locator('.save-notice')).toHaveCount(0);
    }
    await page.mouse.move(1430, 890);
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    if (errors.length) throw new Error(`Browser error: ${errors.join('; ')}`);
    const visible = await page.locator('body').innerText();
    for (const forbidden of [root, homedir(), basename(homedir()), '.readme-tmp-', '2000-01-01', 'Updated:', '更新:', '/path/to/', new Date().toISOString().slice(0, 10)]) {
      if (visible.includes(forbidden)) throw new Error(`Environment-specific text in ${language}/${scene}.`);
    }
    const png = pixelsOnly(await page.screenshot({ type: 'png', animations: 'disabled' }));
    return { language, scene, png };
  } finally { await context.close(); }
}

try {
  await readFile(join(sample, 'source.png')); // Fail before creating any capture files if the sample is absent.
  await mkdir(join(root, 'projects'), { recursive: true });
  await sampleCopy('miko-editing', true);
  await sampleCopy('miko-variants', false);
  server = await createServer({ root, plugins: [captureApi()], server: { host: '127.0.0.1', port: 0, strictPort: true, open: false } });
  await server.listen();
  browser = await chromium.launch();
  const images = [];
  const scenes = ['01-overview', '02-edit-handles', '03-lip-sync', '04-rebuild', '05-variants', '06-new-project', '07-live', '08-stream'];
  for (const language of ['en', 'ja']) for (const scene of scenes) {
    images.push(await capture(language, scene));
    console.log(`Captured ${language}/${scene}.png`);
  }
  for (const { language, scene, png } of images) {
    await mkdir(join(output, language), { recursive: true });
    await writeFile(join(output, language, `${scene}.png`), png);
  }
  console.log(`Saved ${images.length} screenshots to docs/images/{en,ja}/ (1440×900, PNG without metadata).`);
} catch (error) {
  console.error(`screenshots: ${error.message.replaceAll(root, '<repo>/').replaceAll(homedir(), '~')}`);
  process.exitCode = 1;
} finally { await cleanup(); }
