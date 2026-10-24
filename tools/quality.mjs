import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { resolve, relative, dirname, basename, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { validateRig } from '../packages/runtime/src/rig/validate.ts';
import { createRig, PARAMS } from '../packages/runtime/src/engine/rig.js';
import { createPhysics } from '../packages/runtime/src/engine/physics.js';
import { createSpriteModule } from '../packages/runtime/src/engine/sprites.js';
import { SCENARIOS, createScenario, seededRandom } from './motion-scenarios.mjs';
import { triangleMetrics, distribution, JitterHistogram, reversals, deformTassel } from './quality-metrics.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The browser sources use bundler-style TS imports. Resolve only those imports locally.
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith(pathToFileURL(resolve(root, 'packages/runtime/src') + sep).href) && !extname(specifier)) {
    for (const extension of ['.ts', '.js']) {
      const url = new URL(specifier + extension, context.parentURL);
      if (existsSync(url)) return next(url.href, context);
    }
  }
  return next(specifier, context);
} });
const { createRenderer } = await import('../packages/runtime/src/engine/renderer.js');
hook.deregister();

const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const poses = [
  ['rest', {}], ['eyes-half', { eyeLOpen: 0.5, eyeROpen: 0.5 }],
  ['eyes-closed', { eyeLOpen: 0, eyeROpen: 0 }], ['mouth-open', { mouthOpen: 1 }],
  ['turn-left', { angleX: -30 }], ['turn-right', { angleX: 30 }],
  ['look-up', { angleY: 15 }], ['look-down', { angleY: -15 }],
  ['tilt-left', { angleZ: -15 }], ['tilt-right', { angleZ: 15 }],
  ['body-left', { bodyAngleZ: -8 }], ['body-right', { bodyAngleZ: 8 }],
  ['angry', {}, 'angry'], ['sad', {}, 'sad'], ['surprise', {}, 'surprise'],
  ['smiling-eyes', { eyeLOpen: 0, eyeROpen: 0, eyeSmile: 1 }],
  ['mouth-half', { mouthOpen: 0.5 }], ['mouth-i', { mouthOpen: 0.55, mouthForm: -1 }],
  ['mouth-o', { mouthOpen: 0.75, mouthForm: 0.5 }], ['mouth-u', { mouthOpen: 0.75, mouthForm: 1 }],
];
for (const angleX of [-30, 30]) for (const angleY of [-15, 15])
  for (const angleZ of [-15, 15]) for (const bodyAngleZ of [-10, 10])
    poses.push([`extreme-${angleX}-${angleY}-${angleZ}-${bodyAngleZ}`,
      { angleX, angleY, angleZ, bodyAngleZ, mouthOpen: 1, eyeLOpen: 0, eyeROpen: 0 }]);

