import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { validateAvatarFiles } from 'mesh-avatar';
import rig from '../../../samples/miko-qipao/rig.json';
import metadata from '../../../samples/miko-qipao/built/layers.json';
import sprites from '../../../samples/miko-qipao/built/sprites/sprites.json';
import manifest from '../../../samples/miko-qipao/avatar.json';

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
function fixture(): Parameters<typeof validateAvatarFiles>[0] {
  const files: Parameters<typeof validateAvatarFiles>[0] = {
    'avatar.json': encode(manifest), 'rig.json': encode(rig),
    'built/layers.json': encode(metadata), 'built/sprites/sprites.json': encode(sprites),
    'built/base.png': { size: 1 }, 'built/hairmask.png': { size: 1 },
  };
  for (const name of Object.keys(metadata.layers)) files[`built/${name}.png`] = { size: 1 };
  for (const name of Object.keys(sprites.layers)) files[`built/sprites/${name}.png`] = { size: 1 };
  return files;
}

test('validates the actual sample files through the public API and the Node CLI', () => {
  const root = new URL('../../../samples/miko-qipao/', import.meta.url);
  const files = Object.fromEntries(Object.keys(fixture()).map(path => [path, readFileSync(new URL(path, root))]));
  expect(validateAvatarFiles(files)).toEqual([]);
  const cli = fileURLToPath(new URL('../../../tools/validate-avatar.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--experimental-strip-types', cli, fileURLToPath(root)], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain('Valid avatar folder: miko-qipao');
});

test('accepts legacy folders, optional sprites and unknown files and keys without mutating inputs', () => {
  const files = fixture();
  delete files['avatar.json'];
  delete files['built/sprites/sprites.json'];
  files['built/layers.json'] = encode({ ...metadata, future: { enabled: true } });
  files['notes.txt'] = { size: 0 };
  const before = structuredClone(files);
  expect(validateAvatarFiles(files)).toEqual([]);
  expect(files).toEqual(before);
  files['built/layers.json'] = encode({ ...metadata, version: 1 });
  files['built/sprites/sprites.json'] = encode({ ...sprites, version: 1 });
  expect(validateAvatarFiles(files)).toEqual([]);
});

test.each(['rig.json', 'built/layers.json', 'built/base.png', 'built/hairmask.png',
  'built/eye0_ball.png', 'built/tassel_l.png', 'built/sprites/mouth_a.png'])('names missing file %s', path => {
  const files = fixture(); delete files[path];
  expect(validateAvatarFiles(files)).toContain(`${path}: missing file`);
});

test.each(['hand', 'eye0_crease', 'tassel_l'])('requires the rig-referenced rectangle %s', name => {
  const files = fixture(), layers: Record<string, number[]> = { ...metadata.layers };
  delete layers[name];
  files['built/layers.json'] = encode({ ...metadata, layers });
  expect(validateAvatarFiles(files)).toContain(`built/layers.json.layers.${name}: missing required layer`);
});

test('permits omitted hand and accessories when they are absent from the rig', () => {
  const files = fixture(), optionalRig: Record<string, unknown> = { ...rig };
  delete optionalRig.hand; delete optionalRig.accessories;
  const layers: Record<string, number[]> = { ...metadata.layers };
  for (const name of ['hand', ...rig.accessories.map(a => a.name)]) {
    delete layers[name]; delete files[`built/${name}.png`];
  }
  files['rig.json'] = encode(optionalRig);
  files['built/layers.json'] = encode({ ...metadata, layers });
  expect(validateAvatarFiles(files)).toEqual([]);
});

test.each(['avatar.json', 'rig.json', 'built/layers.json', 'built/sprites/sprites.json'])('rejects future versions in %s', path => {
  const files = fixture(), json = JSON.parse(new TextDecoder().decode(files[path] as Uint8Array));
  files[path] = encode({ ...json, version: 2 });
  expect(validateAvatarFiles(files)).toContain(`${path}.version: unsupported version 2 (expected 1)`);
});

test.each(['x0', 'x1', 'top', 'bot'] as const)('rejects a mismatched copied eye field %s', field => {
  const files = fixture(), changed = structuredClone(metadata);
  if (field === 'top' || field === 'bot') changed.eyes[1][field][5] += 0.01;
  else changed.eyes[1][field] += 0.01;
  files['built/layers.json'] = encode(changed);
  expect(validateAvatarFiles(files)).toContain(`built/layers.json.eyes[1].${field}: must match rig.json.eyes[1].${field}`);
});

test('rejects a draft rig, inconsistent image dimensions and malformed metadata', () => {
  const files = fixture();
  files['rig.json'] = encode({ ...rig, eyes: rig.eyes.map(({ opening, roi }) => ({ opening, roi })) });
  expect(validateAvatarFiles(files).join('\n')).toContain('rig.json: rig.eyes[0].top:');
  files['rig.json'] = encode(rig);
  files['built/layers.json'] = encode({ ...metadata, size: [2000, 2000] });
  expect(validateAvatarFiles(files)).toContain('built/layers.json.size: must match rig.json.image');
  files['built/layers.json'] = encode({ version: 1, size: [0, 1254], layers: [], eyes: [] });
  const errors = validateAvatarFiles(files).join('\n');
  for (const field of ['size', 'build', 'layers', 'eyes']) expect(errors).toContain(`built/layers.json.${field}:`);
  files['built/sprites/sprites.json'] = encode({ version: 1, build: '', layers: [] });
  expect(validateAvatarFiles(files).join('\n')).toContain('built/sprites/sprites.json.layers: expected a layer rectangle map');
});

test('checks rectangle coordinates and file names in layer and sprite maps', () => {
  for (const [path, meta] of [['built/layers.json', metadata], ['built/sprites/sprites.json', sprites]] as const) {
    for (const rect of [[-1, 0, 1, 1], [0, 0, 0, 1], [0.5, 0, 1, 1], [1253, 0, 2, 1]]) {
      const files = fixture(), name = Object.keys(meta.layers)[0];
      files[path] = encode({ ...meta, layers: { ...meta.layers, [name]: rect } });
      expect(validateAvatarFiles(files).join('\n')).toContain(`${path}.layers.${name}:`);
    }
    const files = fixture();
    files[path] = encode({ ...meta, layers: { ...meta.layers, '../escape': [0, 0, 1, 1] } });
    expect(validateAvatarFiles(files).join('\n')).toContain(`${path}.layers.../escape: expected a safe layer name`);
  }
});

test('requires bytes for JSON and non-empty bytes or size metadata for images', () => {
  const files = fixture();
  for (const data of [encode(null), new Uint8Array([0xff]), new TextEncoder().encode('{'), { size: 1 }]) {
    files['avatar.json'] = data;
    expect(validateAvatarFiles(files).join('\n')).toContain('avatar.json:');
  }
  delete files['avatar.json'];
  for (const data of [new Uint8Array(), { size: 0 }, { size: -1 }, { size: 1.5 }]) {
    files['built/base.png'] = data;
    expect(validateAvatarFiles(files)).toContain('built/base.png: expected a non-empty file');
  }
  files['built/base.png'] = new Uint8Array([1]);
  expect(validateAvatarFiles(files)).toEqual([]);
});
