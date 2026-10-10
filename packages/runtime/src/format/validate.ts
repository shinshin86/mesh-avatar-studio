import { validateRig } from '../rig/validate.ts';
import type { Rig } from '../rig/types';
import { parseManifest } from './manifest.ts';

type FileData = Uint8Array | { size: number };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const numbers = (value: unknown, length: number): value is number[] => Array.isArray(value)
  && value.length === length && value.every(n => typeof n === 'number' && Number.isFinite(n));
const own = (value: object, key: string) => Object.hasOwn(value, key);

/** Validate folder metadata and required files without decoding images or performing I/O. */
export function validateAvatarFiles(files: Record<string, FileData>): string[] {
  const errors: string[] = [];
  function json(path: string, required = true): Record<string, unknown> | undefined {
    if (!own(files, path)) {
      if (required) errors.push(`${path}: missing file`);
      return;
    }
    const data = files[path];
    if (!(data instanceof Uint8Array)) { errors.push(`${path}: JSON bytes are required`); return; }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)); }
    catch { errors.push(`${path}: invalid UTF-8 JSON`); return; }
    if (!object(value)) { errors.push(`${path}: expected an object`); return; }
    return value;
  }
  function version(value: Record<string, unknown>, path: string, legacy = true): boolean {
    if (value.version === 1 || (legacy && value.version === undefined)) return true;
    errors.push(`${path}.version: unsupported version ${JSON.stringify(value.version) ?? 'missing'} (expected 1)`);
    return false;
  }
  function image(path: string) {
    if (!own(files, path)) { errors.push(`${path}: missing file`); return; }
    const data = files[path], size = data instanceof Uint8Array ? data.byteLength : data?.size;
    if (!Number.isSafeInteger(size) || size <= 0) errors.push(`${path}: expected a non-empty file`);
  }
  function layers(value: unknown, path: string, directory: string, size?: number[]) {
    if (!object(value)) { errors.push(`${path}.layers: expected a layer rectangle map`); return; }
    for (const [name, rect] of Object.entries(value)) {
      const field = `${path}.layers.${name}`;
      if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        errors.push(`${field}: expected a safe layer name (letters, digits, hyphens or underscores)`);
        continue;
      }
      if (!numbers(rect, 4) || !rect.every(Number.isInteger) || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0) {
        errors.push(`${field}: expected [x, y, width, height] with non-negative integer origins and positive integer dimensions`);
      } else if (size && (rect[0] + rect[2] > size[0] || rect[1] + rect[3] > size[1])) {
        errors.push(`${field}: rectangle must stay inside the image`);
      }
      image(`${directory}/${name}.png`);
    }
    return value;
  }
  function build(value: Record<string, unknown>, path: string) {
    if (typeof value.build !== 'string' || !value.build.trim()) errors.push(`${path}.build: expected a non-empty string`);
  }

  const manifest = json('avatar.json', false);
  if (manifest) {
    try { parseManifest(manifest); }
    catch (error) { errors.push((error as Error).message); }
  }
  const rawRig = json('rig.json');
  let rig: Rig | undefined;
  if (rawRig && version(rawRig, 'rig.json', false)) {
    const problems = validateRig(rawRig);
    errors.push(...problems.map(error => `rig.json: ${error}`));
    if (!problems.length) rig = rawRig as unknown as Rig;
  }
  image('built/base.png'); image('built/hairmask.png');
  const meta = json('built/layers.json');
  if (meta && version(meta, 'built/layers.json')) {
    build(meta, 'built/layers.json');
    let size: number[] | undefined;
    if (!numbers(meta.size, 2) || !meta.size.every(n => Number.isInteger(n) && n > 0)) {
      errors.push('built/layers.json.size: expected [width, height] with positive integer dimensions');
    } else {
      size = meta.size;
      if (rig && (size[0] !== rig.image.width || size[1] !== rig.image.height)) errors.push('built/layers.json.size: must match rig.json.image');
    }
    const rectangles = layers(meta.layers, 'built/layers.json', 'built', size);
    if (rig && rectangles) {
      const required = [...rig.eyes.flatMap((_, i) => ['ball', 'low', 'crease', 'lash'].map(part => `eye${i}_${part}`)),
        ...(rig.hand ? ['hand'] : []), ...(rig.accessories ?? []).map(part => part.name)];
      for (const name of required) if (!own(rectangles, name)) errors.push(`built/layers.json.layers.${name}: missing required layer`);
    }
    if (!Array.isArray(meta.eyes) || meta.eyes.length !== 2) {
      errors.push('built/layers.json.eyes: expected two eye curves');
    } else meta.eyes.forEach((eye: unknown, i: number) => {
      const path = `built/layers.json.eyes[${i}]`;
      if (!object(eye)) { errors.push(`${path}: expected an object`); return; }
      const span = numbers([eye.x0, eye.x1], 2) && (eye.x0 as number) < (eye.x1 as number);
      if (!span) errors.push(`${path}: expected finite x0 < x1`);
      for (const key of ['top', 'bot'] as const) {
        if (!numbers(eye[key], 24)) errors.push(`${path}.${key}: expected 24 finite numbers`);
      }
      if (numbers(eye.top, 24) && numbers(eye.bot, 24) && eye.top.some((y, k) => y > (eye.bot as number[])[k])) {
        errors.push(`${path}.top: must not exceed bottom curve`);
      }
      if (rig) for (const key of ['x0', 'x1', 'top', 'bot'] as const) {
        const a = eye[key], b = rig.eyes[i][key];
        const same = Array.isArray(b) ? numbers(a, b.length) && a.every((n, k) => n === b[k]) : a === b;
        if (!same) errors.push(`${path}.${key}: must match rig.json.eyes[${i}].${key}`);
      }
    });
  }
  const sprites = json('built/sprites/sprites.json', false);
  if (sprites && version(sprites, 'built/sprites/sprites.json')) {
    build(sprites, 'built/sprites/sprites.json');
    layers(sprites.layers, 'built/sprites/sprites.json', 'built/sprites', rig ? [rig.image.width, rig.image.height] : undefined);
  }
  return errors;
}
