import { afterEach, expect, test, vi } from 'vitest';
import { zipSync } from 'fflate';
import { createMeshAvatar, openAvatar, loadMeshAvatar, packAvatar } from 'mesh-avatar';
import { sampleFiles } from './avatar-fixture';

vi.mock('../src/engine', async importOriginal => ({
  ...await importOriginal<typeof import('../src/engine')>(),
  createMeshAvatar: vi.fn(async () => ({ destroy: vi.fn() })),
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(createMeshAvatar).mockClear(); });
const files = sampleFiles(), archive = packAvatar(files);
const decode = (path: string) => JSON.parse(new TextDecoder().decode(files[path]));
function folderFetch(overrides: Record<string, Uint8Array | null> = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname.slice('/avatar/'.length);
    const data = Object.hasOwn(overrides, path) ? overrides[path] : files[path];
    return data ? new Response(new Uint8Array(data), { headers: { 'Content-Type': 'application/json' } }) : new Response('', { status: 404 });
  });
}

test('archive input forms expose the same rig and asset keys as folder loading', async () => {
  const fetch = folderFetch(); vi.stubGlobal('fetch', fetch);
  const folder = await openAvatar(new URL('https://example.test/avatar'));
  for (const source of [archive, new Uint8Array(archive).buffer, new Blob([new Uint8Array(archive)])]) {
    const loaded = await openAvatar(source);
    try {
      expect(loaded.manifest).toEqual(folder.manifest);
      expect(loaded.rig).toEqual(folder.rig);
      expect(Object.keys(loaded.assets).sort()).toEqual(Object.keys(folder.assets).sort());
      expect(Object.values(loaded.assets).every(url => url.startsWith('blob:'))).toBe(true);
      expect(await openAvatar(loaded)).toBe(loaded);
    } finally { loaded.release(); }
  }
  expect(fetch).toHaveBeenCalledTimes(4);
});

test('fetches archive URLs with query strings and creates usable, revocable image and JSON URLs', async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response(new Uint8Array(archive))); vi.stubGlobal('fetch', fetch);
  const loaded = await openAvatar('https://example.test/avatar.mavatar?download=1');
  expect(String(fetch.mock.calls[0][0])).toBe('https://example.test/avatar.mavatar?download=1');
  vi.unstubAllGlobals();
  const image = await globalThis.fetch(loaded.assets['base.png']);
  expect(image.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await image.arrayBuffer()).equals(Buffer.from(files['built/base.png']))).toBe(true);
  expect(await (await globalThis.fetch(loaded.assets['layers.json'])).json()).toEqual(decode('built/layers.json'));
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  loaded.release(); loaded.release();
  expect(revoke).toHaveBeenCalledTimes(Object.keys(loaded.assets).length);
});

test('folder URLs preserve query parameters, cache versions and optional older metadata', async () => {
  const fetch = folderFetch({ 'avatar.json': null, 'built/sprites/sprites.json': null }); vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('location', { href: 'https://example.test/editor/index.html' });
  const loaded = await openAvatar('/avatar?token=test', { version: 123 });
  expect(loaded.manifest).toEqual({ format: 'mesh-avatar', version: 1, name: 'avatar' });
  expect(loaded.assets['sprites/sprites.json']).toBeUndefined();
  for (const [url] of fetch.mock.calls) {
    expect(new URL(String(url)).searchParams.get('v')).toBe('123');
    expect(new URL(String(url)).searchParams.get('token')).toBe('test');
  }
  expect(loaded.assets['base.png']).toBe('https://example.test/avatar/built/base.png?token=test&v=123');
});

test('fills only missing eye curve fields for any chosen rig filename and keeps mismatches visible', async () => {
  const raw = decode('rig.json'); delete raw.eyes[0].top; delete raw.eyes[1].x0;
  const fetch = folderFetch({ 'custom-rig.json': new TextEncoder().encode(JSON.stringify(raw)) }); vi.stubGlobal('fetch', fetch);
  expect((await openAvatar('https://example.test/avatar/', { rigFile: 'custom-rig.json' })).rig).toEqual(decode('rig.json'));
  raw.eyes[0].x0 += 1;
  vi.stubGlobal('fetch', folderFetch({ 'rig.json': new TextEncoder().encode(JSON.stringify(raw)) }));
  await expect(openAvatar('https://example.test/avatar/')).rejects.toThrow('built/layers.json.eyes[0].x0: must match rig.json.eyes[0].x0');
});

test('only missing optional metadata is tolerated, while invalid versions and HTTP failures are errors', async () => {
  const fetch = folderFetch();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => String(input).endsWith('avatar.json') ? new Response('', { status: 403 }) : fetch(input));
  await expect(openAvatar('https://example.test/avatar/')).rejects.toThrow('avatar.json: could not load (403)');
  const rig = { ...decode('rig.json'), version: 2 };
  vi.stubGlobal('fetch', folderFetch({ 'rig.json': new TextEncoder().encode(JSON.stringify(rig)) }));
  await expect(openAvatar('https://example.test/avatar/')).rejects.toThrow('rig.json.version: unsupported version 2');
  vi.stubGlobal('fetch', folderFetch({ 'built/layers.json': null }));
  await expect(openAvatar('https://example.test/avatar/')).rejects.toThrow('built/layers.json: could not load (404)');
});

test('archives need a manifest and reject invalid content before making object URLs', async () => {
  const create = vi.spyOn(URL, 'createObjectURL');
  const missingManifest = { ...files }; delete missingManifest['avatar.json'];
  await expect(openAvatar(zipSync(missingManifest, { level: 0 }))).rejects.toThrow('avatar.json: missing file in .mavatar archive');
  const missingImage = { ...files }; delete missingImage['built/base.png'];
  await expect(openAvatar(zipSync(missingImage, { level: 0 }))).rejects.toThrow('built/base.png: missing file');
  expect(create).not.toHaveBeenCalled();
});

test('object URL creation failure releases all URLs already allocated', async () => {
  const create = vi.spyOn(URL, 'createObjectURL');
  create.mockReturnValueOnce('blob:first').mockImplementationOnce(() => { throw new Error('Allocation failed'); });
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  await expect(openAvatar(archive)).rejects.toThrow('Allocation failed');
  expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first');
});

test('loadMeshAvatar releases owned resources on destroy or failure but preserves caller-owned packages', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const avatar = await loadMeshAvatar({} as HTMLCanvasElement, archive, { manual: true });
  expect(createMeshAvatar).toHaveBeenCalledWith({}, { rig: avatar.package.rig, assets: avatar.package.assets, manual: true });
  avatar.destroy(); avatar.destroy();
  expect(revoke).toHaveBeenCalledTimes(Object.keys(avatar.package.assets).length);
  revoke.mockClear();
  vi.mocked(createMeshAvatar).mockRejectedValueOnce(new Error('Canvas unavailable'));
  await expect(loadMeshAvatar({} as HTMLCanvasElement, archive)).rejects.toThrow('Canvas unavailable');
  expect(revoke).toHaveBeenCalledTimes(Object.keys(avatar.package.assets).length);
  const shared = await openAvatar(archive), release = vi.spyOn(shared, 'release');
  const second = await loadMeshAvatar({} as HTMLCanvasElement, shared);
  second.destroy(); expect(release).not.toHaveBeenCalled();
  shared.release();
});
