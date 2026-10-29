import { afterEach, expect, test, vi } from 'vitest';
import { openAvatar, packAvatar, unpackAvatar, validateAvatarFiles } from 'mesh-avatar';
import { createOverlayLayers, opaqueRect } from '../src/engine/overlays.js';
import { packProjectAvatar } from '../src/format/project-archive';
import { sampleFiles } from './avatar-fixture';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const sheet = { version: 1, overlays: [{ name: 'glasses', file: 'glasses.png' }] };
function withOverlays(manifest: unknown = sheet): Record<string, Uint8Array> {
  const files = sampleFiles();
  // any non-empty PNG works for the format checks
  files['built/overlays/overlays.json'] = encode(manifest);
  files['built/overlays/glasses.png'] = files['built/sprites/mouth_a.png'];
  return files;
}

test('overlays are optional and a valid overlay list passes validation', () => {
  expect(validateAvatarFiles(sampleFiles())).toEqual([]);
  expect(validateAvatarFiles(withOverlays())).toEqual([]);
  // legacy (no version) and unknown keys are accepted, as for the other metadata files
  expect(validateAvatarFiles(withOverlays({ overlays: [{ name: 'glasses', file: 'glasses.png', future: true }], future: 1 }))).toEqual([]);
});

test('rejects malformed overlay lists, unsafe names, duplicates, missing images and future versions', () => {
  const path = 'built/overlays/overlays.json';
  expect(validateAvatarFiles(withOverlays({ overlays: {} }))).toContain(`${path}.overlays: expected an array`);
  expect(validateAvatarFiles(withOverlays({ ...sheet, version: 2 }))).toContain(`${path}.version: unsupported version 2 (expected 1)`);
  for (const item of [null, { name: 'glasses' }, { name: '../x', file: 'glasses.png' }, { name: 'glasses', file: '../glasses.png' }, { name: 'glasses', file: 'glasses.jpg' }]) {
    expect(validateAvatarFiles(withOverlays({ overlays: [item] }))).toContain(`${path}.overlays[0]: expected { name, file } with safe names`);
  }
  expect(validateAvatarFiles(withOverlays({ overlays: [sheet.overlays[0], sheet.overlays[0]] }))).toContain(`${path}.overlays[1].name: duplicate overlay name`);
  const files = withOverlays(); delete files['built/overlays/glasses.png'];
  expect(validateAvatarFiles(files)).toContain('built/overlays/glasses.png: missing file');
});

test('archives expose overlay assets only when the avatar has them', async () => {
  const loaded = await openAvatar(packAvatar(withOverlays()));
  try {
    expect(Object.keys(loaded.assets)).toEqual(expect.arrayContaining(['overlays/overlays.json', 'overlays/glasses.png']));
  } finally { loaded.release(); }
  const plain = await openAvatar(packAvatar(sampleFiles()));
  try {
    expect(Object.keys(plain.assets).some(name => name.startsWith('overlays/'))).toBe(false);
  } finally { plain.release(); }
});

