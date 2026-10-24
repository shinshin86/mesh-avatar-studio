// Garments (rig.cloth): a grid of nodes between the waist line and the hem. Each column is a
// spring chain from the waist down, and the columns are bound together so the garment swings
// as one sheet instead of splitting into strips. The garment layer is skinned to the grid.
// The waist row follows the body; the rest keeps hanging down when the body rolls.

import { CLOTH_DEFAULTS, checkClothTuning } from './cloth-tuning.js';

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
  const TUNE = { waistHz: 2.6, zeta: 0.32 };

  const garments = (rig.cloth ?? []).map(c => {
    const cols = c.columns ?? 8, rows = c.rows ?? 5;
    const top = resample(c.waist, cols), bot = resample(c.hem, cols);
    const rest = new Float64Array(rows * cols * 2);
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const v = r / (rows - 1), i = (r * cols + k) * 2;
      rest[i] = top[k][0] + (bot[k][0] - top[k][0]) * v;
      rest[i + 1] = top[k][1] + (bot[k][1] - top[k][1]) * v;
    }
    return {
      c, tuning: Object.fromEntries(Object.entries(CLOTH_DEFAULTS).map(([key, value]) => [key, c[key] ?? value])),
      cols, rows, rest, top, weights: top.map(([x, y]) => baseWeights(x, y, 0)),
      target: new Float64Array(rest.length), pos: null, vel: new Float64Array(rest.length),
      out: Float64Array.from(rest), parent: null, parentLoc: null, meshes: [],
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
      const miss = Math.max(0, -s, s - 1) + Math.max(0, -t, t - 1);
      if (!best || miss < best.miss) best = { q, s, t, miss };
    }
    best.s = Math.min(4, Math.max(-3, best.s));
    best.t = Math.min(4, Math.max(-3, best.t));
    return best;
  }
  function place(p, loc, out) {
    const { q, s, t } = loc, w = [(1 - s) * (1 - t), s * (1 - t), s * t, (1 - s) * t];
    out[0] = 0; out[1] = 0;
    for (let j = 0; j < 4; j++) { out[0] += p[q[j]] * w[j]; out[1] += p[q[j] + 1] * w[j]; }
    return out;
  }
  for (const g of garments) if (g.c.parent) {
    g.parent = byName[g.c.parent];
    g.parentLoc = g.top.map(([x, y]) => locate(g.parent, x, y));
  }

  const softLimit = (o, i, m) => {
    const l = Math.hypot(o[i], o[i + 1]);
    if (l < 1e-6) return;
    const k = m * Math.tanh(l / m) / l;
    o[i] *= k; o[i + 1] *= k;
  };

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
      const sub = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = Math.min(dt, 0.05) / sub;
      const gain = this.gain, a = [0, 0];
      for (const g of garments) {
        const { cols, rows, rest, target, vel, out } = g;
        const { stiffness: stiff, damping: damp, max, swing, follow, cohesion, wind: breeze } = g.tuning;
        // the waist row follows the body (or the parent garment); every row below is carried by
        // its column's waist point without rotating, so the garment keeps hanging down
        for (let k = 0; k < cols; k++) {
          if (g.parent) place(g.parent.out, g.parentLoc[k], a);
          else deformBase(g.top[k][0], g.top[k][1], g.weights[k], P, phys, a);
          const dx = a[0] - rest[k * 2], dy = a[1] - rest[k * 2 + 1];
          for (let r = 0; r < rows; r++) {
            const i = (r * cols + k) * 2;
            target[i] = rest[i] + dx; target[i + 1] = rest[i + 1] + dy;
          }
        }
        if (!g.pos) g.pos = Float64Array.from(target);
        const pos = g.pos;
        for (let k = 0; k < cols * 2; k++) { pos[k] = target[k]; vel[k] = 0; }
        for (let n = 0; n < sub; n++) {
          const t = this.time + n * h;
          for (let r = 1; r < rows; r++) {
            const v = rows > 2 ? (r - 1) / (rows - 2) : 1;
            const w = 2 * Math.PI * (TUNE.waistHz + (swing - TUNE.waistHz) * v);
            const kk = w * w * stiff / Math.max(0.35, gain);
            const c = 2 * TUNE.zeta * damp * Math.sqrt(kk);
            const down = r / (rows - 1);
            for (let k = 0; k < cols; k++) {
              const i = (r * cols + k) * 2, up = i - cols * 2;
              const wind = (Math.sin(t * 1.1 + k * 0.5) * 0.6 + Math.sin(t * 2.3 + k * 0.9) * 0.4) * max * breeze * down;
              const tx = target[i] + (pos[up] - target[up]) * follow + wind;
              const ty = target[i + 1] + (pos[up + 1] - target[up + 1]) * follow;
              vel[i] += (kk * (tx - pos[i]) - c * vel[i]) * h;
              vel[i + 1] += (kk * (ty - pos[i + 1]) - c * vel[i + 1]) * h;
              pos[i] += vel[i] * h; pos[i + 1] += vel[i + 1] * h;
            }
          }
        }
        // offsets from the carried rest shape, smoothed across the columns and limited
        const o = new Float64Array(pos.length);
        for (let i = 0; i < pos.length; i++) o[i] = pos[i] - target[i];
        for (let pass = 0; pass < cohesion; pass++) for (let r = 1; r < rows; r++) {
          const row = o.slice(r * cols * 2, (r + 1) * cols * 2);
          for (let k = 0; k < cols; k++) {
            const l = Math.max(0, k - 1), rr = Math.min(cols - 1, k + 1), i = (r * cols + k) * 2;
            for (const ax of [0, 1]) o[i + ax] = row[k * 2 + ax] * 0.5 + (row[l * 2 + ax] + row[rr * 2 + ax]) * 0.25;
          }
        }
        for (let r = 1; r < rows; r++) for (let k = 0; k < cols; k++)
          softLimit(o, (r * cols + k) * 2, max * r / (rows - 1) / Math.max(1, Math.abs(gain)));
        for (let i = 0; i < pos.length; i++) out[i] = target[i] + o[i] * gain;
      }
      this.time += dt;
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
