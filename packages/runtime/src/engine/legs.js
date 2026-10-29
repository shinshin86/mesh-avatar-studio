const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rotate = (p, o, a) => {
  const x = p[0] - o[0], y = p[1] - o[1], c = Math.cos(a), s = Math.sin(a);
  return [o[0] + x * c - y * s, o[1] + x * s + y * c];
};
// Affine projection of a 3D bone: permit lengthwise foreshortening, retaining
// the illustration's width perpendicular to the projected bone.
function boneMatrix(a, b, targetA, targetB) {
  const length = distance(a, b), targetLength = distance(targetA, targetB);
  const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length;
  const vx = (targetB[0] - targetA[0]) / targetLength, vy = (targetB[1] - targetA[1]) / targetLength;
  const scale = targetLength / length;
  const m = [vx * scale * ux + vy * uy, vx * scale * uy - vy * ux,
    vy * scale * ux - vx * uy, vy * scale * uy + vx * ux];
  return [...m, targetA[0] - m[0] * a[0] - m[1] * a[1], targetA[1] - m[2] * a[0] - m[3] * a[1]];
}
const transform = (p, m) => [m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5]];

/** Optional planted, two-bone legs. All coordinates are in source pixels. */
export const LEG_DEFAULTS = Object.freeze({ spine: 0.7, bob: 2 });

