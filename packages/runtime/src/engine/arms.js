const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / Math.max(1e-6, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const rotate = (p, o, a) => {
  const x = p[0] - o[0], y = p[1] - o[1], c = Math.cos(a), s = Math.sin(a);
  return [o[0] + x * c - y * s, o[1] + x * s + y * c];
};
export const ARM_DEFAULTS = Object.freeze({ swing: 4, bend: 6, inward: 0.4 });

/** Optional hanging arms, with image-left/right joints in source pixels. */
export function createArms(arms, body, _legs = null) {
  if (!arms) return null;
  const swing = clamp(finite(arms.swing, ARM_DEFAULTS.swing), 0, 10) * Math.PI / 180;
  const bend = clamp(finite(arms.bend, ARM_DEFAULTS.bend), 0, 12) * Math.PI / 180;
  const inward = clamp(finite(arms.inward, ARM_DEFAULTS.inward), 0, 1);
  const bones = [arms.left, arms.right];
  function splitX(line, y) {
    let i = 0;
    while (i < line.length - 2 && y > line[i + 1][1]) i++;
    const a = line[i], b = line[i + 1];
    const t = clamp((y - a[1]) / Math.max(1e-6, b[1] - a[1]), 0, 1);
    return a[0] + (b[0] - a[0]) * t;
  }
  function weights(x, y) {
    return bones.map((b, i) => {
      const upper = Math.max(1, b.elbow[1] - b.shoulder[1]);
      const lower = Math.max(1, b.wrist[1] - b.elbow[1]);
      const band = Math.max(1, Math.min(upper, lower, body.chest.ry) * 0.2);
      const boundary = splitX(b.split, y), outside = i ? x - boundary : boundary - x;
      // A hard boundary only in the gap. Approach it continuously inside the sleeve.
      const hard = Number(outside >= 0), soft = smooth(-band, band, outside);
      const gap = smooth(b.split[0][1] - band, b.split[0][1], y);
      const membership = soft + (hard - soft) * gap;
      return {
        arm: membership * smooth(b.shoulder[1], b.shoulder[1] + upper * 0.55, y)
          * (1 - smooth(b.split.at(-1)[1], b.split.at(-1)[1] + band, y)),
        forearm: smooth(b.elbow[1] - band, b.elbow[1] + band, y),
      };
    });
  }
  function frame(P, move = p => [...p]) {
    return bones.map((b, i) => {
      const side = i ? 'R' : 'L', sign = i ? -1 : 1;
      const value = clamp(finite(P[`armSwing${side}`]), -1, 1);
      return {
        shoulder: move(b.shoulder), elbow: move(b.elbow),
        swing: sign * swing * value * (value < 0 ? inward : 1),
        // Flex inward; negative values never hyper-extend the elbow.
        bend: -sign * bend * clamp(finite(P[`elbowBend${side}`]), 0, 1),
      };
    });
  }
  function apply(p, _x, _y, w, P, F = frame(P)) {
    const original = [...p];
    F.forEach((b, i) => {
      if (!w[i].arm || (!b.swing && !b.bend)) return;
      const upper = b.swing ? rotate(original, b.shoulder, b.swing) : original;
      const elbow = b.swing ? rotate(b.elbow, b.shoulder, b.swing) : b.elbow;
      const lower = b.bend ? rotate(upper, elbow, b.bend) : upper;
      p[0] += (upper[0] - original[0] + (lower[0] - upper[0]) * w[i].forearm) * w[i].arm;
      p[1] += (upper[1] - original[1] + (lower[1] - upper[1]) * w[i].forearm) * w[i].arm;
    });
  }
  return { weights, frame, apply };
}
