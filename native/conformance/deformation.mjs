import { writeFile } from 'node:fs/promises';
import { PARAMS, createRig } from '../../packages/runtime/src/engine/rig.js';
import { createPhysics } from '../../packages/runtime/src/engine/physics.js';
import { createSpriteModule } from '../../packages/runtime/src/engine/sprites.js';

const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const poses = [
  {}, ...[-30, -15, 15, 30].map(angleX => ({ angleX })),
  ...[-15, 15].map(angleY => ({ angleY })), ...[-15, 15].map(angleZ => ({ angleZ })),
  { angleX: -20, angleY: 10, angleZ: 15, bodyAngleZ: 8 }, { bodyAngleX: 10, breath: 1 },
  { browY: 1, browAngle: 1, mouthOpen: 1 }, { handAngle: 10, armAngle: 10, fingerTap: 1 },
  { angleX: 20, angleY: -10, eyeLOpen: 0, eyeROpen: 0.5, eyeSmile: 1 },
];
const parts = ['ball', 'low', 'crease', 'lash'];
const alphaOf = image => Uint8Array.from({ length: image.width * image.height }, (_, i) => image.data[i * 4 + 3]);
const json = (directory, name, value) => writeFile(new URL(name, directory), JSON.stringify(value) + '\n');

function deformTassel(ch, mesh) {
  const [px, py] = ch.t.pivot, d = ch.dir, P = ch.pts;
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const c1 = Math.cos(ch.phi[0]), s1 = Math.sin(ch.phi[0]), c2 = Math.cos(ch.phi[1]), s2 = Math.sin(ch.phi[1]);
  const out = new Float32Array(mesh.rest.length);
  for (let i = 0; i < mesh.rest.length; i += 2) {
    const vx = mesh.rest[i] - px, vy = mesh.rest[i + 1] - py;
    const along = vx * d[0] + vy * d[1];
    const ax = P[0][0] + vx * c1 - vy * s1, ay = P[0][1] + vx * s1 + vy * c1;
    const ux = vx - d[0] * ch.L1, uy = vy - d[1] * ch.L1;
    const bx = P[1][0] + ux * c2 - uy * s2, by = P[1][1] + ux * s2 + uy * c2;
    const w = sstep(ch.L1 * 0.55, ch.L1 * 1.35, along);
    out[i] = ax + (bx - ax) * w; out[i + 1] = ay + (by - ay) * w;
  }
  return Array.from(out);
}

