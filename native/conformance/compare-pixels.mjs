// Local-only Chromium/WebGL and wgpu comparison. Outputs stay under native/target/.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const noAA = process.argv.includes('--no-aa');
const metal = process.argv.includes('--metal');
const dpr = process.argv.includes('--dpr=2') ? 2 : 1;
const out = resolve(root, `native/target/pixel-comparison${metal ? '-metal' : ''}${noAA ? '-no-aa' : ''}${dpr === 2 ? '-dpr2' : ''}`);
const project = resolve(root, 'samples/miko-qipao');
const baselineOnly = process.argv.includes('--baseline-only');
const allPoses = [
  { name: 'rest', parameters: {} },
  { name: 'half-eyes', parameters: { eyeLOpen: 0.5, eyeROpen: 0.5 } },
  { name: 'closed-eyes', parameters: { eyeLOpen: 0, eyeROpen: 0, eyeSmile: 1 } },
  { name: 'mouth-a', parameters: { mouthOpen: 0.8 } },
  { name: 'mouth-i', parameters: { mouthOpen: 0.8, mouthForm: -1 } },
  { name: 'gaze-blush', parameters: { gazeX: 1, gazeY: -0.7, blush: 1 } },
  { name: 'turn-left', parameters: { angleX: -30, angleY: 10, angleZ: -15, bodyAngleZ: 8, breath: 1 } },
  { name: 'turn-right', parameters: { angleX: 30, angleY: -10, angleZ: 15 } },
  { name: 'sad', parameters: {}, expression: 'sad', seconds: 1 },
  { name: 'painted-mouth-lids', parameters: { eyeLOpen: 0.2, eyeROpen: 0.5, eyeSmile: 0.9, mouthOpen: 0.9, mouthForm: 0.7, blush: 1 }, noSprites: true },
  { name: 'cover-wide', parameters: { gazeX: -1, mouthOpen: 0.75, mouthForm: 0.7 }, size: [640, 360], fit: 'cover', padTop: 0.1, padSide: 0.12 },
  { name: 'contain-odd', parameters: { angleX: 20, angleZ: -10 }, size: [333, 501], padTop: 0.1, padSide: 0.1 },
];
const poses = dpr === 2 ? allPoses.filter(p => ['rest', 'cover-wide', 'contain-odd'].includes(p.name))
  .map(p => ({ ...p, size: (p.size ?? [512, 640]).map(v => Math.ceil(v / dpr) * dpr) })) : allPoses;
const run = promisify(execFile);

function metrics(a, b) {
  let rawMax = 0, rawSum = 0, rawOver = 0, pmMax = 0, pmSum = 0, pmOver = 0, alphaMax = 0;
  const diff = new PNG({ width: a.width, height: a.height });
  for (let i = 0; i < a.data.length; i += 4) {
    let pixelRaw = 0, pixelPm = 0;
    for (let c = 0; c < 4; c++) {
      const raw = Math.abs(a.data[i + c] - b.data[i + c]);
      const pm = c === 3 ? raw : Math.abs(a.data[i + c] * a.data[i + 3] / 255 - b.data[i + c] * b.data[i + 3] / 255);
      rawMax = Math.max(rawMax, raw); rawSum += raw; pmMax = Math.max(pmMax, pm); pmSum += pm;
      pixelRaw = Math.max(pixelRaw, raw); pixelPm = Math.max(pixelPm, pm);
      if (c < 3) diff.data[i + c] = Math.min(255, Math.round(pm * 8));
    }
    alphaMax = Math.max(alphaMax, Math.abs(a.data[i + 3] - b.data[i + 3]));
    rawOver += pixelRaw > 8 ? 1 : 0; pmOver += pixelPm > 8 ? 1 : 0;
    diff.data[i + 3] = 255;
  }
  const pixels = a.width * a.height;
  return { raw: { max: rawMax, mean: rawSum / a.data.length, percentOver8: rawOver / pixels * 100 },
    premultiplied: { max: pmMax, mean: pmSum / a.data.length, percentOver8: pmOver / pixels * 100 }, alphaMax, diff };
}

