// Run with Node.js 22.17+: node --experimental-strip-types native/conformance/dump.mjs
import { existsSync } from 'node:fs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { dumpDeformation } from './deformation.mjs';
import { dumpMotion } from './motion.mjs';
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./sync-motion-data.mjs', import.meta.url)), '--check'], { stdio: 'inherit' });

// Match the runtime's bundler-style extensionless lighting imports in plain Node.
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    for (const extension of ['.ts', '.js']) {
      const url = new URL(specifier + extension, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
  }
  return next(specifier, context);
} });
const { createRig } = await import('../../packages/runtime/src/engine/rig.js');
const { createRenderer } = await import('../../packages/runtime/src/engine/renderer.js');
const { parseRig } = await import('../../packages/runtime/src/rig/validate.ts');

const sample = new URL('../../samples/miko-qipao/', import.meta.url);
const json = async path => JSON.parse(await readFile(new URL(path, sample), 'utf8'));
const rig = parseRig(await json('rig.json'));
const metadata = await json('built/layers.json');
const sprites = await json('built/sprites/sprites.json');
const engine = createRig(rig);
const { buildGrid } = createRenderer(engine, rig);
const plain = mesh => Object.fromEntries(Object.entries(mesh).map(([key, value]) =>
  [key, ArrayBuffer.isView(value) ? Array.from(value) : value]));
const grids = [];
const images = {};
for (const [sprite, rectangles] of [[false, { base: [0, 0, rig.image.width, rig.image.height], ...metadata.layers }], [true, sprites.layers]]) {
  for (const [name, rect] of Object.entries(rectangles)) {
    const texture = `${sprite ? 'sprites/' : ''}${name}.png`;
    const image = PNG.sync.read(await readFile(new URL(`built/${texture}`, sample)));
    images[texture] = image;
    if (image.width !== rect[2] || image.height !== rect[3]) throw new Error(`PNG dimensions do not match ${texture}`);
    const cell = sprite ? rig.mesh.spriteCell : name === 'base' ? rig.mesh.baseCell
      : name === 'hand' ? rig.mesh.handCell : name.startsWith('tassel') ? rig.mesh.tasselCell
        : name.endsWith('_ball') ? rig.mesh.eyeBallCell : rig.mesh.eyeCell;
    const fine = name === 'base' ? rig.mesh.fine : null;
    const alpha = Uint8Array.from({ length: image.width * image.height }, (_, i) => image.data[i * 4 + 3]);
    grids.push({ name, texture, cell, fine, mesh: plain(buildGrid(rect, cell, alpha, image.width, fine)) });
  }
}

// Exercise numerical edges independently of the installed sample's geometry/alpha.
const cases = [
  { name: 'opaque-standin', rect: [10, 20, 5, 7], cell: 2, alpha: [255], width: 1 },
  { name: 'transparent', rect: [0, 0, 5, 4], cell: 2, alpha: Array(20).fill(3), width: 5 },
  { name: 'alpha-border', rect: [2.25, -3.5, 5, 4], cell: 2, alpha: [4, ...Array(19).fill(0)], width: 5 },
  { name: 'fine-boundary', rect: [1, 2, 12, 10], cell: 4, alpha: [255], width: 1,
    fine: { x0: 4, x1: 10, y0: 3, y1: 9, cell: 2 } },
  { name: 'fractional-tail', rect: [0, 0, 4.25, 2.5], cell: 2, alpha: [255], width: 1 },
].map(input => ({ ...input, fine: input.fine ?? null,
  mesh: plain(buildGrid(input.rect, input.cell, Uint8Array.from(input.alpha), input.width, input.fine ?? null)) }));

const destination = new URL('../target/conformance/', import.meta.url);
await mkdir(destination, { recursive: true });
await writeFile(new URL('grids.json', destination), JSON.stringify({ version: 1, grids, cases }) + '\n');
console.log(`Wrote ${grids.length} layer/sprite grids and ${cases.length} edge cases to ${fileURLToPath(new URL('grids.json', destination))}`);
images['hairmask.png'] = PNG.sync.read(await readFile(new URL('built/hairmask.png', sample)));
await dumpDeformation({ rig, engine, grids, images, sprites, buildGrid, destination });
await dumpMotion({ rig, engine, destination });
const { dumpAvatar } = await import('./avatar.mjs');
await dumpAvatar({ rig, metadata, sprites, images, destination });
hooks.deregister();