export async function dumpDeformation({ rig, engine, grids, images, sprites, buildGrid, destination }) {
  const fixed = { gain: 0.8, bunL: [1.5, -2], bunR: [-3, 1],
    strands: rig.strands.map((_, i) => [[0, 0], [i * 0.2, -0.5], [1, i * 0.1], [-1.3, 2]]) };
  const points = [];
  for (let y = 0; y <= rig.image.height; y += 7) for (let x = 0; x <= rig.image.width; x += 7) points.push([x, y]);
  for (const { mesh } of grids) for (let i = 0; i < mesh.rest.length; i += 2) points.push([mesh.rest[i], mesh.rest[i + 1]]);
  const hair = images['hairmask.png'];
  const weights = points.map(([x, y]) => engine.baseWeights(x, y,
    hair.data[(Math.min(hair.height - 1, Math.round(y)) * hair.width + Math.min(hair.width - 1, Math.round(x))) * 4] / 255));
  const hands = points.map(([x, y]) => engine.handWeights(x, y));
  const files = [];
  const tmp = [0, 0];
  for (const [index, pose] of poses.entries()) for (const gain of [0, fixed.gain]) {
    const P = { ...defaults, ...pose }, phys = { ...fixed, gain }, frame = engine.handFrame(P);
    const base = [], hand = [], eyes = [];
    for (const [i, [x, y]] of points.entries()) {
      base.push(...engine.deformBase(x, y, weights[i], P, phys, tmp));
      hand.push(...engine.deformHand(x, y, hands[i], P, frame, tmp));
    }
    for (const [eye, e] of rig.eyes.entries()) for (const part of parts) {
      const open = eye === 0 ? P.eyeROpen : P.eyeLOpen;
      const positions = points.flatMap(([x, y], i) => Array.from(engine.deformBase(x,
        engine.eyePartY(e, part, x, y, open, P.eyeSmile), weights[i], P, phys, tmp)));
      eyes.push({ eye, part, alpha: engine.eyePartAlpha(part, open, P.eyeSmile), positions });
    }
    const file = `pose-${index}-${gain === 0 ? 'zero' : 'fixed'}.json`;
    await json(destination, file, { parameters: P, physics: phys, base, hand, eyes });
    files.push(file);
  }
  await json(destination, 'deformation.json', { version: 1, parameters: PARAMS, points, files });

  const { Physics } = createPhysics(engine, rig);
  const traces = [];
  for (const gain of [0, 0.8, 1, 2]) {
    const physics = new Physics(); physics.gain = gain;
    const frames = [];
    for (let frame = 0; frame < 120; frame++) {
      const P = { ...defaults, angleX: Math.sin(frame / 20) * 30, angleZ: Math.cos(frame / 15) * 15 };
      const dt = frame === 0 ? 0 : frame === 60 ? 0.08 : 1 / 60;
      const out = structuredClone(physics.step(P, dt));
      const chains = physics.chains.map(ch => ({ name: ch.t.name, points: ch.pts, phi: ch.phi, anchor: ch.anchor,
        positions: deformTassel(ch, grids.find(grid => grid.name === ch.t.name).mesh) }));
      frames.push({ parameters: P, dt, out, chains });
    }
    traces.push({ gain, frames });
  }
  await json(destination, 'physics.json', { version: 1, traces });

  const spriteImages = Object.fromEntries(Object.keys(sprites.layers).map(name => [name, images[`sprites/${name}.png`]]));
  const { createSprites } = createSpriteModule(engine, rig);
  const spriteFiles = [];
  for (const gain of [0, 0.8]) {
    const items = new Map();
    const renderer = { addLayer(name, _image, mesh) { const item = { name, mesh, visible: true, alpha: 1 }; items.set(name, item); return item; } };
    const current = createSprites(renderer, sprites, spriteImages, buildGrid, alphaOf);
    const updates = [];
    const update = (parameters, dt, mood = null) => {
      const phys = { ...fixed, gain };
      const coverage = current.update(parameters, phys, dt, mood);
      updates.push({ parameters, physics: phys, dt, mood, coverage,
        items: [...items.values()].map(item => ({ name: item.name, visible: item.visible, alpha: item.alpha,
          positions: item.visible ? Array.from(item.mesh.pos) : null })) });
    };
    for (const pose of poses) for (const mouthForm of [-1, -0.3, 0, 0.5, 1]) for (const mouthOpen of [0.25, 0.8]) {
      for (const eyeOpen of [0, 0.5, 1]) update({ ...defaults, ...pose, mouthForm, mouthOpen,
        eyeLOpen: eyeOpen, eyeROpen: eyeOpen, eyeSmile: eyeOpen === 0 ? (mouthForm > 0 ? 1 : 0) : 0 }, 0.1);
    }
    for (const pose of poses) for (const mood of ['angry', 'sad', 'surprise']) {
      for (const eyeOpen of [0, 0.5, 1]) update({ ...defaults, ...pose, eyeLOpen: eyeOpen, eyeROpen: eyeOpen,
        mouthForm: 0, mouthOpen: mood === 'sad' ? 0 : 0.18 }, 0.1, mood);
    }
    // Cross-fades in both directions, paused redraws, asymmetric eyes and mouth hysteresis.
    for (const mood of [null, 'sad', 'surprise', 'angry']) for (const eyeOpen of [1, 0.5, 0, 1.25, 0.2]) {
      for (const dt of [1 / 120, 1 / 120, 0, 1 / 60]) update({ ...defaults, eyeROpen: eyeOpen,
        eyeLOpen: 1 - Math.min(1, eyeOpen), eyeSmileL: 1, mouthOpen: 0.17, mouthForm: 0.32 }, dt, mood);
    }
    for (const mouthForm of [-0.56, -0.5, -0.48, -0.19, -0.25, -0.12, 0.36, 0.3, 0.43, 0.74, 0.8, 0.83]) {
      update({ ...defaults, mouthOpen: 0.8, mouthForm }, 1 / 60);
    }
    const file = `sprites-${gain === 0 ? 'zero' : 'fixed'}.json`;
    await json(destination, file, { version: 1, updates }); spriteFiles.push(file);
  }
  await json(destination, 'sprites.json', { version: 1, files: spriteFiles });
  const variants = [];
  for (const kind of ['absent-features', 'resampled-strands']) {
    const variant = structuredClone(rig);
    if (kind === 'absent-features') {
      for (const field of ['buns', 'strands', 'accessories', 'hand']) delete variant[field];
    } else {
      variant.strands.forEach((s, i) => {
        if (i % 3 === 0) s.nodes = [s.nodes[0], s.nodes.at(-1)];
        else if (i % 3 === 1) s.nodes.splice(1, 1);
        else s.nodes.splice(1, 0, s.nodes[0].map((v, a) => (v + s.nodes[1][a]) / 2));
      });
    }
    const engine = createRig(variant), { Physics } = createPhysics(engine, variant), physics = new Physics();
    const weights = [[440, 450, 0], [600, 500, 1], [600, 350, 1], [200, 900, 0.5]].map(([x, y, hair]) =>
      ({ x, y, hair, weights: engine.baseWeights(x, y, hair) }));
    const frames = [];
    for (let frame = 0; frame < 30; frame++) {
      const parameters = { ...defaults, angleX: Math.sin(frame / 20) * 30, angleY: -12, angleZ: Math.cos(frame / 15) * 15 };
      const out = structuredClone(physics.step(parameters, 1 / 60));
      const positions = weights.map(({ x, y, weights }) => Array.from(engine.deformBase(x, y, weights, parameters, out, tmp)));
      frames.push({ parameters, dt: 1 / 60, out, positions });
    }
    variants.push({ rig: variant, weights, frames });
  }
  await json(destination, 'variants.json', { version: 1, variants });
  console.log(`Wrote ${files.length} deformation poses (${points.length} points each), ${traces.length} physics traces and sprite sequences`);
}