/** @param {{pivotX:number, pivotY:number, weightBand:number[]}|null} [head] */
export function createLegs(legs, body, head = null) {
  if (!legs) return null;
  const bones = [legs.left, legs.right].map((leg, i) => {
    const projectedU = distance(leg.hip, leg.knee), projectedV = distance(leg.knee, leg.ankle);
    // A small forward rest flex avoids a singular straight knee. The source
    // drawing's complete projected rest shape, including its inward offset, stays.
    const depth = Math.min(projectedU, projectedV) * 0.05;
    const u = Math.hypot(projectedU, depth), v = Math.hypot(projectedV, depth);
    const dx = leg.ankle[0] - leg.hip[0], dy = leg.ankle[1] - leg.hip[1];
    const cross = dx * (leg.knee[1] - leg.hip[1]) - dy * (leg.knee[0] - leg.hip[0]);
    return { ...leg, u, v, depth, lateral: cross / Math.hypot(dx, dy), side: Math.sign(cross) || (i ? 1 : -1) };
  });
  const drive = [0, 0, 0], velocity = [0, 0, 0];
  let bob = 0, bobVelocity = 0, lastWeight = 0, version = 0, previousVersion;
  function step(P, dt) {
    const ws = clamp(P.weightShift ?? 0, -1, 1);
    const time = Math.min(Math.max(dt, 0), 0.05);
    if (!time) {
      drive.fill(ws); velocity.fill(0); bob = 0; bobVelocity = 0;
    } else {
      const targetBob = (legs.bob ?? LEG_DEFAULTS.bob) * Math.min(1, Math.abs(ws - lastWeight) / time / 1.5);
      const count = Math.ceil(time * 240), h = time / count;
      for (let n = 0; n < count; n++) {
        // Three serial, critically-near-damped stages: chest delay about0.15s,
        // then head stabilization about0.075s later. No random driving forces.
        for (let i = 0; i < 3; i++) {
          const target = i ? drive[i - 1] : ws;
          velocity[i] += (24 * 24 * (target - drive[i]) - 2 * 0.9 * 24 * velocity[i]) * h;
          drive[i] += velocity[i] * h;
        }
        bobVelocity += (24 * 24 * (targetBob - bob) - 2 * 0.9 * 24 * bobVelocity) * h;
        bob += bobVelocity * h;
      }
    }
    lastWeight = ws; version++;
  }
  const ankleY = Math.min(...bones.map(b => b.ankle[1]));
  let previousShift, previousBody, cached;
  function frame(P) {
    const ws = clamp(P.weightShift ?? 0, -1, 1), bx = clamp(P.bodyAngleX ?? 0, -10, 10);
    if (ws === previousShift && bx === previousBody && version === previousVersion) return cached;
    previousShift = ws; previousBody = bx; previousVersion = version;
    const angle = -legs.tilt * ws, shift = legs.shift * ws + bx / 10 * (body.hip?.shift ?? legs.shift);
    const pelvisPoint = p => { const q = rotate(p, legs.pelvis, angle); q[0] += shift; return q; };
    const hips = bones.map(b => pelvisPoint(b.hip));
    // Only the free leg gets an extra inward offset. Quadratic onset keeps the
    // neutral derivative continuous; most flexion goes towards the camera (z).
    const lateral = bones.map((b, i) => b.lateral + b.side * legs.bend * Math.max(0, i ? -ws : ws) ** 2);
    // A smooth positive part starts correcting before full extension. Its width goes
    // to zero quadratically at neutral, so the rest pose is exactly unchanged.
    const strength = ws * ws + (bx / 10) ** 2;
    const width = legs.bend ** 2 / Math.min(...bones.map(b => b.u + b.v)) * strength;
    const positive = x => (x + Math.hypot(x, width)) / 2;
    let drop = bob + legs.bend ** 2 / Math.min(...bones.map(b => b.u + b.v)) * ws * ws;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i], h = hips[i], dx = h[0] - b.ankle[0];
      // Reserve the chosen image-plane offset; remaining flexion is in depth.
      const reach = Math.sqrt(Math.max(0, b.u * b.u - lateral[i] ** 2)) + Math.sqrt(Math.max(0, b.v * b.v - lateral[i] ** 2));
      const required = b.ankle[1] - Math.sqrt(Math.max(0, reach * reach - dx * dx)) - h[1];
      drop += positive(required - drop);
    }
    const solved = bones.map((b, i) => {
      const hip = [hips[i][0], hips[i][1] + drop], ankle = b.ankle;
      if (!ws && !bx && !bob) return { hip: b.hip, knee: b.knee, ankle,
        hip3: [...b.hip, 0], knee3: [...b.knee, b.depth], ankle3: [...ankle, 0],
        upper: [1, 0, 0, 1, 0, 0], lower: [1, 0, 0, 1, 0, 0] };
      const dx = ankle[0] - hip[0], dy = ankle[1] - hip[1], d = Math.hypot(dx, dy);
      const along = (b.u * b.u - b.v * b.v + d * d) / (2 * d);
      const height = Math.sqrt(Math.max(0, b.u * b.u - along * along));
      const knee = [hip[0] + dx / d * along - dy / d * lateral[i],
        hip[1] + dy / d * along + dx / d * lateral[i]];
      const depth = Math.sqrt(Math.max(0, height * height - lateral[i] ** 2));
      return { hip, knee, ankle, hip3: [...hip, 0], knee3: [...knee, depth], ankle3: [...ankle, 0],
        upper: boneMatrix(b.hip, b.knee, hip, knee), lower: boneMatrix(b.knee, b.ankle, knee, ankle) };
    });
    cached = { ws, bx, angle, shift, drop, bones: solved,
      trunk: { spine: drive[0], chest: drive[1], head: drive[2], bob } };
    return cached;
  }
  function splitX(y) {
    const line = legs.split;
    let i = 0;
    while (i < line.length - 2 && y > line[i + 1][1]) i++;
    const a = line[i], b = line[i + 1], t = clamp((y - a[1]) / (b[1] - a[1]), 0, 1);
    return a[0] + (b[0] - a[0]) * t;
  }
  function weights(x, y) {
    // Split is hard only inside the transparent gap; above it, blend inside shorts.
    const right = y >= legs.split[0][1] ? Number(x >= splitX(y)) : smooth(splitX(y) - 4, splitX(y) + 4, x);
    const perBone = bones.map(b => ({
      leg: smooth(legs.band[0], b.hip[1], y),
      shin: smooth(b.knee[1] - 45, b.knee[1] + 45, y),
      pin: 1 - smooth(b.ankle[1] - 55, b.ankle[1], y),
    }));
    return { right, perBone };
  }
  function apply(p, _x, y, w, P) {
    const F = frame(P);
    if (!F.ws && !F.bx && !F.trunk.chest && !F.trunk.head && !bob) return;
    const pivot = [legs.pelvis[0] + F.shift, legs.pelvis[1] + F.drop];
    const upper = 1 - smooth(Math.min(body.chest.cy, legs.pelvis[1] - 1), legs.pelvis[1], y);
    const spineBlend = 1 - smooth(...legs.band, y);
    const rejection = legs.spine ?? LEG_DEFAULTS.spine;
    // A small opposite shoulder inclination, rather than cancelling the pelvis
    // completely and leaving a translating rod. Blend the spine continuously.
    const shoulderAngle = legs.tilt * (1 - rejection) * F.trunk.chest;
    const chestShift = legs.shift * (1.12 * F.trunk.chest - F.ws)
      + Math.sin(shoulderAngle) * Math.max(0, legs.pelvis[1] - body.chest.cy);
    const bodyPoint = point => {
      const q = rotate(point, legs.pelvis, F.angle);
      q[0] += F.shift; q[1] += F.drop;
      const result = rotate(q, pivot, (shoulderAngle - F.angle) * spineBlend);
      result[0] += chestShift * upper;
      return result;
    };
    const counter = bodyPoint(p);
    if (head) {
      const weight = 1 - smooth(...head.weightBand, y);
      const center = bodyPoint([head.pivotX, head.pivotY]);
      const correction = -legs.tilt * (1 - rejection) * F.trunk.head * weight;
      const q = rotate(counter, center, correction);
      counter[0] = q[0] + legs.shift * 1.12 * (F.trunk.head - F.trunk.chest) * weight; counter[1] = q[1];
    }
    let dx = 0, dy = 0;
    bones.forEach((_b, i) => {
      const f = F.bones[i], bw = w.perBone[i];
      const thigh = transform(p, f.upper);
      const shin = transform(p, f.lower);
      const qx = thigh[0] + (shin[0] - thigh[0]) * bw.shin;
      const qy = thigh[1] + (shin[1] - thigh[1]) * bw.shin;
      const side = i ? w.right : 1 - w.right;
      dx += ((counter[0] - p[0]) * (1 - bw.leg) + (qx - p[0]) * bw.leg) * bw.pin * side;
      dy += ((counter[1] - p[1]) * (1 - bw.leg) + (qy - p[1]) * bw.leg) * bw.pin * side;
    });
    p[0] += dx; p[1] += dy;
  }
  function pin(y) { return 1 - smooth(ankleY - 55, ankleY, y); }
  return { frame, weights, apply, pin, step };
}