test('folder loading reads the optional overlay list and validates it', async () => {
  const files = withOverlays();
  const folder = (data: Record<string, Uint8Array>) => vi.fn(async (input: RequestInfo | URL) => {
    const body = data[new URL(String(input)).pathname.slice('/avatar/'.length)];
    return body ? new Response(new Uint8Array(body)) : new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', folder(files));
  const loaded = await openAvatar('https://example.test/avatar/');
  expect(loaded.assets['overlays/glasses.png']).toBe('https://example.test/avatar/built/overlays/glasses.png');
  vi.stubGlobal('fetch', folder({ ...files, 'built/overlays/overlays.json': encode({ overlays: [{ name: 'glasses', file: '../x.png' }] }) }));
  await expect(openAvatar('https://example.test/avatar/')).rejects.toThrow('built/overlays/overlays.json.overlays[0]: expected { name, file } with safe names');
});

test('project archives include the listed overlay images', async () => {
  const files = withOverlays();
  const read = async (paths: Set<string>) => Object.fromEntries([...paths].filter(path => files[path]).map(path => [path, files[path]]));
  const archive = unpackAvatar(await packProjectAvatar(read, { name: 'sample' }));
  expect(archive['built/overlays/overlays.json']).toEqual(files['built/overlays/overlays.json']);
  expect(Buffer.from(archive['built/overlays/glasses.png']).equals(Buffer.from(files['built/overlays/glasses.png']))).toBe(true);
  files['built/overlays/overlays.json'] = encode({ overlays: [{ name: 'glasses', file: '../glasses.png' }] });
  await expect(packProjectAvatar(read, { name: 'sample' })).rejects.toThrow('built/overlays/overlays.json: invalid overlay file name');
});

test('overlay layers mesh only the opaque area, switch by name and skip hidden layers', () => {
  const layers: { visible: boolean }[] = [];
  const renderer = { addLayer: vi.fn(() => { const layer = { visible: true }; layers.push(layer); return layer; }) };
  const buildGrid = vi.fn(() => ({ rest: new Float32Array([2, 3]), pos: new Float32Array(2) }));
  const alpha = new Uint8Array(64); alpha[3 * 8 + 4] = 255; // only (4, 3) is opaque
  const crop = vi.fn(() => ({ cropped: true }));
  const overlays = createOverlayLayers(renderer, { overlays: [{ name: 'glasses' }, { name: 'empty' }] },
    { glasses: { width: 8, height: 8 }, empty: { width: 8, height: 8 } }, buildGrid,
    () => alpha,
    (x: number, y: number, hair: number) => ({ brow: 0.7, jaw: 0.8, earL: 0.4, hair, x, y }), 4, 8, 8, crop);
  // the grid and the texture cover the opaque pixels plus padding (clamped to the image)
  expect(buildGrid).toHaveBeenCalledWith([0, 0, 8, 8], 4, expect.any(Uint8Array), 8);
  expect(crop).toHaveBeenCalledWith({ width: 8, height: 8 }, [0, 0, 8, 8]);
  expect(renderer.addLayer).toHaveBeenCalledWith('overlay_glasses', { cropped: true }, expect.anything());
  expect(layers[0].visible).toBe(false);
  overlays.set(['unknown', 'glasses']);
  expect(layers[0].visible).toBe(true);
  overlays.set(['unknown']);
  expect(layers[0].visible).toBe(false);
  const weights: Record<string, number>[] = [];
  const deform = (x: number, y: number, w: Record<string, number>, _p: unknown, _phys: unknown, out: number[]) => {
    weights.push(w); out[0] = x; out[1] = y;
  };
  overlays.update({}, {}, deform, [0, 0]);
  expect(weights).toHaveLength(0);
  overlays.set(['glasses']);
  overlays.update({}, {}, deform, [0, 0]);
  // brows and jaw do not move an accessory; the hair weight is 0 as for the sprites
  expect(weights[0]).toMatchObject({ brow: 0, jaw: 0, earL: 0.4, hair: 0 });
  expect(() => createOverlayLayers(renderer, { overlays: [{ name: 'glasses' }] }, { glasses: { width: 4, height: 8 } },
    buildGrid, () => alpha, () => ({}), 4, 8, 8, crop)).toThrow('overlay glasses: image size does not match base.png');
});

test('opaqueRect pads the opaque bounds and returns null for a transparent image', () => {
  const alpha = new Uint8Array(100 * 50); alpha[20 * 100 + 30] = 255; alpha[25 * 100 + 60] = 10; alpha[40 * 100 + 90] = 3;
  expect(opaqueRect(alpha, 100, 50)).toEqual([24, 14, 43, 18]);
  expect(opaqueRect(new Uint8Array(100), 10, 10)).toBeNull();
});
