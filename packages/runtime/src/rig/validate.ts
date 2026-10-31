import { clothGrid } from '../engine/cloth-grid.js';
import type { Rig } from './types';

type Check = (value: unknown, path: string, errors: string[]) => void;
const number: Check = (v, p, e) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) e.push(`${p}: expected a finite number`);
};
const positive: Check = (v, p, e) => {
  number(v, p, e);
  if (typeof v === 'number' && v <= 0) e.push(`${p}: must be positive`);
};
const nonnegative: Check = (v, p, e) => {
  number(v, p, e);
  if (typeof v === 'number' && v < 0) e.push(`${p}: must be nonnegative`);
};
const cohesion: Check = (v, p, e) => {
  nonnegative(v, p, e);
  if (typeof v === 'number' && (!Number.isInteger(v) || v > 8)) e.push(`${p}: expected an integer from 0 to 8`);
};
const integer: Check = (v, p, e) => {
  positive(v, p, e);
  if (typeof v === 'number' && !Number.isInteger(v)) e.push(`${p}: expected an integer`);
};
const wholeNumber: Check = (v, p, e) => {
  number(v, p, e);
  if (typeof v === 'number' && !Number.isInteger(v)) e.push(`${p}: expected an integer`);
};
const string: Check = (v, p, e) => {
  if (typeof v !== 'string' || !v.trim()) e.push(`${p}: expected a non-empty string`);
};
const array = (item: Check, min = 0, max = Infinity): Check => (v, p, e) => {
  if (!Array.isArray(v)) { e.push(`${p}: expected an array`); return; }
  if (v.length < min || v.length > max) e.push(`${p}: expected ${min}..${max} items`);
  v.forEach((x, i) => item(x, `${p}[${i}]`, e));
};
const point = array(number, 2, 2);
const band: Check = (v, p, e) => {
  point(v, p, e);
  if (Array.isArray(v) && v.length === 2 && v[0] >= v[1]) e.push(`${p}: start must be less than end`);
};
const object = (fields: Record<string, Check>, optional: string[] = []): Check => (v, p, e) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) { e.push(`${p}: expected an object`); return; }
  const record = v as Record<string, unknown>;
  for (const [key, check] of Object.entries(fields)) {
    if (record[key] === undefined && optional.includes(key)) continue;
    check(record[key], `${p}.${key}`, e);
  }
};
const ellipseFields = { cx: number, cy: number, rx: positive, ry: positive };
const ellipse = object(ellipseFields);
const polygon = array(point, 3);
const line = array(point, 2);
const unit: Check = (v, p, e) => {
  number(v, p, e);
  if (typeof v === 'number' && (v < 0 || v > 1)) e.push(`${p}: must be between 0 and 1`);
};
const schema = (draft: boolean) => object({
  version: (v, p, e) => { if (v !== 1) e.push(`${p}: only version 1 is supported`); },
  image: object({ width: integer, height: integer }),
  head: object({ ...ellipseFields, shiftX: number, shiftY: number, pivotX: number,
    pivotY: number, maxRoll: number, weightBand: band, turnBand: band }),
  body: object({ pivotX: number, pivotY: number, maxRoll: number, breathBand: band,
    rollBand: band, chest: ellipse, shoulders: array(ellipse),
    hip: object({ shift: number, band }) }, ['hip']),
  face: object({ nose: ellipse, mouth: ellipse, eyeA: ellipse, eyeB: ellipse,
    earL: ellipse, earR: ellipse, brow: object({ ...ellipseFields, band }),
    jaw: object({ ...ellipseFields, band }) }),
  buns: object({ bunL: ellipse, bunR: ellipse }, ['bunL', 'bunR']),
  eyes: array(object({ opening: polygon, roi: polygon, x0: number, x1: number,
    top: array(number, 24, 24), bot: array(number, 24, 24) }, draft ? ['x0', 'x1', 'top', 'bot'] : []), 2, 2),
  mouth: object({ cx: number, cy: number, angle: number, halfLen: positive, bow: number,
    area: object({ ...ellipseFields, angle: number }) }),
  cheeks: array(point, 2, 2),
  strands: array(object({ name: string, nodes: line, sigma: positive, k: positive, max: positive })),
  accessories: array(object({ name: string, pivot: point, tip: point, split: unit,
    box: array(wholeNumber, 4, 4), color: object({ redness: unit, minRed: number }) })),
  hand: object({ outline: polygon, jaw: line, jawRange: band, background: polygon,
    elbow: point, wrist: point, knuckle: point, contact: point, forearmShare: unit,
    armBand: band, wristBand: band, handBand: band, fingerXBand: band,
    fingerYBand: band, pinBand: band }),
  cloth: array(object({ name: string, outline: polygon, waist: line, hem: line,
    columns: integer, rows: integer, stiffness: positive, damping: positive, max: positive,
    tierGain: positive, highModeDamping: positive, responseGain: positive, swing: positive, follow: unit, cohesion, wind: nonnegative,
    behind: (v, p, e) => { if (typeof v !== 'boolean') e.push(`${p}: expected a boolean`); },
    parent: string, scale: positive, seams: array(line, 0, 64), tiers: array(line, 0, 8) }, ['tierGain', 'highModeDamping', 'seams', 'tiers', 'responseGain', 'columns', 'rows', 'stiffness', 'damping', 'max', 'swing', 'follow', 'cohesion', 'wind', 'behind', 'parent', 'scale'])),
  legs: object({ spine: unit, bob: nonnegative, twist: nonnegative, pelvis: point, shift: nonnegative, tilt: nonnegative, bend: nonnegative,
    band, split: line, left: object({ hip: point, knee: point, ankle: point }),
    right: object({ hip: point, knee: point, ankle: point }) }, ['spine', 'bob', 'twist']),
  arms: object({ swing: nonnegative, bend: nonnegative, inward: unit,
    left: object({ shoulder: point, elbow: point, wrist: point, split: line }),
    right: object({ shoulder: point, elbow: point, wrist: point, split: line }) }, ['swing', 'bend', 'inward']),
  mesh: object({ baseCell: integer, fine: object({ x0: wholeNumber, x1: wholeNumber,
    y0: wholeNumber, y1: wholeNumber, cell: integer }), handCell: integer,
    tasselCell: integer, eyeBallCell: integer, eyeCell: integer, spriteCell: integer,
    clothCell: integer }, ['clothCell']),
  view: object({ padTop: number, padSide: number, gazeCenter: point, irisTravel: positive }, ['gazeCenter', 'irisTravel']),
}, ['buns', 'strands', 'accessories', 'hand', 'cloth', 'legs', 'arms']);

