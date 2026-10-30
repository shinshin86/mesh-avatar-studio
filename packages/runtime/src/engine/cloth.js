// Each column is a coupled two-link pendulum driven by its waist acceleration.
// Link masses are proportional to their lengths; both halves have the same
// fabric density. Rendered links retain their source lengths.

import { clothGrid, sampleLine } from './cloth-grid.js';
import { pendulumSystem, stepPendulum } from './cloth-pendulum.js';
import { CLOTH_DEFAULTS, CLOTH_OPTIONAL_DEFAULTS, checkClothTuning } from './cloth-tuning.js';

/** Evenly spaced points (by arc length) along a polyline. */
function resample(line, n) {
  const lengths = [0];
  for (let i = 1; i < line.length; i++)
    lengths.push(lengths[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = lengths.at(-1);
  return Array.from({ length: n }, (_, k) => {
    const d = total * k / (n - 1);
    let i = 1;
    while (i < line.length - 1 && lengths[i] < d) i++;
    const u = (d - lengths[i - 1]) / Math.max(1e-9, lengths[i] - lengths[i - 1]);
    return [0, 1].map(a => line[i - 1][a] + (line[i][a] - line[i - 1][a]) * u);
  });
}

/** @param {ReturnType<import('./rig.js').createRig>} engine
 * @param {import('../rig/types').Rig} rig */
export function createCloth(engine, rig) {
  const { baseWeights, deformBase } = engine;
  const TUNE = { bounceHz: 2.6, zeta: 0.25 };

  // Adult hip-to-ankle length≈0.8m; if joints are unavailable, assume the
  // illustration spans a 1.6m figure. Cropped/stylized art can override mm/px.
  const metersPerPixel = rig.legs
    ? 0.8 / ((Math.hypot(...rig.legs.left.ankle.map((v, i) => v - rig.legs.left.hip[i]))
      + Math.hypot(...rig.legs.right.ankle.map((v, i) => v - rig.legs.right.hip[i]))) / 2)
    : 1.6 / rig.image.height;
  // Effective length 2L/3 for a uniform rigid strip, L for a tip-heavy point
  // mass. 0.8L approximates fabric with extra mass in a ruffled hem.
  const inertiaLength = 0.8;

  const garments = (rig.cloth ?? []).map(c => {
    const grid = clothGrid(c);
    const cols = grid.custom ? grid.cols : (c.columns ?? 8), rows = grid.custom ? grid.rows : (c.rows ?? 5);
    const top = resample(c.waist, cols), bot = resample(c.hem, cols);
    const rest = new Float64Array(rows * cols * 2);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const v = r / (rows - 1), i = (r * cols + k) * 2;
      rest[i] = top[k][0] + (bot[k][0] - top[k][0]) * v;
      rest[i + 1] = top[k][1] + (bot[k][1] - top[k][1]) * v;
    }
    if (grid.custom) rest.set(grid.rest);
    return {
      grid, pendulums: /** @type {ReturnType<typeof pendulumSystem>[]} */ ([]), systemKey: null,
      c, gravity: 9.80665 / (c.scale === undefined ? metersPerPixel : c.scale / 1000),
      tuning: Object.fromEntries(Object.entries({ ...CLOTH_DEFAULTS, ...CLOTH_OPTIONAL_DEFAULTS }).map(([key, value]) => [key, c[key] ?? value])),
      cols, rows, rest, top: grid.custom ? grid.top : top, weights: (grid.custom ? grid.top : top).map(([x, y]) => baseWeights(x, y, 0)),
      target: new Float64Array(rest.length), previous: null, pivotVelocity: new Float64Array(cols * 2),
      angle: new Float64Array(cols), angularVelocity: new Float64Array(cols),
      lowerAngle: new Float64Array(cols), lowerAngularVelocity: new Float64Array(cols),
      bounce: new Float64Array(cols), bounceVelocity: new Float64Array(cols),
      out: Float64Array.from(rest), physicalOut: Float64Array.from(rest), parent: null, parentLoc: null, meshes: [],
    };
  });
  const byName = Object.fromEntries(garments.map(g => [g.c.name, g]));

  // Grid coordinates of a point: the cell and its bilinear (s, t). Points outside the grid get
  // the nearest cell, extrapolated, so ruffles past the waist or hem line still follow it.
  function locate(g, x, y) {
    let best = null;
    for (let r = 0; r < g.rows - 1; r++) for (let k = 0; k < g.cols - 1; k++) {
      const q = [(r * g.cols + k) * 2, (r * g.cols + k + 1) * 2, ((r + 1) * g.cols + k + 1) * 2, ((r + 1) * g.cols + k) * 2];
      const [ax, ay, bx, by, cx, cy, dx, dy] = q.flatMap(i => [g.rest[i], g.rest[i + 1]]);
      let s = 0.5, t = 0.5;
      for (let it = 0; it < 10; it++) {
        const fx = ax * (1 - s) * (1 - t) + bx * s * (1 - t) + cx * s * t + dx * (1 - s) * t - x;
        const fy = ay * (1 - s) * (1 - t) + by * s * (1 - t) + cy * s * t + dy * (1 - s) * t - y;
        const sx = (bx - ax) * (1 - t) + (cx - dx) * t, sy = (by - ay) * (1 - t) + (cy - dy) * t;
        const tx = (dx - ax) * (1 - s) + (cx - bx) * s, ty = (dy - ay) * (1 - s) + (cy - by) * s;
        const det = sx * ty - sy * tx;
        if (Math.abs(det) < 1e-9) break;
        s -= (fx * ty - fy * tx) / det;
        t -= (sx * fy - sy * fx) / det;
      }
      let miss = Math.max(0, -s, s - 1) + Math.max(0, -t, t - 1);
      if (g.grid.custom) {
        const u = Math.max(0, Math.min(1, s)), v = Math.max(0, Math.min(1, t));
        const px = ax * (1 - u) * (1 - v) + bx * u * (1 - v) + cx * u * v + dx * (1 - u) * v;
        const py = ay * (1 - u) * (1 - v) + by * u * (1 - v) + cy * u * v + dy * (1 - u) * v;
        miss = Math.hypot(px - x, py - y);
      }
      if (!best || miss < best.miss) best = { q, s, t, miss };
    }
    best.s = Math.min(g.grid.custom ? 1 : 4, Math.max(g.grid.custom ? 0 : -3, best.s));
    best.t = Math.min(g.grid.custom ? 1 : 4, Math.max(g.grid.custom ? 0 : -3, best.t));
    if (g.grid.custom) {
      const point = [0, 0]; place(g.rest, best, point);
      best.offset = [x - point[0], y - point[1]];
    }
    return best;
  }
  function place(p, loc, out) {
    const { q, s, t } = loc, w = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t];
    out[0] = loc.offset?.[0] ?? 0; out[1] = loc.offset?.[1] ?? 0;
    for (let j = 0; j < 4; j++) { out[0] += p[q[j]] * w[j]; out[1] += p[q[j] + 1] * w[j]; }
    return out;
  }
  for (const g of garments) if (g.c.parent) {
    g.parent = byName[g.c.parent];
    g.parentLoc = g.top.map(([x, y]) => locate(g.parent, x, y));
  }

  class Cloth {
    constructor() {
      this.gain = 1;
      this.time = 0;
    }

    setTuning(name, tuning) {
      checkClothTuning(tuning);
      if (name !== null && !Object.hasOwn(byName, name)) throw new RangeError(`Unknown cloth: ${name}`);
      for (const g of garments) if (name === null || g.c.name === name) Object.assign(g.tuning, tuning);
    }

    /** Skin a layer mesh (rest/pos arrays in source px) to the named garment. */
    attach(name, mesh) {
      const g = byName[name];
      const locs = [];
      for (let i = 0; i < mesh.rest.length; i += 2) locs.push(locate(g, mesh.rest[i], mesh.rest[i + 1]));
      g.meshes.push({ mesh, locs });
    }

    step(P, dt, phys) {
      if (dt < 0) return;
      const elapsed = Math.min(dt, 0.05), sub = Math.max(1, Math.ceil(elapsed * 240)), h = elapsed / sub;
      const a = [0, 0];
      for (const g of garments) {
        const { cols, rows, rest, target, out, angle, angularVelocity, lowerAngle, lowerAngularVelocity, bounce, bounceVelocity } = g;
        const { stiffness, damping, max, swing, follow, cohesion, wind, responseGain, tierGain, highModeDamping } = g.tuning;
        const gain = this.gain * (responseGain ?? 1);
        const pivots = new Float64Array(cols * 2), renderPivots = new Float64Array(cols * 2), acceleration = new Float64Array(cols * 2);
        for (let k = 0; k < cols; k++) {
          if (g.parent) place(g.parent.physicalOut, g.parentLoc[k], a);
          else deformBase(g.top[k][0], g.top[k][1], g.weights[k], P, phys, a);
          pivots[k * 2] = a[0]; pivots[k * 2 + 1] = a[1];
          // Parent response exaggeration affects the visible attachment only;
          // the child solver receives the unexaggerated physical acceleration.
          if (g.parent) place(g.parent.out, g.parentLoc[k], a);
          renderPivots[k * 2] = a[0]; renderPivots[k * 2 + 1] = a[1];
          for (let axis = 0; axis < 2; axis++) {
            const i = k * 2 + axis;
            const velocity = g.previous && elapsed > 0 ? (pivots[i] - g.previous[i]) / elapsed : 0;
            acceleration[i] = elapsed > 0 ? (velocity - g.pivotVelocity[i]) / elapsed : 0;
            g.pivotVelocity[i] = velocity;
          }
          for (let r = 0; r < rows; r++) {
            const i = (r * cols + k) * 2;
            target[i] = rest[i] + a[0] - g.top[k][0];
            target[i + 1] = rest[i + 1] + a[1] - g.top[k][1];
          }
        }
        g.previous = pivots;
        const frequencyMultiplier = swing * Math.sqrt(stiffness);
        const verticalOmega = 2 * Math.PI * TUNE.bounceHz;
        if (g.grid.custom) {
          const key = `${frequencyMultiplier}:${damping}:${highModeDamping}`;
          if (g.systemKey !== key) {
            const previous = g.pendulums;
            g.pendulums = g.grid.lengths.map((length, k) => {
              const js = g.grid.joints[k];
              const state = pendulumSystem(js.slice(1).map((v, j) => (v - js[j]) * length * inertiaLength), g.gravity * frequencyMultiplier ** 2, TUNE.zeta * damping, highModeDamping);
              if (previous[k]) { state.angles = previous[k].angles; state.velocities = previous[k].velocities; }
              return state;
            });
            g.systemKey = key;
          }
          // Resolve the highest normal mode as well as the shortest geometric link.
          const highest = Math.max(...g.pendulums.flatMap(p => p.frequencies));
          const count = Math.max(sub, Math.ceil(elapsed * highest * 32)), step = elapsed / count;
          for (let n = 0; n < count; n++) {
            const t = this.time + (n + 1) * step;
            const breeze = (Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.3) * 0.4) * max * wind;
            for (let k = 0; k < cols; k++) {
              const ay = acceleration[k * 2 + 1], effectiveGravity = Math.max(g.gravity * 0.1, g.gravity - ay);
              const ax = Math.max(-8 * g.gravity, Math.min(8 * g.gravity, acceleration[k * 2])) - effectiveGravity * breeze / g.grid.lengths[k];
              stepPendulum(g.pendulums[k], step, ax, effectiveGravity / g.gravity);
              bounceVelocity[k] += (-(verticalOmega ** 2) * bounce[k] - 2 * verticalOmega * bounceVelocity[k] - ay * 0.15) * step;
              bounce[k] += bounceVelocity[k] * step;
            }
          }
          for (let pass = 0; elapsed > 0 && pass < cohesion; pass++) for (const field of ['angles', 'velocities']) {
            const previous = g.pendulums.map(p => [...p[field]]);
            g.pendulums.forEach((p, k) => { p[field] = previous[k].map((v, j) => 0.5 * v + 0.25 * (previous[Math.max(0, k - 1)][j] + previous[Math.min(cols - 1, k + 1)][j])); });
          }
          const renderCustom = (destination, anchors, renderGain, bendGain = 1) => {
            for (let k = 0; k < cols; k++) {
              const js = g.grid.joints[k], seam = g.grid.seams[k], length = g.grid.lengths[k];
              const vertical = max * 0.1 * Math.tanh(bounce[k] * renderGain / (max * 0.1));
              const limit = 2 * Math.asin(Math.min(0.95, (max - Math.abs(vertical)) / (2 * length)));
              const root = g.pendulums[k].angles[0];
              const angles = g.pendulums[k].angles.map(v => {
                const displayed = bendGain === 1 ? v : root + (v - root) * bendGain;
                return limit * Math.tanh(displayed * renderGain / limit);
              });
              const joints = [Array.from(anchors.slice(k * 2, k * 2 + 2))];
              for (let j = 0; j < angles.length; j++) {
                const a = sampleLine(seam, js[j]), b = sampleLine(seam, js[j + 1]), x = b[0] - a[0], y = b[1] - a[1], theta = angles[j];
                joints.push([joints[j][0] + x * Math.cos(theta) + y * Math.sin(theta), joints[j][1] - x * Math.sin(theta) + y * Math.cos(theta)]);
              }
              for (let r = 0; r < rows; r++) {
                const v = g.grid.fractions[k][r]; let j = 0; while (j < angles.length - 1 && v > js[j + 1] + 1e-9) j++;
                const a = sampleLine(seam, js[j]), b = sampleLine(seam, v), u = (v - js[j]) / (js[j + 1] - js[j]);
                const theta = angles[j] * (1 - 0.1 * (1 - follow) * (1 - u)), x = b[0] - a[0], y = b[1] - a[1], i = (r * cols + k) * 2;
                destination[i] = joints[j][0] + x * Math.cos(theta) + y * Math.sin(theta);
                destination[i + 1] = joints[j][1] - x * Math.sin(theta) + y * Math.cos(theta) + vertical * v;
              }
            }
          };
          renderCustom(g.physicalOut, pivots, 1); renderCustom(out, renderPivots, gain, tierGain);
          continue;
        }
        for (let n = 0; n < sub; n++) {
          const t = this.time + (n + 1) * h;
          // One coherent breeze for the whole sheet, never a travelling wave.
          const breeze = (Math.sin(t * 1.1) * 0.6 + Math.sin(t * 2.3) * 0.4) * max * wind;
          for (let k = 0; k < cols; k++) {
            const i = k * 2, bottom = ((rows - 1) * cols + k) * 2;
            const length = Math.max(1, Math.hypot(rest[bottom] - rest[i], rest[bottom + 1] - rest[i + 1]));
            // Source y points down: upward pivot acceleration adds apparent
            // gravity, so g_eff=g-a_y. A small floor guards downward teleports.
            const effectiveGravity = Math.max(g.gravity * 0.1, g.gravity - acceleration[i + 1]);
            const link = inertiaLength * length / 2;
            const omega2 = effectiveGravity / link * frequencyMultiplier * frequencyMultiplier;
            const omega = Math.sqrt(omega2), zeta = TUNE.zeta * damping;
            const low = omega * Math.sqrt(2 - Math.SQRT2), high = omega * Math.sqrt(2 + Math.SQRT2);
            // Rayleigh damping gives both small-angle normal modes the same
            // damping ratio. M=[[2,cos(delta)],[cos(delta),1]], equal half masses.
            const alpha = 2 * zeta * low * high / (low + high), beta = 2 * zeta / (low + high);
            const delta = angle[k] - lowerAngle[k], c = Math.cos(delta), s = Math.sin(delta);
            const v1 = angularVelocity[k], v2 = lowerAngularVelocity[k];
            // Only discontinuous teleports can exceed8g; keep these finite
            // without limiting accelerations in the reviewed motion range.
            const ax = Math.max(-8 * g.gravity, Math.min(8 * g.gravity, acceleration[i]));
            const force = (ax - effectiveGravity * breeze / length) / link;
            const damp1 = alpha * (2 * v1 + c * v2) + beta * 2 * omega2 * v1;
            const damp2 = alpha * (c * v1 + v2) + beta * omega2 * v2;
            const b1 = -2 * omega2 * Math.sin(angle[k]) - s * v2 * v2 - 2 * force * Math.cos(angle[k]) - damp1;
            const b2 = -omega2 * Math.sin(lowerAngle[k]) + s * v1 * v1 - force * Math.cos(lowerAngle[k]) - damp2;
            const determinant = 2 - c * c;
            angularVelocity[k] += (b1 - c * b2) / determinant * h;
            lowerAngularVelocity[k] += (2 * b2 - c * b1) / determinant * h;
            angle[k] += angularVelocity[k] * h;
            lowerAngle[k] += lowerAngularVelocity[k] * h;
            // A much smaller, heavily damped vertical response to pivot acceleration.
            bounceVelocity[k] += (-verticalOmega * verticalOmega * bounce[k] - 2 * verticalOmega * bounceVelocity[k]
              - acceleration[i + 1] * 0.15) * h;
            bounce[k] += bounceVelocity[k] * h;
          }
        }
        // Smooth the column angles and their velocities, rather than delayed rows.
        for (let pass = 0; elapsed > 0 && pass < cohesion; pass++) for (const values of [angle, angularVelocity, lowerAngle, lowerAngularVelocity]) {
          const previous = values.slice();
          for (let k = 0; k < cols; k++) values[k] = previous[k] * 0.5
            + (previous[Math.max(0, k - 1)] + previous[Math.min(cols - 1, k + 1)]) * 0.25;
        }
        const render = (destination, anchors, renderGain) => {
          for (let k = 0; k < cols; k++) {
          const top = k * 2, bottom = ((rows - 1) * cols + k) * 2;
          const length = Math.max(1, Math.hypot(rest[bottom] - rest[top], rest[bottom + 1] - rest[top + 1]));
          const vertical = max * 0.1 * Math.tanh(bounce[k] * renderGain / (max * 0.1));
          const limit = 2 * Math.asin(Math.min(0.95, (max - Math.abs(vertical)) / (2 * length)));
          const theta = limit * Math.tanh(angle[k] * renderGain / limit);
          const lower = limit * Math.tanh(lowerAngle[k] * renderGain / limit);
          // Angles are relative to the world-rest shape, not the rotating
          // waist line: the cloth counter-rotates relative to a tilted pelvis.
          // follow=1 is rigid; lower values allow up to 10% extra quadratic bend.
          const bend = 0.1 * (1 - follow);
          const halfX = (rest[bottom] - rest[top]) / 2, halfY = (rest[bottom + 1] - rest[top + 1]) / 2;
          const jointX = anchors[top] + halfX * Math.cos(theta) + halfY * Math.sin(theta);
          const jointY = anchors[top + 1] - halfX * Math.sin(theta) + halfY * Math.cos(theta);
          for (let r = 0; r < rows; r++) {
            const v = r / (rows - 1), i = (r * cols + k) * 2, first = v <= 0.5;
            const u = first ? v * 2 : (v - 0.5) * 2;
            const rotation = (first ? theta : lower) * (1 - bend + bend * u), c = Math.cos(rotation), s = Math.sin(rotation);
            const x = halfX * u, y = halfY * u;
            destination[i] = (first ? anchors[top] : jointX) + x * c + y * s;
            destination[i + 1] = (first ? anchors[top + 1] : jointY) - x * s + y * c + vertical * v;
          }
        }
        };
        render(g.physicalOut, pivots, 1);
        render(out, renderPivots, gain);
      }
      this.time += elapsed;
    }

    deform() {
      const p = [0, 0];
      for (const g of garments) for (const { mesh, locs } of g.meshes) {
        for (let v = 0; v < locs.length; v++) {
          place(g.out, locs[v], p);
          mesh.pos[v * 2] = p[0]; mesh.pos[v * 2 + 1] = p[1];
        }
      }
    }

    /** Grid nodes per garment, for debug overlays. */
    get grids() { return garments.map(g => ({ name: g.c.name, cols: g.cols, rows: g.rows, nodes: g.out })); }
  }

  return { Cloth, garments };
}