async function main() {
  await mkdir(out, { recursive: true });
  const rig = JSON.parse(await readFile(resolve(project, 'rig.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(resolve(project, 'built/layers.json'), 'utf8'));
  const sprites = JSON.parse(await readFile(resolve(project, 'built/sprites/sprites.json'), 'utf8'));
  const assets = {};
  for (const name of ['layers.json', 'base.png', 'hairmask.png', ...Object.keys(metadata.layers).map(name => `${name}.png`),
    'sprites/sprites.json', ...Object.keys(sprites.layers).map(name => `sprites/${name}.png`)]) {
    const mime = name.endsWith('.png') ? 'image/png' : 'application/json';
    assets[name] = `data:${mime};base64,${(await readFile(resolve(project, 'built', name))).toString('base64')}`;
  }
  const server = await createServer({ root, configFile: false, publicDir: false, appType: 'custom', cacheDir: 'node_modules/.vite-native-pixels',
    optimizeDeps: { noDiscovery: true, entries: [] }, logLevel: 'error',
    plugins: [{ name: 'native-pixel-page', configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__native_compare__') return next();
        res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body style="margin:0"><canvas id="avatar"></canvas>');
      });
    } }], server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, preTransformRequests: false } });
  let browser;
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    browser = await chromium.launch(metal ? { args: ['--use-angle=metal'] } : {});
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: dpr });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/__native_compare__`);
    const baseline = await page.evaluate(async ({ rig, assets, poses, noAA, dpr }) => {
      const { createMeshAvatar, PARAMS } = await import('/packages/runtime/src/index.ts');
      const { seededRandom } = await import('/tools/motion-scenarios.mjs');
      const canvas = document.getElementById('avatar'), results = [];
      if (noAA) canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true, preserveDrawingBuffer: true });
      const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
      for (const pose of poses) {
        Math.random = seededRandom(0);
        const size = pose.size ?? [512, 640]; canvas.style.width = `${size[0] / dpr}px`; canvas.style.height = `${size[1] / dpr}px`;
        const images = { ...assets }; if (pose.noSprites) delete images['sprites/sprites.json'];
        const avatar = await createMeshAvatar(canvas, { rig, assets: images, manual: true, fit: pose.fit ?? 'contain',
          padTop: pose.padTop ?? rig.view.padTop, padSide: pose.padSide ?? rig.view.padSide });
        avatar.setAutoIdle(false); avatar.setAutoMotion(false); avatar.setParameters({ ...defaults, ...pose.parameters });
        if (pose.expression) avatar.setExpression(pose.expression);
        avatar.advance(0); if (pose.seconds) avatar.advance(pose.seconds, 60);
        const gl = canvas.getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
        results.push({ name: pose.name, image: canvas.toDataURL(), samples: gl.getParameter(gl.SAMPLES),
          renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) });
        avatar.destroy();
      }
      return results;
    }, { rig, assets, poses, noAA, dpr });
    if (errors.length) throw new Error(errors.join('\n'));
    for (const item of baseline) await writeFile(resolve(out, `${item.name}-js.png`), Buffer.from(item.image.split(',')[1], 'base64'));
    await writeFile(resolve(out, 'baseline.json'), JSON.stringify(baseline.map(({ image: _image, ...info }) => info), null, 2) + '\n');
    console.log(`Saved ${baseline.length} Chromium baseline images`);
    if (baselineOnly) return;
    execFileSync('cargo', ['build', '-p', 'mesh-avatar-wgpu', '--bin', 'mesh-avatar-render'], { cwd: resolve(root, 'native'), stdio: 'inherit' });
    const reports = [], gallery = [];
    let nativeRenderer;
    for (const [i, pose] of poses.entries()) {
      const posePath = resolve(out, `${pose.name}-params.json`), nativePath = resolve(out, `${pose.name}-native.png`);
      await writeFile(posePath, JSON.stringify(pose.parameters) + '\n');
      const size = pose.size ?? [512, 640];
      const args = [project, '--pose', posePath, '--seconds', String(pose.seconds ?? 0), '--size', size.join('x'),
        '--samples', String(baseline[i].samples || 1), '-o', nativePath];
      if (pose.fit) args.push('--fit', pose.fit);
      if (pose.padTop !== undefined) args.push('--pad-top', String(pose.padTop));
      if (pose.padSide !== undefined) args.push('--pad-side', String(pose.padSide));
      if (pose.expression) args.push('--expression', pose.expression);
      if (pose.noSprites) args.push('--no-sprites');
      const { stderr } = await run(resolve(root, 'native/target/debug/mesh-avatar-render'), args, { cwd: root });
      process.stderr.write(stderr);
      nativeRenderer ??= stderr.split('\n').find(line => line.startsWith('GPU:'));
      const nativeBytes = await readFile(nativePath);
      const a = PNG.sync.read(Buffer.from(baseline[i].image.split(',')[1], 'base64')), b = PNG.sync.read(nativeBytes);
      if (a.width !== b.width || a.height !== b.height) throw new Error(`Image size mismatch: ${pose.name}`);
      const { diff, ...stats } = metrics(a, b), diffBytes = PNG.sync.write(diff);
      await writeFile(resolve(out, `${pose.name}-diff.png`), diffBytes);
      reports.push({ name: pose.name, size, samples: baseline[i].samples, ...stats });
      gallery.push({ name: pose.name, images: [baseline[i].image, `data:image/png;base64,${nativeBytes.toString('base64')}`, `data:image/png;base64,${diffBytes.toString('base64')}`] });
      console.log(`${pose.name}: raw max ${stats.raw.max}, mean ${stats.raw.mean.toFixed(4)}, >8 ${stats.raw.percentOver8.toFixed(3)}%; premult max ${stats.premultiplied.max.toFixed(2)}, mean ${stats.premultiplied.mean.toFixed(4)}, >8 ${stats.premultiplied.percentOver8.toFixed(3)}%`);
    }
    const sheets = await page.evaluate(async gallery => {
      const sheets = [];
      for (const [index, row] of gallery.entries()) {
        const sheet = document.createElement('canvas'); sheet.width = 1536; sheet.height = 680;
        const ctx = sheet.getContext('2d'); ctx.fillStyle = '#dedfe5'; ctx.fillRect(0, 0, sheet.width, sheet.height);
        for (const [i, url] of row.images.entries()) {
          const image = new Image(); image.src = url; await image.decode();
          const scale = Math.min(512 / image.width, 640 / image.height);
          ctx.drawImage(image, i * 512 + (512 - image.width * scale) / 2, 40, image.width * scale, image.height * scale);
          ctx.fillStyle = '#171b23'; ctx.font = '18px sans-serif'; ctx.fillText(`${row.name}: ${['Chromium', 'wgpu', 'premult diff x8'][i]}`, i * 512 + 12, 27);
        }
        sheets.push({ name: `${row.name}-comparison.png`, url: sheet.toDataURL() });
        if (index === 0) {
          const image = new Image(); image.src = row.images[1]; await image.decode();
          const crop = document.createElement('canvas'); crop.width = 900; crop.height = 700;
          const c = crop.getContext('2d'); c.fillStyle = '#dedfe5'; c.fillRect(0, 0, 900, 700);
          c.drawImage(image, image.width * 0.26, image.height * 0.18, image.width * 0.48, image.height * 0.34, 0, 0, 900, 700);
          sheets.push({ name: 'rest-native-face.png', url: crop.toDataURL() });
        }
      }
      return sheets;
    }, gallery);
    for (const sheet of sheets) await writeFile(resolve(out, sheet.name), Buffer.from(sheet.url.split(',')[1], 'base64'));
    await writeFile(resolve(out, 'report.json'), JSON.stringify({ threshold: 8, diffGain: 8, dpr, chromiumRenderer: baseline[0].renderer, nativeRenderer, poses: reports }, null, 2) + '\n');
    const lines = ['# Pixel comparison', '', `Chromium: ${baseline[0].renderer}`, ``, `Native: ${nativeRenderer}`, '', `Device pixel ratio: ${dpr}. Comparisons use equal physical image sizes.`, '',
      'RGBA values are 0–255. Transparent pixels can magnify straight RGB differences; premultiplied statistics measure their visible contribution. Diff images amplify premultiplied RGB differences by 8.', '',
      '| Pose | Raw max | Raw mean | Raw pixels >8 | Premult max | Premult mean | Premult pixels >8 |',
      '|---|---:|---:|---:|---:|---:|---:|',
      ...reports.map(r => `| [${r.name}](${r.name}-comparison.png) | ${r.raw.max} | ${r.raw.mean.toFixed(4)} | ${r.raw.percentOver8.toFixed(3)}% | ${r.premultiplied.max.toFixed(2)} | ${r.premultiplied.mean.toFixed(4)} | ${r.premultiplied.percentOver8.toFixed(3)}% |`), ''];
    await writeFile(resolve(out, 'report.md'), lines.join('\n'));
    console.log(`Comparison images and report: ${relative(root, out)}/`);
  } finally { await browser?.close(); await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