export function validateRig(value: unknown, options: { draft?: boolean } = {}): string[] {
  const errors: string[] = [];
  schema(options.draft ?? false)(value, 'rig', errors);
  if (errors.length) return errors;
  const rig = value as Rig;
  rig.eyes.forEach((eye, i) => {
    const curves = ['x0', 'x1', 'top', 'bot'] as const;
    if (options.draft && curves.every(key => eye[key] === undefined)) return;
    if (curves.some(key => eye[key] === undefined)) {
      errors.push(`rig.eyes[${i}]: supply all x0/x1/top/bot fields or omit all in a draft`);
      return;
    }
    if (eye.x0 >= eye.x1) errors.push(`rig.eyes[${i}].x1: must exceed x0`);
    if (eye.top.some((y, k) => y > eye.bot[k])) errors.push(`rig.eyes[${i}].top: must not exceed bottom curve`);
  });
  if (rig.mesh.fine.x0 >= rig.mesh.fine.x1 || rig.mesh.fine.y0 >= rig.mesh.fine.y1)
    errors.push('rig.mesh.fine: rectangle must have positive area');
  if (rig.view.padTop <= -1 || rig.view.padTop >= 1 || rig.view.padSide <= -0.5)
    errors.push('rig.view: margins must leave a positive viewport');
  for (const [i, strand] of (rig.strands ?? []).entries()) {
    if (strand.nodes.some((p, j) => j > 0 && p[0] === strand.nodes[j - 1][0] && p[1] === strand.nodes[j - 1][1]))
      errors.push(`rig.strands[${i}].nodes: consecutive nodes must differ`);
  }
  for (const [i, accessory] of (rig.accessories ?? []).entries()) {
    if (accessory.box[0] < 0 || accessory.box[1] < 0 || accessory.box[2] > rig.image.width || accessory.box[3] > rig.image.height)
      errors.push(`rig.accessories[${i}].box: rectangle must stay inside the image`);
    if (accessory.split <= 0 || accessory.split >= 1) errors.push(`rig.accessories[${i}].split: must be strictly between 0 and 1`);
    if (accessory.pivot.every((n, k) => n === accessory.tip[k])) errors.push(`rig.accessories[${i}].tip: must differ from pivot`);
    if (accessory.box[0] >= accessory.box[2] || accessory.box[1] >= accessory.box[3]) errors.push(`rig.accessories[${i}].box: rectangle must have positive area`);
  }
  const clothNames = new Set<string>();
  if (rig.legs) {
    if ((rig.legs.twist ?? 0) > 15) errors.push('rig.legs.twist: must be between 0 and 15 degrees');
    const legs = rig.legs;
    for (const side of ['left', 'right'] as const) {
      const b = legs[side];
      if (!(legs.band[0] < b.hip[1] && b.hip[1] < b.knee[1] && b.knee[1] < b.ankle[1]))
        errors.push(`rig.legs.${side}: require band start < hip y < knee y < ankle y`);
    }
    if (legs.split.some((p, i) => i > 0 && p[1] <= legs.split[i - 1][1]))
      errors.push('rig.legs.split: y coordinates must increase');
  }
  if (rig.arms) {
    if ((rig.arms.swing ?? 4) > 10) errors.push('rig.arms.swing: must be between 0 and 10 degrees');
    if ((rig.arms.bend ?? 6) > 12) errors.push('rig.arms.bend: must be between 0 and 12 degrees');
    for (const side of ['left', 'right'] as const) {
      const arm = rig.arms[side], path = `rig.arms.${side}`;
      if (!(arm.shoulder[1] < arm.elbow[1] && arm.elbow[1] < arm.wrist[1]))
        errors.push(`${path}: require shoulder y < elbow y < wrist y`);
      for (const [key, points] of Object.entries({ shoulder: [arm.shoulder], elbow: [arm.elbow], wrist: [arm.wrist], split: arm.split })) {
        if (points.some(([x, y]) => x < 0 || y < 0 || x >= rig.image.width || y >= rig.image.height))
          errors.push(`${path}.${key}: points must stay inside the image`);
      }
      if (arm.split.some((p, i) => i > 0 && p[1] <= arm.split[i - 1][1])) {
        errors.push(`${path}.split: y coordinates must increase`);
      } else {
        const splitX = (y: number) => {
          let i = 0;
          while (i < arm.split.length - 2 && y > arm.split[i + 1][1]) i++;
          const a = arm.split[i], b = arm.split[i + 1];
          const t = Math.max(0, Math.min(1, (y - a[1]) / (b[1] - a[1])));
          return a[0] + (b[0] - a[0]) * t;
        };
        if ([arm.elbow, arm.wrist].some(([x, y]) => side === 'left' ? splitX(y) <= x : splitX(y) >= x))
          errors.push(`${path}.split: must lie on the body side of elbow and wrist`);
      }
    }
  }
  for (const [i, cloth] of (rig.cloth ?? []).entries()) {
    if (!/^[A-Za-z0-9_-]+$/.test(cloth.name) || clothNames.has(cloth.name))
      errors.push(`rig.cloth[${i}].name: must be a unique layer-safe name`);
    if (cloth.parent !== undefined && !clothNames.has(cloth.parent))
      errors.push(`rig.cloth[${i}].parent: must name an earlier cloth entry`);
    if ((cloth.columns ?? 2) < 2 || (cloth.rows ?? 2) < 2)
      errors.push(`rig.cloth[${i}]: columns and rows must be at least 2`);
    if (cloth.seams?.length === 1) errors.push(`rig.cloth[${i}].seams: at least two columns required`);
    if (cloth.seams?.length || cloth.tiers?.length) {
      if (cloth.seams?.some(s => s.some((p, j) => j > 0 && p[1] <= s[j - 1][1]))) errors.push(`rig.cloth[${i}].seams: y must increase from waist to hem`);
      try { clothGrid(cloth); } catch (error) { errors.push(`rig.cloth[${i}]: ${error instanceof Error ? error.message : String(error)}`); }
    }
    clothNames.add(cloth.name);
  }
  return errors;
}

export function parseRig(value: unknown): Rig {
  const errors = validateRig(value);
  if (errors.length) throw new Error(`Invalid rig:\n${errors.join('\n')}`);
  return structuredClone(value) as Rig;
}
