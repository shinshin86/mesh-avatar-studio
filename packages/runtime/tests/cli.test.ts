import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { unpackAvatar } from 'mesh-avatar';
import { sampleFiles } from './avatar-fixture';

test('pack CLI selects playback files, honors --no-source and protects existing output', () => {
  mkdirSync('projects', { recursive: true });
  const root = mkdtempSync(resolve('projects/.pack-check-'));
  const command = (tool: string, args: string[]) => spawnSync(process.execPath,
    ['--experimental-strip-types', `tools/${tool}.mjs`, ...args], { encoding: 'utf8' });
  try {
    for (const [name, bytes] of Object.entries(sampleFiles())) {
      const path = resolve(root, name); mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, name.endsWith('.png') ? new Uint8Array([1]) : bytes);
    }
    const manifest = JSON.parse(readFileSync(resolve(root, 'avatar.json'), 'utf8'));
    writeFileSync(resolve(root, 'avatar.json'), JSON.stringify({ ...manifest, source: 'original.png' }));
    writeFileSync(resolve(root, 'original.png'), new Uint8Array([2]));
    writeFileSync(resolve(root, 'built/private-note.txt'), 'not for sharing');
    const output = resolve(root, 'playback.mavatar');
    const packed = command('pack-avatar', [root, '--no-source', '-o', output]);
    expect(packed.status, packed.stderr).toBe(0);
    const bytes = readFileSync(output), files = unpackAvatar(bytes);
    expect(files['source.png']).toBeUndefined(); expect(files['original.png']).toBeUndefined();
    expect(files['built/private-note.txt']).toBeUndefined();
    expect(Object.keys(files).some(name => /^(variants|work|review)\//.test(name))).toBe(false);
    expect(JSON.parse(new TextDecoder().decode(files['avatar.json'])).source).toBeUndefined();
    expect(command('validate-avatar', [output]).status).toBe(0);
    expect(command('pack-avatar', [root, '-o', output]).status).toBe(1);
    expect(readFileSync(output).equals(bytes)).toBe(true);
    const editable = resolve(root, 'editable.mavatar');
    expect(command('pack-avatar', [root, '-o', editable]).status).toBe(0);
    expect(unpackAvatar(readFileSync(editable))['original.png']).toEqual(new Uint8Array([2]));
    const rigPath = resolve(root, 'rig.json'), rig = JSON.parse(readFileSync(rigPath, 'utf8'));
    rig.cloth = [{ name: 'skirt', outline: [[0, 0], [100, 0], [100, 100]], waist: [[0, 0], [100, 0]], hem: [[0, 100], [100, 100]] }];
    writeFileSync(rigPath, JSON.stringify(rig));
    const metaPath = resolve(root, 'built/layers.json'), meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.layers.cloth_skirt = [0, 0, 100, 100]; writeFileSync(metaPath, JSON.stringify(meta));
    for (const file of ['base_cloth', 'cloth_skirt']) writeFileSync(resolve(root, `built/${file}.png`), new Uint8Array([3]));
    const clothed = resolve(root, 'cloth.mavatar');
    expect(command('pack-avatar', [root, '-o', clothed]).status).toBe(0);
    expect(unpackAvatar(readFileSync(clothed))['built/base_cloth.png']).toEqual(new Uint8Array([3]));
    expect(command('validate-avatar', [clothed]).status).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 60000);
