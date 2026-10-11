import { afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { zipSync } from 'fflate';
import { unpackAvatar, validateAvatarFiles } from 'mesh-avatar';
import { packProjectAvatar } from '../packages/runtime/src/format/project-archive';
import { sampleFiles } from '../packages/runtime/tests/avatar-fixture';
import { localProjectMiddleware } from '../src/server/local-projects';

let root: string;
let fixture: Record<string, Uint8Array>;
let sharedArchive: Uint8Array;
beforeAll(async () => {
  fixture = sampleFiles();
  sharedArchive = await packProjectAvatar(async names => Object.fromEntries([...names].filter(name => fixture[name]).map(name => [name, fixture[name]])), { name: 'sample-miko-qipao' });
});
beforeEach(async () => {
  await mkdir('projects', { recursive: true });
  root = await mkdtemp(resolve('projects/.archive-api-test-'));
  for (const [name, bytes] of Object.entries(fixture)) {
    const file = resolve(root, 'samples/miko-qipao', name);
    await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes);
  }
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function call(path: string, data?: unknown, headers: Record<string, string> = {}) {
  const raw = data instanceof Uint8Array;
  const request = Readable.from(data === undefined ? [] : [raw ? Buffer.from(data) : Buffer.from(JSON.stringify(data))]) as IncomingMessage;
  request.url = `/__studio/${path}`; request.method = data === undefined ? 'GET' : 'POST';
  request.headers = { host: '127.0.0.1:5173', 'content-type': raw ? 'application/octet-stream' : 'application/json', ...headers };
  const result = { status: 0, bytes: Buffer.alloc(0), json: null as unknown };
  const response = {
    writeHead(status: number) { result.status = status; },
    end(body: string | Buffer) { result.bytes = Buffer.from(body); try { result.json = JSON.parse(String(body)); } catch { /* Binary response. */ } },
  } as unknown as ServerResponse;
  await localProjectMiddleware(root)(request, response, () => { result.status = 404; });
  return result;
}
const exported = () => call('export', { project: 'sample-miko-qipao', includeSource: true });

function expectSameBytes(actual: Uint8Array, expected: Uint8Array, path: string) {
  // Compare every byte without traversing large typed arrays as object properties.
  expect(Buffer.from(actual).equals(expected), `${path}: all bytes must match`).toBe(true);
}

test('sample export matches the shared selection, imports without overwriting and reexports identical bytes', async () => {
  const response = await exported(); expect(response.status).toBe(200);
  const files = unpackAvatar(response.bytes);
  expectSameBytes(response.bytes, sharedArchive, 'exported archive');
  expect(files['source.png']).toBeDefined(); expect(files['rig.draft.json']).toBeUndefined();
  expect(files['MIKO_ASSET_TERMS.md']).toBeUndefined(); expect(validateAvatarFiles(files)).toEqual([]);
  const first = await call('import', response.bytes), second = await call('import', response.bytes);
  expect(first.status).toBe(200); expect(second.status).toBe(200);
  expect(first.json).toMatchObject({ name: 'Miko-qipao', hasSource: true, readOnly: false });
  expect(second.json).toMatchObject({ name: 'Miko-qipao-1', hasSource: true });
  const repacked = await call('export', { project: 'Miko-qipao' }); expect(repacked.status).toBe(200);
  const repackedFiles = unpackAvatar(repacked.bytes);
  expect(Object.keys(repackedFiles).sort()).toEqual(Object.keys(files).sort());
  for (const [name, bytes] of Object.entries(files)) expectSameBytes(repackedFiles[name], bytes, name);
  expectSameBytes(await readFile(resolve(root, 'samples/miko-qipao/rig.json')), fixture['rig.json'], 'sample rig.json');
});

test('source-free imports remain playable and prohibit editor writes', async () => {
  const response = await call('export', { project: 'sample-miko-qipao', includeSource: false });
  const files = unpackAvatar(response.bytes); expect(files['source.png']).toBeUndefined();
  expect(validateAvatarFiles(files)).toEqual([]);
  const imported = await call('import', response.bytes); expect(imported.status).toBe(200);
  expect(imported.json).toMatchObject({ hasSource: false });
  for (const action of ['rig', 'rebuild', 'variant-requests', 'import-variants']) {
    const result = await call(`projects/Miko-qipao/${action}`, {});
    expect(result.status).toBe(403); expect(result.json).toMatchObject({ error: expect.stringContaining('playback-only') });
  }
  expect((await call('projects/Miko-qipao/built/base.png')).status).toBe(200);
});

test('Studio normalizes a custom source path without changing image bytes', async () => {
  const files = unpackAvatar(sharedArchive);
  const source = files['source.png']; delete files['source.png'];
  const manifest = JSON.parse(new TextDecoder().decode(files['avatar.json']));
  files['avatar.json'] = new TextEncoder().encode(JSON.stringify({ ...manifest, name: '../../中文', source: 'original/絵.png' }));
  files['original/絵.png'] = source;
  const imported = await call('import', zipSync(files, { level: 0 }));
  expect(imported.status).toBe(200); expect(imported.json).toMatchObject({ name: 'avatar', hasSource: true });
  expectSameBytes((await call('projects/avatar/source.png')).bytes, source, 'served source.png');
  expectSameBytes(await readFile(resolve(root, 'projects/avatar/source.png')), source, 'saved source.png');
  expect(JSON.parse(await readFile(resolve(root, 'projects/avatar/avatar.json'), 'utf8')).source).toBe('source.png');
  const editable = unpackAvatar((await call('export', { project: 'avatar' })).bytes);
  expectSameBytes(editable['source.png'], source, 'exported source.png'); expect(editable['original/絵.png']).toBeUndefined();
  const noSource = unpackAvatar((await call('export', { project: 'avatar', includeSource: false })).bytes);
  expect(noSource['source.png']).toBeUndefined();
  expect(noSource['original/絵.png']).toBeUndefined();
  expect(JSON.parse(new TextDecoder().decode(noSource['avatar.json'])).source).toBeUndefined();
});

test('invalid archives return validator errors without creating projects', async () => {
  const valid = unpackAvatar(sharedArchive);
  const cases: [Record<string, Uint8Array>, string][] = [
    [{ ...valid, '../escape.txt': new Uint8Array([1]) }, 'path must be relative'],
    [{ ...valid, '/absolute.txt': new Uint8Array([1]) }, 'path must be relative'],
    [{ ...valid, './rig.json': valid['rig.json'] }, 'invalid filesystem path'],
    [{ ...valid, 'RIG.JSON': valid['rig.json'] }, 'conflicting filesystem path'],
    [{ ...valid, 'rig.json/child': new Uint8Array([1]) }, 'parent is a file'],
    [{ ...valid, 'built/base.png': new Uint8Array() }, 'built/base.png'],
    [{ ...valid, 'rig.json': new TextEncoder().encode('{}') }, 'rig.'],
    [Object.fromEntries(Object.entries(valid).filter(([name]) => name !== 'avatar.json')), 'avatar.json: required'],
  ];
  for (const [files, error] of cases) {
    const result = await call('import', zipSync(files, { level: 0 }));
    expect(result.status, JSON.stringify(result.json)).toBe(400); expect(result.json).toMatchObject({ error: expect.stringContaining(error) });
  }
  expect(await readdir(root)).toEqual(['samples']);
});

test('transfer endpoints enforce request size, origin and physical project boundaries', async () => {
  const bytes = sharedArchive;
  expect((await call('import', bytes, { 'content-length': String(128 * 1024 * 1024 + 1) })).status).toBe(413);
  expect((await call('import', bytes, { origin: 'https://example.com' })).status).toBe(403);
  expect((await call('export', { project: 'sample-miko-qipao' }, { origin: 'https://example.com' })).status).toBe(403);
  expect((await call('export', { project: '../samples/miko-qipao' })).status).toBe(400);
  expect((await call('export', { project: 'sample-miko-qipao', includeSource: 'yes' })).status).toBe(400);
  await mkdir(resolve(root, 'outside')); await symlink(resolve(root, 'outside'), resolve(root, 'projects'));
  expect((await call('import', bytes)).status).toBe(400); expect(await readdir(resolve(root, 'outside'))).toEqual([]);
  const source = resolve(root, 'samples/miko-qipao/source.png'); await rm(source);
  await writeFile(resolve(root, 'outside/source.png'), 'private'); await symlink(resolve(root, 'outside/source.png'), source);
  const failure = await exported(); expect(failure.status).toBe(400); expect(failure.json).toMatchObject({ error: 'Path must stay inside the project.' });
});
