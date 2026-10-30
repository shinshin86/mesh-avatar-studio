// Absolute-angle serial pendulum with endpoint masses proportional to link length.
// Existing two-link avatars retain their original solver in cloth.js.
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export function solve(matrix, rhs) {
  const n = rhs.length, l = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let v = matrix[i][j]; for (let k = 0; k < j; k++) v -= l[i][k] * l[j][k];
    l[i][j] = i === j ? Math.sqrt(Math.max(1e-18, v)) : v / l[j][j];
  }
  const y = [], x = [];
  for (let i = 0; i < n; i++) y[i] = (rhs[i] - dot(l[i].slice(0, i), y)) / l[i][i];
  for (let i = n - 1; i >= 0; i--) { let v = y[i]; for (let j = i + 1; j < n; j++) v -= l[j][i] * x[j]; x[i] = v / l[i][i]; }
  return x;
}
function eigenSymmetric(input) {
  const a = input.map(r => [...r]), n = a.length, u = a.map((_, i) => a.map((_, j) => +(i === j)));
  for (let it = 0; it < 100 * n * n; it++) {
    let p = 0, q = 1, largest = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.abs(a[i][j]) > largest) { largest = Math.abs(a[i][j]); p = i; q = j; }
    if (largest < 1e-12) break;
    const phi = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(phi), s = Math.sin(phi);
    const app = a[p][p], aqq = a[q][q], apq = a[p][q];
    for (let k = 0; k < n; k++) if (k !== p && k !== q) { const x = a[k][p], y = a[k][q]; a[k][p] = a[p][k] = c * x - s * y; a[k][q] = a[q][k] = s * x + c * y; }
    a[p][p] = c*c*app - 2*s*c*apq + s*s*aqq; a[q][q] = s*s*app + 2*s*c*apq + c*c*aqq; a[p][q] = a[q][p] = 0;
    for (let k = 0; k < n; k++) { const x = u[k][p], y = u[k][q]; u[k][p] = c*x-s*y; u[k][q] = s*x+c*y; }
  }
  return { values: a.map((r, i) => r[i]), vectors: u };
}
export function pendulumSystem(lengths, gravity, zeta, highModeDamping = 1) {
  const mass = lengths.map((_, i) => lengths.slice(i).reduce((s, x) => s + x, 0));
  const coefficient = lengths.map((li, i) => lengths.map((lj, j) => mass[Math.max(i, j)] * li * lj));
  const stiffness = lengths.map((li, i) => gravity * mass[i] * li);
  const rootK = stiffness.map(Math.sqrt);
  const e = eigenSymmetric(coefficient.map((r, i) => r.map((v, j) => v / rootK[i] / rootK[j])));
  // Modal generalization of Rayleigh: one alpha/beta pair cannot yield identical
  // zeta at >2 distinct frequencies. This SPD matrix gives every linear mode zeta.
  const firstMode = e.values.indexOf(Math.max(...e.values));
  const damping = lengths.map((_, i) => lengths.map((_, j) => rootK[i] * rootK[j] * e.values.reduce((s, v, k) => s + e.vectors[i][k] * e.vectors[j][k] * 2 * zeta * Math.sqrt(v) * (k === firstMode ? 1 : highModeDamping), 0)));
  return { lengths, mass, coefficient, stiffness, damping, frequencies: e.values.map(v => 1 / Math.sqrt(v) / (2 * Math.PI)).sort((a, b) => a - b), angles: lengths.map(() => 0), velocities: lengths.map(() => 0) };
}
export function pendulumEnergy(s, q = s.angles, v = s.velocities) {
  let energy = s.stiffness.reduce((sum, k, i) => sum + k * (1 - Math.cos(q[i])), 0);
  for (let i = 0; i < q.length; i++) for (let j = 0; j < q.length; j++) energy += 0.5 * s.coefficient[i][j] * Math.cos(q[i] - q[j]) * v[i] * v[j];
  return energy;
}
export function stepPendulum(s, h, ax = 0, gravityRatio = 1) {
  const q = s.angles, v = s.velocities;
  const m = s.coefficient.map((row, i) => row.map((a, j) => a * Math.cos(q[i] - q[j])));
  const rhs = q.map((angle, i) => dot(m[i], v) + h * (-s.stiffness[i] * gravityRatio * Math.sin(angle) - ax * s.mass[i] * s.lengths[i] * Math.cos(angle)
    - s.coefficient[i].reduce((sum, a, j) => sum + a * Math.sin(angle - q[j]) * v[j] * v[j], 0)));
  let nextV = solve(m.map((row, i) => row.map((a, j) => a + h * s.damping[i][j])), rhs);
  let nextQ = q.map((a, i) => a + h * nextV[i]);
  if (ax === 0 && gravityRatio === 1) {
    const old = pendulumEnergy(s), potential = pendulumEnergy(s, nextQ, nextV.map(() => 0)), next = pendulumEnergy(s, nextQ, nextV);
    // Suppress only numerical energy growth in the unforced system.
    if (next > old) {
      if (potential > old) { nextQ = [...q]; nextV = v.map(x => x * 0.999); }
      else { const scale = Math.sqrt(Math.max(0, (old - potential) / Math.max(1e-30, next - potential))); nextV = nextV.map(x => x * scale); }
    }
  }
  s.angles = nextQ; s.velocities = nextV;
}
