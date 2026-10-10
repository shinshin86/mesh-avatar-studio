import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { resolve, relative, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { validateRig } from '../packages/runtime/src/rig/validate.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const poses = [
  ['rest', {}], ['eyes-half', { eyeLOpen: 0.5, eyeROpen: 0.5 }],
  ['eyes-closed', { eyeLOpen: 0, eyeROpen: 0 }], ['mouth-open', { mouthOpen: 1 }],
  ['turn-left', { angleX: -30 }], ['turn-right', { angleX: 30 }],
  ['look-up', { angleY: 15 }], ['look-down', { angleY: -15 }],
  ['tilt-left', { angleZ: -15 }], ['tilt-right', { angleZ: 15 }],
  ['body-left', { bodyAngleZ: -8 }], ['body-right', { bodyAngleZ: 8 }],
];

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: npm run render-poses -- <project>');
    return;
  }
  if (args.length !== 1) throw new Error('Usage: npm run render-poses -- <project>');
  const project = await realpath(resolve(args[0]));
  if (relative(root, project).startsWith('..')) throw new Error('project must stay inside the repository');
  const rig = JSON.parse(await readFile(resolve(project, 'rig.json'), 'utf8'));
  const errors = validateRig(rig);
  if (errors.length) throw new Error(errors.join('\n'));
  const built = await realpath(resolve(project, 'built'));
  if (relative(project, built).startsWith('..')) throw new Error('built folder must stay inside the project');
  const assets = {};
  async function asset(name) {
    const path = await realpath(resolve(built, name));
    if (relative(built, path).startsWith('..')) throw new Error(`asset escapes built folder: ${name}`);
    assets[name] = `data:${name.endsWith('.png') ? 'image/png' : 'application/json'};base64,${(await readFile(path)).toString('base64')}`;
  }
  await asset('layers.json');
  const layers = JSON.parse(await readFile(resolve(built, 'layers.json'), 'utf8'));
  await Promise.all(['base', 'hairmask', ...Object.keys(layers.layers)].map(name => asset(`${name}.png`)));
  try {
    await asset('sprites/sprites.json');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log('Optional drawn sprites absent; reviewing generated eye/mouth layers.');
  }
  if (assets['sprites/sprites.json']) {
    const sprites = JSON.parse(await readFile(resolve(built, 'sprites/sprites.json'), 'utf8'));
    await Promise.all(Object.keys(sprites.layers).map(name => asset(`sprites/${name}.png`)));
  }
  const server = await createServer({ root, configFile: false, publicDir: false, appType: 'custom', cacheDir: 'node_modules/.vite-pose-review', optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [{ name: 'pose-review-page', configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== '/__pose_review__') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html><body style="margin:0"><canvas id="avatar"></canvas></body></html>');
      });
    } }],
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null, preTransformRequests: false }, logLevel: 'error' });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: Math.ceil(rig.image.width * 1.2), height: Math.ceil(rig.image.height * 1.1) }, deviceScaleFactor: 1 });
    const browserErrors = [];
    page.on('pageerror', error => browserErrors.push(error.message));
    // Only the local code server may be contacted; private images use data URLs.
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(`${origin}/__pose_review__`);
    const result = await page.evaluate(async ({ rig, assets, poses }) => {
      const { createMeshAvatar, PARAMS } = await import('/packages/runtime/src/index.ts');
      const canvas = document.getElementById('avatar');
      const width = Math.ceil(rig.image.width * 1.2), height = Math.ceil(rig.image.height * 1.1);
      canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
      const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
      const pictures = [];
      async function avatar() {
        const av = await createMeshAvatar(canvas, { rig, assets, manual: true, padTop: 0.1, padSide: 0.1 });
        av.setAutoIdle(false); av.setAutoMotion(false); av.setParameters(defaults);
        return av;
      }
      for (const [name, values] of poses) {
        const av = await avatar();
        av.setParameters({ ...defaults, ...values }); av.advance(1, 60);
        pictures.push([name, canvas.toDataURL()]); av.destroy();
      }
      const av = await avatar();
      av.setParameters({ ...defaults, angleX: 30 }); av.advance(0.2, 60);
      av.setParameters(defaults);
      for (const [i, seconds] of [0.05, 0.08, 0.12, 0.15, 0.2, 0.3].entries()) {
        av.advance(seconds, 60); pictures.push([`hair-sway-${i}`, canvas.toDataURL()]);
      }
      av.destroy();
      const scale = Math.min(width / (rig.image.width * 1.2), height / (rig.image.height * 1.1));
      const ox = (width - rig.image.width * scale) / 2, oy = height - rig.image.height * scale;
      const bounds = points => {
        const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
        const margin = 80;
        const x = Math.max(0, Math.floor(ox + (Math.min(...xs) - margin) * scale));
        const y = Math.max(0, Math.floor(oy + (Math.min(...ys) - margin) * scale));
        return [x, y, Math.min(width - x, Math.ceil((Math.max(...xs) - Math.min(...xs) + margin * 2) * scale)),
          Math.min(height - y, Math.ceil((Math.max(...ys) - Math.min(...ys) + margin * 2) * scale))];
      };
      const eyes = bounds(rig.eyes.flatMap(e => e.roi));
      const m = rig.mouth.area;
      const mouth = bounds([[m.cx - m.rx, m.cy - m.ry], [m.cx + m.rx, m.cy + m.ry]]);
      const crops = [];
      const sheet = document.createElement('canvas'); sheet.width = 1200; sheet.height = Math.ceil(pictures.length / 4) * 390;
      const ctx = sheet.getContext('2d'); ctx.fillStyle = '#dedfe5'; ctx.fillRect(0, 0, sheet.width, sheet.height);
      for (const [i, [name, url]] of pictures.entries()) {
        const img = new Image(); img.src = url; await img.decode();
        const x = (i % 4) * 300, y = Math.floor(i / 4) * 390;
        const k = Math.min(288 / width, 350 / height);
        ctx.drawImage(img, x + (300 - width * k) / 2, y + 30, width * k, height * k);
        ctx.fillStyle = '#171b23'; ctx.font = '16px sans-serif'; ctx.fillText(name, x + 8, y + 22);
        for (const [part, rect] of [['eyes', eyes], ['mouth', mouth]]) {
          const crop = document.createElement('canvas'); crop.width = 1000; crop.height = Math.round(rect[3] / rect[2] * 1000);
          const context = crop.getContext('2d'); context.fillStyle = '#919191'; context.fillRect(0, 0, crop.width, crop.height);
          context.imageSmoothingEnabled = false; context.drawImage(img, ...rect, 0, 0, crop.width, crop.height);
          crops.push([`${name}-${part}`, crop.toDataURL()]);
        }
      }
      // Label last so all thumbnails have a consistently readable header.
      for (const [i, [name]] of pictures.entries()) {
        const x = (i % 4) * 300, y = Math.floor(i / 4) * 390;
        ctx.fillStyle = '#dedfe5'; ctx.fillRect(x, y, 300, 30);
        ctx.fillStyle = '#171b23'; ctx.font = '16px sans-serif'; ctx.fillText(name, x + 8, y + 22);
      }
      return { images: [...pictures, ...crops, ['contact-sheet', sheet.toDataURL()]], width, height, cropBounds: { eyes, mouth }, padTop: 0.1, padSide: 0.1 };
    }, { rig, assets, poses });
    if (browserErrors.length) throw new Error(browserErrors.join('\n'));
    const review = resolve(project, 'review'); await mkdir(review, { recursive: true });
    if (relative(project, await realpath(review)).startsWith('..')) throw new Error('review folder must stay inside the project');
    for (const [name, url] of result.images) await writeFile(resolve(review, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
    const { images, ...metadata } = result;
    await writeFile(resolve(review, 'poses.json'), JSON.stringify({ ...metadata, project: basename(project), fixedFps: 60, poseSeconds: 1, poses: poses.map(([name, parameters]) => ({ name, parameters })), hairFrames: 6, files: images.map(([name]) => `${name}.png`) }, null, 2) + '\n');
    console.log(`Rendered ${poses.length + 6} poses, eye/mouth crops and contact-sheet.png in ${relative(root, review)}/`);
  } finally {
    await browser?.close();
    await server.close();
  }
}

main().catch(error => { console.error(`render-poses: ${error.message}`); process.exitCode = 1; });
