/** Shared source-space grid for runtime skinning and Studio overlays. */
export function sampleLine(line, fraction) {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths.at(-1) + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const distance = Math.max(0, Math.min(1, fraction)) * lengths.at(-1);
  let i = 1; while (i < line.length - 1 && lengths[i] < distance) i++;
  const t = (distance - lengths[i - 1]) / Math.max(1e-9, lengths[i] - lengths[i - 1]);
  return line[i - 1].map((v, axis) => v + (line[i][axis] - v) * t);
}
export const lineLength = line => line.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line[i][0], p[1] - line[i][1]), 0);
function crossingFraction(seam, tier) {
  let walked = 0; const total = lineLength(seam), hits = [];
  for (let i = 1; i < seam.length; i++) {
    const a = seam[i - 1], b = seam[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    for (let j = 1; j < tier.length; j++) {
      const c = tier[j - 1], d = tier[j], ex = d[0] - c[0], ey = d[1] - c[1], det = dx * ey - dy * ex;
      if (Math.abs(det) < 1e-9) continue;
      const u = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / det;
      const v = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / det;
      if (u >= -1e-8 && u <= 1 + 1e-8 && v >= -1e-8 && v <= 1 + 1e-8) hits.push((walked + u * length) / total);
    }
    walked += length;
  }
  const unique = hits.filter((v, i) => hits.findIndex(w => Math.abs(v - w) < 1e-7) === i);
  if (unique.length !== 1) throw new RangeError('Each tier must cross every column exactly once');
  return unique[0];
}
export function clothGrid(c) {
  const custom = !!(c.seams?.length || c.tiers?.length);
  const cols = c.seams?.length || (c.columns ?? 8);
  const seams = c.seams?.length ? c.seams : Array.from({ length: cols }, (_, k) => [sampleLine(c.waist, k / (cols - 1)), sampleLine(c.hem, k / (cols - 1))]);
  if (custom && seams.some(s => lineLength(s) < 1)) throw new RangeError('Columns must have nonzero source length');
  const joints = seams.map(line => [0, ...(c.tiers?.length ? c.tiers.map(t => crossingFraction(line, t)) : [0.5]), 1]);
  for (const js of joints) if (js.some((v, i) => i > 0 && v - js[i - 1] < 0.001)) throw new RangeError('Tier intersections must be ordered from waist to hem, with nonzero links');
  // Include seam bends and exact tier joints in every column's mesh rows.
  const n = joints[0].length - 1;
  const subdivisions = custom ? Math.max(2, Math.ceil(((c.rows ?? 5) - 1) / n)) : 0;
  const rows = custom ? n * subdivisions + 1 : (c.rows ?? 5);
  const rest = new Float64Array(rows * cols * 2), fractions = [];
  for (let k = 0; k < cols; k++) {
    fractions[k] = [];
    for (let r = 0; r < rows; r++) {
      const segment = custom ? Math.min(n - 1, Math.floor(r / subdivisions)) : 0;
      const u = custom ? (r - segment * subdivisions) / subdivisions : r / (rows - 1);
      const v = custom ? joints[k][segment] + (joints[k][segment + 1] - joints[k][segment]) * u : u;
      fractions[k].push(v);
      rest.set(sampleLine(seams[k], v), (r * cols + k) * 2);
    }
  }
  if (custom) for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) {
    const a = (r * cols + k) * 2, b = a + 2, d = a + cols * 2, c = d + 2;
    const cross = (i, j, l) => (rest[j] - rest[i]) * (rest[l + 1] - rest[i + 1]) - (rest[j + 1] - rest[i + 1]) * (rest[l] - rest[i]);
    if (cross(a, b, c) <= 1e-6 || cross(a, c, d) <= 1e-6) throw new RangeError('Columns must be ordered left to right without crossing');
  }
  return { custom, cols, rows, rest, seams, joints, fractions, lengths: seams.map(lineLength), top: seams.map(s => s[0]) };
}
