export function distribution(values) {
  if (!values.length) return { min: null, p1: null, p99: null, max: null };
  values.sort((a, b) => a - b);
  const at = p => values[Math.max(0, Math.ceil(p * values.length) - 1)];
  return { min: values[0], p1: at(0.01), p99: at(0.99), max: values[values.length - 1] };
}

export function triangleMetrics(mesh) {
  const { rest: r, pos: p, tris } = mesh;
  const area = [], anisotropy = [], stretch = [];
  let flipped = 0, degenerateRest = 0, maxDisplacement = 0;
  /** @type {Record<string, {value: number, x: number, y: number, deformed: number[], triangle?: number[], vertex?: number}>} */
  const worst = {};
  const locate = (a, b, c) => ({
    x: (r[a] + r[b] + r[c]) / 3, y: (r[a + 1] + r[b + 1] + r[c + 1]) / 3,
    deformed: [(p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3],
  });
  const update = (key, value, a, b, c, smaller = false) => {
    if (!worst[key] || (smaller ? value < worst[key].value : value > worst[key].value))
      worst[key] = { value, triangle: [a / 2, b / 2, c / 2], ...locate(a, b, c) };
  };
  for (let i = 0; i < r.length; i += 2) {
    const distance = Math.hypot(p[i] - r[i], p[i + 1] - r[i + 1]);
    if (!Number.isFinite(distance)) throw new Error('Non-finite deformed vertex');
    if (distance > maxDisplacement || !worst.displacement) {
      maxDisplacement = distance;
      worst.displacement = { value: distance, vertex: i / 2, x: r[i], y: r[i + 1], deformed: [p[i], p[i + 1]] };
    }
  }
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 2, b = tris[i + 1] * 2, c = tris[i + 2] * 2;
    const ux = r[b] - r[a], uy = r[b + 1] - r[a + 1], vx = r[c] - r[a], vy = r[c + 1] - r[a + 1];
    const det = ux * vy - uy * vx;
    if (Math.abs(det) < 1e-12) { degenerateRest++; continue; }
    const Ux = p[b] - p[a], Uy = p[b + 1] - p[a + 1], Vx = p[c] - p[a], Vy = p[c + 1] - p[a + 1];
    const ratio = (Ux * Vy - Uy * Vx) / det;
    if (ratio < 1e-6) flipped++;
    const A = (Ux * vy - Vx * uy) / det, B = (Vx * ux - Ux * vx) / det;
    const C = (Uy * vy - Vy * uy) / det, D = (Vy * ux - Uy * vx) / det;
    const aa = A * A + C * C, bb = B * B + D * D, ab = A * B + C * D;
    const s1 = Math.sqrt(Math.max(0, (aa + bb + Math.hypot(aa - bb, 2 * ab)) / 2));
    const s2 = s1 === 0 ? 0 : Math.abs(ratio) / s1;
    const aniso = s2 === 0 ? Infinity : s1 / s2, extent = Math.max(s1, s2 === 0 ? Infinity : 1 / s2);
    area.push(ratio); anisotropy.push(aniso); stretch.push(extent);
    update('areaMin', ratio, a, b, c, true); update('areaMax', ratio, a, b, c);
    update('anisotropy', aniso, a, b, c); update('stretch', extent, a, b, c);
  }
  const summary = values => { const { p99, max } = distribution(values); return { p99, max }; };
  return { vertices: r.length / 2, triangles: tris.length / 3, degenerateRest, flipped,
    areaRatio: distribution(area), anisotropy: summary(anisotropy), stretch: summary(stretch), maxDisplacement, worst };
}

// Bounded memory for millions of vertex samples; p99 uses the upper edge of 0.1% log bins.
export class JitterHistogram {
  constructor() { this.bins = new Float64Array(65536); this.count = 0; this.max = 0; }
  add(value) {
    if (!Number.isFinite(value)) throw new Error('Non-finite jitter');
    const index = value <= 1e-12 ? 0 : Math.min(65535, Math.ceil(Math.log(value / 1e-12) / Math.log(1.001)));
    this.bins[index]++; this.count++; this.max = Math.max(this.max, value);
  }
  summary() {
    if (!this.count) return { samples: 0, p99: null, max: null };
    let sum = 0, index = 0;
    for (; index < this.bins.length; index++) { sum += this.bins[index]; if (sum >= Math.ceil(this.count * 0.99)) break; }
    return { samples: this.count, p99: Math.min(this.max, index === 0 ? 1e-12 : 1e-12 * 1.001 ** index), max: this.max };
  }
}

export function reversals(values, seconds) {
  let previous = 0, count = 0;
  for (let i = 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    if (Math.abs(delta) <= 1e-8) continue;
    const sign = Math.sign(delta);
    if (previous && previous !== sign) count++;
    previous = sign;
  }
  return count / seconds;
}

// Same two-bone skinning as createMeshAvatar.tick(), kept local to avoid a runtime API change.
export function deformTassel(ch, mesh) {
  const [px, py] = ch.t.pivot, d = ch.dir, P = ch.pts;
  const c1 = Math.cos(ch.phi[0]), s1 = Math.sin(ch.phi[0]), c2 = Math.cos(ch.phi[1]), s2 = Math.sin(ch.phi[1]);
  const r = mesh.rest, o = mesh.pos;
  for (let i = 0; i < r.length; i += 2) {
    const vx = r[i] - px, vy = r[i + 1] - py, along = vx * d[0] + vy * d[1];
    const ax = P[0][0] + vx * c1 - vy * s1, ay = P[0][1] + vx * s1 + vy * c1;
    const ux = vx - d[0] * ch.L1, uy = vy - d[1] * ch.L1;
    const bx = P[1][0] + ux * c2 - uy * s2, by = P[1][1] + ux * s2 + uy * c2;
    const t = Math.min(1, Math.max(0, (along - ch.L1 * 0.55) / (ch.L1 * 0.8))), w = t * t * (3 - 2 * t);
    o[i] = ax + (bx - ax) * w; o[i + 1] = ay + (by - ay) * w;
  }
}