function inside(parent, path) { const rel = relative(parent, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep); }
async function canonical(path) {
  try { return await realpath(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return resolve(await canonical(dirname(path)), basename(path)); }
}
async function projectFile(project, name, optional = false) {
  try {
    const path = await realpath(resolve(project, name));
    if (!inside(project, path)) throw new Error(`Asset escapes project: ${name}`);
    return await readFile(path);
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
}
const alphaOf = image => Uint8Array.from({ length: image.width * image.height }, (_, i) => image.data[i * 4 + 3]);
const weightsFor = (mesh, fn) => Array.from({ length: mesh.rest.length / 2 }, (_, i) => fn(mesh.rest[i * 2], mesh.rest[i * 2 + 1]));

async function loadMeshes(project, rig, engine, notices) {
  const { buildGrid } = createRenderer(engine, rig);
  const grid = buildGrid([0, 0, rig.image.width, rig.image.height], 7, new Uint8Array([255]), 1);
  const maskData = await projectFile(project, 'built/hairmask.png', true);
  const mask = maskData && PNG.sync.read(maskData);
  if (mask && (mask.width !== rig.image.width || mask.height !== rig.image.height)) throw new Error('Hair mask dimensions do not match rig');
  const hairAt = mask ? (x, y) => mask.data[(Math.min(mask.height - 1, Math.max(0, Math.round(y))) * mask.width
    + Math.min(mask.width - 1, Math.max(0, Math.round(x)))) * 4] / 255 : () => 1;
  if (!mask) notices.push('No hair mask: whole-image grid uses geometric strand influence (hair=1).');
  const items = [{ name: 'grid-7px', kind: 'base', mesh: grid, weights: weightsFor(grid, (x, y) => engine.baseWeights(x, y, hairAt(x, y))) }];
  const metadata = await projectFile(project, 'built/layers.json', true);
  if (!metadata) { notices.push('No built/layers.json: layer meshes skipped.'); return { items, grid, hairMask: !!mask, sprites: null }; }
  const meta = JSON.parse(metadata);
  const sheetData = await projectFile(project, 'built/sprites/sprites.json', true);
  const sheet = sheetData && JSON.parse(sheetData), spriteImages = {}, spriteRects = {};
  const cells = rig.mesh;
  for (const [name, rect] of Object.entries({ base: [0, 0, rig.image.width, rig.image.height], ...meta.layers })) {
    const eye = /^eye([01])_(ball|low|crease|lash)$/.exec(name);
    const tassel = engine.TASSELS.findIndex(t => t.name === name);
    const kind = name === 'base' ? 'base' : name === 'hand' && rig.hand ? 'hand' : eye ? 'eye' : tassel >= 0 ? 'tassel' : null;
    if (!kind) { notices.push(`Unrecognised runtime layer skipped: ${name}`); continue; }
    const data = await projectFile(project, `built/${name}.png`, true);
    if (!data) { notices.push(`Missing built image: ${name}; mesh skipped.`); continue; }
    const image = PNG.sync.read(data);
    if (image.width !== rect[2] || image.height !== rect[3]) throw new Error(`Layer size mismatch: ${name}`);
    if (kind === 'base' && !mask) { notices.push('Base layer skipped: runtime hair mask is absent.'); continue; }
    const cell = kind === 'base' ? cells.baseCell : kind === 'hand' ? cells.handCell : kind === 'tassel' ? cells.tasselCell : eye[2] === 'ball' ? cells.eyeBallCell : cells.eyeCell;
    const mesh = buildGrid(rect, cell, alphaOf(image), image.width, kind === 'base' ? cells.fine : null);
    const weights = weightsFor(mesh, (x, y) => kind === 'hand' ? engine.handWeights(x, y) : engine.baseWeights(x, y, kind === 'base' ? hairAt(x, y) : 0));
    items.push({ name, kind, mesh, weights, eye: eye && Number(eye[1]), part: eye?.[2], tassel });
  }
  if (sheet) for (const [name, rect] of Object.entries(sheet.layers)) {
    const data = await projectFile(project, `built/sprites/${name}.png`, true);
    if (!data) { notices.push(`Missing sprite image: ${name}; mesh skipped.`); continue; }
    const image = PNG.sync.read(data);
    if (image.width !== rect[2] || image.height !== rect[3]) throw new Error(`Sprite size mismatch: ${name}`);
    spriteImages[name] = image; spriteRects[name] = rect;
  }
  const completeSprites = sheet && Object.keys(spriteRects).length > 0 && Object.keys(spriteRects).length === Object.keys(sheet.layers).length;
  const sprites = completeSprites ? createSpriteModule(engine, rig).createSprites({
    addLayer(name, _image, mesh) { const item = { name, mesh, kind: 'sprite', visible: false, alpha: 1 }; items.push(item); return item; },
  }, { ...sheet, layers: spriteRects }, spriteImages, buildGrid, alphaOf) : null;
  if (!sprites) notices.push('Built sprites absent or incomplete: sprite meshes skipped and layered eyelids deformed directly.');
  return { items, grid, hairMask: !!mask, sprites };
}

function deform(item, engine, P, offsets, chains, hasSprites) {
  if (item.kind === 'sprite') return;
  if (item.kind === 'tassel') { deformTassel(chains[item.tassel], item.mesh); return; }
  const frame = item.kind === 'hand' ? engine.handFrame(P) : null, tmp = [0, 0];
  const { rest, pos } = item.mesh;
  for (let i = 0; i < item.weights.length; i++) {
    const x = rest[i * 2]; let y = rest[i * 2 + 1];
    if (item.kind === 'hand') engine.deformHand(x, y, item.weights[i], P, frame, tmp);
    else {
      if (item.kind === 'eye') y = engine.eyePartY(engine.EYES[item.eye], item.part, x, y,
        hasSprites ? 1 : item.eye === 0 ? P.eyeROpen : P.eyeLOpen, item.eye === 0 ? P.eyeSmile : (P.eyeSmileL ?? P.eyeSmile));
      engine.deformBase(x, y, item.weights[i], P, offsets, tmp);
    }
    pos[i * 2] = tmp[0]; pos[i * 2 + 1] = tmp[1];
  }
}

function staticReport(rig, engine, loaded) {
  const fixed = { gain: 0.8, bunL: [1.5, -2], bunR: [-3, 1],
    strands: (rig.strands ?? []).map((_, i) => [[0, 0], [i * 0.2, -0.5], [1, i * 0.1], [-1.3, 2]]) };
  const { Physics } = createPhysics(engine, rig), result = [];
  for (const [name, values, mood] of poses) for (const variant of ['zero', 'fixed']) {
    const parameters = { ...defaults, ...values }, offsets = { ...fixed, gain: variant === 'zero' ? 0 : fixed.gain };
    const physics = new Physics(); physics.step(parameters, 0);
    for (const [i, ch] of physics.chains.entries()) {
      ch.phi = variant === 'zero' ? [0, 0] : [0.18 * (i % 2 ? -1 : 1), -0.3 * (i % 2 ? -1 : 1)];
      const A = engine.tasselAnchor(ch.t, parameters, offsets, [0, 0]);
      const point = (p, length, angle) => [p[0] + (ch.dir[0] * Math.cos(angle) - ch.dir[1] * Math.sin(angle)) * length,
        p[1] + (ch.dir[0] * Math.sin(angle) + ch.dir[1] * Math.cos(angle)) * length];
      const B = point(A, ch.L1, ch.phi[0]); ch.pts = [A, B, point(B, ch.L2, ch.phi[1])];
    }
    const cover = loaded.sprites?.update(parameters, offsets, 0, mood ?? null);
    const meshes = loaded.items.map(item => {
      deform(item, engine, parameters, offsets, physics.chains, !!loaded.sprites);
      const visible = item.kind === 'sprite' ? item.visible : item.kind === 'eye'
        ? !cover?.eyes[item.eye] && engine.eyePartAlpha(item.part, loaded.sprites ? 1 : item.eye === 0 ? parameters.eyeROpen : parameters.eyeLOpen,
          item.eye === 0 ? parameters.eyeSmile : (parameters.eyeSmileL ?? parameters.eyeSmile)) > 0 : true;
      // Inactive sprites are not placed by the runtime; do not measure stale positions.
      return { name: item.name, visible, ...(item.kind === 'sprite' && !visible ? { skipped: 'inactive sprite' } : triangleMetrics(item.mesh)) };
    });
    result.push({ pose: name, physics: variant, parameters, mood: mood ?? null, meshes });
  }
  return result;
}

function temporalReport(name, rig, engine, gridItem, seconds, seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const scenario = createScenario(name, rig, engine, seconds), duration = scenario.frames / 60;
    const tracks = {}, tassels = scenario.physics.chains.map(() => [[], []]);
    const histograms = () => Object.fromEntries(['head', 'hair', 'body'].map(key => [key, new JitterHistogram()]));
    const jitter = histograms(), jitterExcludingEvents = histograms(), radiusFrames = 3;
    const excluded = new Uint8Array(scenario.frames);
    for (const event of scenario.schedule) for (let frame = Math.max(0, event.frame - radiusFrames); frame <= Math.min(scenario.frames - 1, event.frame + radiusFrames); frame++) excluded[frame] = 1;
    let excludedFrames = 0;
    const regions = gridItem.weights.map(w => w.strands.some(s => s[1] >= 0.02) ? 'hair' : w.head >= 0.5 ? 'head' : 'body');
    let previous = null, previous2 = null, separation = 0, separationRatio = 0, offsetRatio = 0, maxOffset = 0;
    const fringe = (rig.strands ?? []).map((s, i) => ({ ...s, i })).filter(s => s.name.startsWith('bang'));
    for (let frame = 0; frame < scenario.frames; frame++) {
      const { parameters: P, offsets } = scenario.step(frame);
      for (const [key, value] of Object.entries(P)) (tracks[key] ??= []).push(value);
      deform(gridItem, engine, P, offsets, [], false);
      const current = gridItem.mesh.pos;
      if (previous2) {
        const skip = excluded[frame - 1]; // Second difference is centred on the preceding frame.
        if (skip) excludedFrames++;
        for (let i = 0; i < regions.length; i++) {
          const value = Math.hypot(current[i * 2] - 2 * previous[i * 2] + previous2[i * 2],
            current[i * 2 + 1] - 2 * previous[i * 2 + 1] + previous2[i * 2 + 1]);
          jitter[regions[i]].add(value);
          if (!skip) jitterExcludingEvents[regions[i]].add(value);
        }
      }
      const reuse = previous2 ?? new Float32Array(current.length);
      previous2 = previous; reuse.set(current); previous = reuse;
      const tips = (rig.strands ?? []).map((strand, i) => {
        const tip = strand.nodes[strand.nodes.length - 1], offset = offsets.strands[i][3];
        const length = Math.hypot(...offset); maxOffset = Math.max(maxOffset, length);
        offsetRatio = Math.max(offsetRatio, length / strand.max);
        const point = [tip[0] + offset[0], tip[1] + offset[1]];
        engine.applyHead(point, 1, P); engine.applyBody(point, tip[1], P);
        return point;
      });
      for (let i = 1; i < fringe.length; i++) {
        const a = fringe[i - 1], b = fringe[i], ar = a.nodes[a.nodes.length - 1], br = b.nodes[b.nodes.length - 1];
        const rest = Math.hypot(ar[0] - br[0], ar[1] - br[1]);
        const distance = Math.hypot(tips[a.i][0] - tips[b.i][0], tips[a.i][1] - tips[b.i][1]);
        separation = Math.max(separation, distance - rest);
        if (rest > 0) separationRatio = Math.max(separationRatio, distance / rest);
      }
      scenario.physics.chains.forEach((ch, i) => ch.phi.forEach((angle, j) => tassels[i][j].push(angle)));
    }
    const parameters = Object.fromEntries(Object.entries(tracks).map(([key, values]) => {
      const differences = values.slice(2).map((v, i) => Math.abs(v - 2 * values[i + 1] + values[i]));
      const { p99, max } = distribution(differences);
      return [key, { p99, max, reversalsPerSecond: reversals(values, duration) }];
    }));
    return { scenario: name, frames: scenario.frames, seconds: duration,
      schedule: scenario.schedule.map((event, i, events) => ({ ...event,
        ...(event.id ? { cut: i + 1 < events.length && events[i + 1].frame - event.frame < Math.ceil(event.duration * 60),
          truncated: (events[i + 1]?.frame ?? scenario.frames) - event.frame < Math.ceil(event.duration * 60) } : {}) })),
      parameters, vertexJitter: Object.fromEntries(Object.entries(jitter).map(([key, histogram]) => [key, histogram.summary()])),
      vertexJitterExcludingEvents: Object.fromEntries(Object.entries(jitterExcludingEvents).map(([key, histogram]) => [key, histogram.summary()])),
      eventExclusion: { radiusFrames, excludedFrames, retainedFrames: scenario.frames - 2 - excludedFrames },
      hair: { maxNeighbourTipSeparationIncrease: separation, maxNeighbourTipDistanceRatio: fringe.length > 1 ? separationRatio : null,
        maxTipOffset: maxOffset, maxTipOffsetRatio: (rig.strands ?? []).length ? offsetRatio : null },
      tassels: tassels.map((joints, i) => ({ name: engine.TASSELS[i].name, joints: joints.map(values => {
        const min = values.reduce((a, b) => Math.min(a, b), Infinity), max = values.reduce((a, b) => Math.max(a, b), -Infinity);
        return { min, max, range: max - min, reversalsPerSecond: reversals(values, duration) };
      }) })),
    };
  } finally { Math.random = originalRandom; }
}

async function main() {
  const args = process.argv.slice(2), usage = 'Usage: npm run quality -- <project> [--out <dir>] [--seconds N] [--seed N]';
  if (args.includes('--help')) { console.log(usage); return; }
  if (!args.length || args[0].startsWith('--')) throw new Error(usage);
  const project = await realpath(resolve(args.shift()));
  if (!inside(root, project)) throw new Error('Project must stay inside the repository');
  let seconds = 30, seed = 1, output = resolve(root, 'work/quality', basename(project));
  const seen = new Set();
  while (args.length) {
    const flag = args.shift(), value = args.shift();
    if (!['--out', '--seconds', '--seed'].includes(flag) || value === undefined || seen.has(flag)) throw new Error(usage);
    seen.add(flag);
    if (flag === '--out') output = resolve(value);
    if (flag === '--seconds') seconds = Number(value);
    if (flag === '--seed') seed = Number(value);
  }
  if (!Number.isFinite(seconds) || seconds < 0.05 || seconds > 3600) throw new Error('Seconds must be between 0.05 and 3600');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be a uint32');
  output = await canonical(output);
  const protectedPaths = [resolve(root, 'samples'), resolve(root, 'reference'), resolve(root, 'projects'), resolve(project, 'built'), project];
  // Output is scratch data, never mixed into any source project or runtime assets.
  if (!inside(root, output) || protectedPaths.some(path => inside(path, output)) || inside(output, project))
    throw new Error('Output must stay inside the repository, outside source projects, samples and reference');
  for (const name of ['report.json']) {
    if (!inside(output, await canonical(resolve(output, name)))) throw new Error('Report symlink escapes output folder');
  }
  const rig = JSON.parse(await projectFile(project, 'rig.json')), errors = validateRig(rig);
  if (errors.length) throw new Error(errors.join('\n'));
  const engine = createRig(rig), notices = [], loaded = await loadMeshes(project, rig, engine, notices);
  const report = { version: 1, project: relative(root, project).split(sep).join('/'), seed, fps: 60, seconds,
    gridCell: 7, hairMask: loaded.hairMask, jitterQuantileRelativeError: 0.001, notices,
    static: staticReport(rig, engine, loaded),
    temporal: SCENARIOS.map(name => temporalReport(name, rig, engine, loaded.items[0], seconds, seed)) };
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? String(value) : value, 2) + '\n');
  notices.forEach(notice => console.log(notice));
  const meshes = report.static.flatMap(pose => pose.meshes.filter(mesh => mesh.triangles));
  console.log(`Static: ${report.static.length} pose/physics combinations, ${loaded.items.length} meshes`);
  console.table(['grid', 'layers'].map(group => {
    const selection = meshes.filter(mesh => (mesh.name === 'grid-7px') === (group === 'grid'));
    return { meshes: group, flipped: selection.reduce((sum, mesh) => sum + mesh.flipped, 0),
      areaMin: Math.min(...selection.map(mesh => mesh.areaRatio.min)).toFixed(4),
      areaMax: Math.max(...selection.map(mesh => mesh.areaRatio.max)).toFixed(4),
      anisotropyMax: Math.max(...selection.map(mesh => mesh.anisotropy.max)).toFixed(4),
      stretchMax: Math.max(...selection.map(mesh => mesh.stretch.max)).toFixed(4),
      displacementMax: Math.max(...selection.map(mesh => mesh.maxDisplacement)).toFixed(3) };
  }).filter(row => row.areaMin !== 'Infinity'));
  console.table(report.temporal.map(item => ({ scenario: item.scenario,
    jerkMax: Math.max(...Object.values(item.parameters).map(p => p.max)).toFixed(5),
    jitterMax: Math.max(...Object.values(item.vertexJitter).map(p => p.max ?? 0)).toFixed(5),
    jitterAwayFromEvents: Math.max(...Object.values(item.vertexJitterExcludingEvents).map(p => p.max ?? 0)).toFixed(5),
    hairSeparationPx: item.hair.maxNeighbourTipSeparationIncrease.toFixed(3),
    tipOffsetRatio: (item.hair.maxTipOffsetRatio ?? 0).toFixed(3),
    tasselReversalsPerSec: Math.max(0, ...item.tassels.flatMap(t => t.joints.map(j => j.reversalsPerSecond))).toFixed(3),
  })));
  console.log(`Report: ${relative(root, resolve(output, 'report.json'))}`);
}

main().catch(error => { console.error(`quality: ${error.message}`); process.exitCode = 1; });
