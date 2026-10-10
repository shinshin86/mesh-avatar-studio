import { existsSync, readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { expect, test } from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import metadata from '../samples/miko-qipao/built/layers.json';
import sheet from '../samples/miko-qipao/built/sprites/sprites.json';
import * as reference from '../reference/engine/rig.js';
import { buildGrid as rawReferenceGrid } from '../reference/engine/renderer.js';
import { createSprites as rawReferenceSprites } from '../reference/engine/sprites.js';
import { Physics as ReferencePhysics } from '../reference/engine/physics.js';
import { type Rig, parseRig, PARAMS } from 'mesh-avatar';
import { createRig } from '../packages/runtime/src/engine/rig.js';
import { createRenderer } from '../packages/runtime/src/engine/renderer.js';
import { createSpriteModule } from '../packages/runtime/src/engine/sprites.js';
import { createPhysics } from '../packages/runtime/src/engine/physics.js';

const rig = parseRig(fixture);
const engine = createRig(rig);
type GridBuilder = (rect: number[], cell: number, alpha: Uint8Array, width: number, fine?: Rig['mesh']['fine'] | null) => ReturnType<typeof rawReferenceGrid>;
// Reference JS defaults/JSDoc infer null/void too narrowly; use structural adapters without altering reference files.
const referenceGrid = rawReferenceGrid as unknown as GridBuilder;
const buildGrid = createRenderer(engine, rig).buildGrid as unknown as GridBuilder;
reference.setEyes(metadata.eyes);
const defaults: Record<string, number> = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const poses: Record<string, number>[] = [
  {},
  ...[-30, -15, 15, 30].map(angleX => ({ angleX })),
  ...[-15, 15].map(angleY => ({ angleY })),
  ...[-15, 15].map(angleZ => ({ angleZ })),
  { angleX: -20, angleY: 10, angleZ: 15, bodyAngleZ: 8 },
  { bodyAngleX: 10, breath: 1 },
  { browY: 1, browAngle: 1, mouthOpen: 1 },
  { handAngle: 10, armAngle: 10, fingerTap: 1 },
  { angleX: 20, angleY: -10, eyeLOpen: 0, eyeROpen: 0.5, eyeSmile: 1 },
];
const fixedPhysics = {
  gain: 0.8,
  bunL: [1.5, -2],
  bunR: [-3, 1],
  strands: rig.strands!.map((_, i) => [[0, 0], [i * 0.2, -0.5], [1, i * 0.1], [-1.3, 2]]),
};
const zeroPhysics = { ...fixedPhysics, gain: 0 };

function load(name: string, sprites = false) {
  return PNG.sync.read(readFileSync(new URL(`../samples/miko-qipao/built/${sprites ? 'sprites/' : ''}${name}.png`, import.meta.url)));
}
function alphaOf(image: PNG) {
  return Uint8Array.from({ length: image.width * image.height }, (_, i) => image.data[i * 4 + 3]);
}
type Mesh = ReturnType<typeof referenceGrid>;
const samplePaths = ['source.png', 'built/base.png', 'built/hairmask.png',
  ...Object.keys(metadata.layers).map(name => `built/${name}.png`),
  ...Object.keys(sheet.layers).map(name => `built/sprites/${name}.png`)];
const samplePresent = samplePaths.every(path => existsSync(new URL(`../samples/miko-qipao/${path}`, import.meta.url)));
if (!samplePresent) console.info('Matching sample images are not installed; image deformation and sprite regression checks are skipped.');
const layerMeshes: { name: string; mesh: Mesh }[] = [];
if (samplePresent) for (const [name, rect] of Object.entries({ base: [0, 0, 1254, 1254], ...metadata.layers, ...sheet.layers })) {
  const sprites = name.startsWith('mouth') || name.startsWith('eyes_');
  const image = load(name, sprites);
  const cell = name === 'base' ? 14 : name === 'hand' ? 9 : name.startsWith('tassel') ? 6 : name.endsWith('ball') || sprites ? 4 : 3;
  const fine = name === 'base' ? rig.mesh.fine : null;
  const oldMesh = referenceGrid(rect, cell, alphaOf(image), image.width, fine);
  const newMesh = buildGrid(rect, cell, alphaOf(image), image.width, fine);
  expect(newMesh.rest).toEqual(oldMesh.rest);
  expect(newMesh.tris).toEqual(oldMesh.tris);
  layerMeshes.push({ name, mesh: oldMesh });
}

test.skipIf(!samplePresent)('14 poses: every 7px and every layer vertex match base, hand and eye deformation', () => {
  const points: [number, number][] = [];
  for (let y = 0; y <= rig.image.height; y += 7)
    for (let x = 0; x <= rig.image.width; x += 7) points.push([x, y]);
  for (const { mesh } of layerMeshes)
    for (let i = 0; i < mesh.rest.length; i += 2) points.push([mesh.rest[i], mesh.rest[i + 1]]);
  const hair = load('hairmask');
  const hairAt = (x: number, y: number) => {
    const i = Math.min(1253, Math.round(y)) * 1254 + Math.min(1253, Math.round(x));
    return hair.data[i * 4] / 255;
  };
  let maximum = 0;
  const a = [0, 0], b = [0, 0];
  const compare = () => {
    const delta = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
    if (!Number.isFinite(delta)) throw new Error('Non-finite regression output');
    maximum = Math.max(maximum, delta);
  };
  const weights = points.map(([x, y]) => ({
    old: reference.baseWeights(x, y, hairAt(x, y)),
    new: engine.baseWeights(x, y, hairAt(x, y)),
    oldHand: reference.handWeights(x, y),
    newHand: engine.handWeights(x, y),
  }));
  poses.forEach((pose, poseIndex) => {
    const P: Record<string, number> = { ...defaults, ...pose };
    const phys = poseIndex === poses.length - 1 ? fixedPhysics : zeroPhysics;
    const oldFrame = reference.handFrame(P), newFrame = engine.handFrame(P);
    points.forEach(([x, y], i) => {
      reference.deformBase(x, y, weights[i].old, P, phys, a);
      engine.deformBase(x, y, weights[i].new, P, phys, b);
      compare();
      reference.deformHand(x, y, weights[i].oldHand, P, oldFrame, a);
      engine.deformHand(x, y, weights[i].newHand, P, newFrame, b);
      compare();
    });
    // Apply every lid mode on the full 7px grid and all fixture vertices as well.
    rig.eyes.forEach((eye, eyeIndex) => {
      const open = eyeIndex === 0 ? P.eyeROpen : P.eyeLOpen;
      for (const part of ['ball', 'low', 'crease', 'lash']) {
        points.forEach(([x, y], i) => {
          reference.deformBase(x, reference.eyePartY(metadata.eyes[eyeIndex], part, x, y, open, P.eyeSmile), weights[i].old, P, phys, a);
          engine.deformBase(x, engine.eyePartY(eye, part, x, y, open, P.eyeSmile), weights[i].new, P, phys, b);
          compare();
        });
      }
    });
  });
  console.log(`Regression: ${poses.length} poses, ${points.length} sample points, max delta ${maximum} px`);
  expect(maximum).toBeLessThan(0.01);
}, 120000);

test.skipIf(!samplePresent)('all drawn eye and mouth sprite meshes match reference placement', () => {
  const images = Object.fromEntries(Object.keys(sheet.layers).map(name => [name, load(name, true)]));
  function capture() {
    const items = new Map<string, { mesh: Mesh; visible: boolean; alpha: number }>();
    return {
      items,
      addLayer(name: string, _image: PNG, mesh: Mesh) {
        const item = { mesh, visible: true, alpha: 1 };
        items.set(name, item);
        return item;
      },
    };
  }
  type SpriteCreator = (renderer: ReturnType<typeof capture>, metadata: typeof sheet,
    images: Record<string, PNG>, grid: GridBuilder, alpha: typeof alphaOf) => {
      update(P: Record<string, number>, physics: typeof fixedPhysics, dt: number): unknown;
    };
  const makeSprites = createSpriteModule(engine, rig).createSprites as unknown as SpriteCreator;
  const oldRenderer = capture(), newRenderer = capture();
  const makeReferenceSprites = rawReferenceSprites as unknown as typeof makeSprites;
  const oldSprites = makeReferenceSprites(oldRenderer, sheet, images, referenceGrid, alphaOf);
  const newSprites = makeSprites(newRenderer, sheet, images, buildGrid, alphaOf);
  let maximum = 0;
  const seen = new Set<string>();
  for (const pose of poses) for (const form of [-1, -0.3, 0, 0.5, 1]) for (const open of [0.25, 0.8]) {
    const P: Record<string, number> = { ...defaults, ...pose, mouthForm: form, mouthOpen: open };
    for (const eyeOpen of [0, 0.5, 1]) {
      P.eyeLOpen = eyeOpen;
      P.eyeROpen = eyeOpen;
      P.eyeSmile = eyeOpen === 0 ? (form > 0 ? 1 : 0) : 0;
      oldSprites.update(P, fixedPhysics, 0.1);
      newSprites.update(P, fixedPhysics, 0.1);
      for (const [name, old] of oldRenderer.items) {
        const current = newRenderer.items.get(name)!;
        expect(current.visible).toBe(old.visible);
        if (!old.visible) continue;
        seen.add(name);
        for (let i = 0; i < old.mesh.pos.length; i++) maximum = Math.max(maximum, Math.abs(old.mesh.pos[i] - current.mesh.pos[i]));
      }
    }
  }
  expect(seen.size).toBe(Object.keys(sheet.layers).length);
  console.log(`Sprite regression: ${seen.size} layers, max delta ${maximum} px`);
  expect(maximum).toBeLessThan(0.01);
}, 120000);

test('physics offsets and tassel joint positions preserve the reference behavior', () => {
  const old = new ReferencePhysics();
  const { Physics } = createPhysics(engine, rig);
  const current = new Physics();
  let maximum = 0;
  for (let frame = 0; frame < 120; frame++) {
    const P = { ...defaults, angleX: Math.sin(frame / 20) * 30, angleZ: Math.cos(frame / 15) * 15 };
    const a = old.step(P, 1 / 60) as unknown as typeof fixedPhysics;
    const b = current.step(P, 1 / 60) as unknown as typeof fixedPhysics;
    const flatten = (value: unknown): number[] => {
      if (typeof value === 'number') return [value];
      if (Array.isArray(value)) return value.flatMap(flatten);
      return [];
    };
    for (const [first, second] of [[a.strands, b.strands], [a.bunL, b.bunL], [a.bunR, b.bunR],
      [old.chains.map(c => c.pts), current.chains.map(c => c.pts)]]) {
      const x = flatten(first), y = flatten(second);
      expect(x.length).toBe(y.length);
      x.forEach((v, i) => { maximum = Math.max(maximum, Math.abs(v - y[i])); });
    }
  }
  console.log(`Physics regression: 120 frames, max delta ${maximum} px`);
  expect(maximum).toBeLessThan(0.01);
});
