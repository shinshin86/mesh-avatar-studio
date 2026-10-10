import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createServer, resolveConfig, type ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fixture from '../samples/miko-qipao/rig.json';
import { localProjectMiddleware, localProjectsPlugin } from '../src/server/local-projects';

const failure = vi.hoisted(() => ({ operation: '', path: '', code: '' }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const methods = ['realpath', 'stat', 'readdir', 'readFile'] as const;
  return { ...actual, ...Object.fromEntries(methods.map(method => [method, async (...args: unknown[]) => {
    if (failure.operation === method && String(args[0]) === failure.path) {
      throw Object.assign(new Error(`Private filesystem details: ${failure.path}`), { code: failure.code, path: failure.path });
    }
    return Reflect.apply(actual[method], actual, args);
  }])) };
});

let root: string;
beforeEach(async () => {
  const scratch = resolve('projects'); await mkdir(scratch, { recursive: true });
  root = await mkdtemp(join(scratch, '.local-api-test-'));
  for (const path of ['projects/nova/built/sprites', 'projects/nova/variants', 'samples/miko-qipao/built']) await mkdir(resolve(root, path), { recursive: true });
  for (const path of ['projects/nova', 'samples/miko-qipao']) {
    await writeFile(resolve(root, path, 'rig.json'), JSON.stringify(fixture));
    await writeFile(resolve(root, path, 'source.png'), 'synthetic image bytes');
    await writeFile(resolve(root, path, 'built/base.png'), 'synthetic base bytes');
  }
  await writeFile(resolve(root, 'projects/nova/built/sprites/sprites.json'), '{}');
});
afterEach(async () => { failure.operation = ''; vi.useRealTimers(); await rm(root, { recursive: true, force: true }); });

async function call(path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, reveal = vi.fn(async (_path: string) => { void _path; })) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as IncomingMessage;
  request.url = path; request.method = method;
  request.headers = { host: '127.0.0.1:5173', 'content-type': 'application/json', ...headers };
  const result = { status: 0, body: '', headers: {} as Record<string, string> };
  const response = {
    writeHead(status: number, values: Record<string, string>) { result.status = status; result.headers = values; },
    end(value: string | Buffer) { result.body = String(value); },
  } as unknown as ServerResponse;
  await localProjectMiddleware(root, reveal)(request, response, () => { result.status = 404; });
  return result;
}

test('lists eligible projects and the read-only installed sample, and serves project images', async () => {
  await mkdir(resolve(root, 'projects/unbuilt'), { recursive: true });
  await writeFile(resolve(root, 'projects/unbuilt/rig.draft.json'), '{}');
  await mkdir(resolve(root, 'projects/draft/built'), { recursive: true });
  await writeFile(resolve(root, 'projects/draft/rig.draft.json'), '{}');
  const response = await call('/__studio/projects'); expect(response.status).toBe(200);
  const list = JSON.parse(response.body);
  expect(list.map((item: { name: string }) => item.name).sort()).toEqual(['draft', 'nova', 'sample-miko-qipao']);
  expect(list.find((item: { name: string }) => item.name === 'nova')).toMatchObject({ relativePath: 'projects/nova', absolutePath: resolve(root, 'projects/nova'), displayPath: resolve(root, 'projects/nova').replace(homedir(), '~'), hasSprites: true, hasVariants: true, readOnly: false });
  expect(list.find((item: { name: string }) => item.name === 'sample-miko-qipao').readOnly).toBe(true);
  expect(JSON.parse((await call('/__studio/context')).body)).toEqual({ rootPath: root, displayRootPath: root.replace(homedir(), '~') });
  const image = await call('/__studio/projects/nova/built/base.png');
  expect(image.status).toBe(200); expect(image.body).toBe('synthetic base bytes'); expect(image.headers['Content-Type']).toBe('image/png');
  expect((await call('/__studio/projects/nova/rig.json.bak')).status).toBe(404);
});

test('rejects raw and encoded traversal, absolute paths, malformed encoding and symlink escapes', async () => {
  for (const tail of ['../rig.json', './rig.json', '%2e%2e/rig.json', '%2Fprivate/rig.json', 'nova%2F..%2Fother/rig.json', 'nova%5Cother/rig.json', '%252e%252e/rig.json', 'C%3A/rig.json', '%/rig.json', 'nova/built/../../rig.json']) {
    expect((await call(`/__studio/projects/${tail}`)).status, tail).toBe(400);
    expect((await call(`/__studio/projects/${tail}`, 'POST', fixture)).status, tail).toBe(400);
  }
  await mkdir(resolve(root, 'outside'), { recursive: true });
  await writeFile(resolve(root, 'outside/secret.png'), 'private');
  await symlink(resolve(root, 'outside'), resolve(root, 'projects/redirect'));
  await symlink(resolve(root, 'outside/secret.png'), resolve(root, 'projects/nova/built/escape.png'));
  expect((await call('/__studio/projects/redirect/source.png')).status).toBe(400);
  expect((await call('/__studio/projects/nova/built/escape.png')).status).toBe(400);
  expect((await call('/__studio/projects/redirect/rig', 'POST', fixture)).status).toBe(400);
});

test('serves local archive files and manifests but refuses redirected archives', async () => {
  await writeFile(resolve(root, 'projects/avatar.mavatar'), 'stored zip bytes');
  const result = await call('/__studio/projects/avatar.mavatar');
  expect(result.status).toBe(200);
  expect(result.headers['Content-Type']).toBe('application/octet-stream');
  expect(result.body).toBe('stored zip bytes');
  await writeFile(resolve(root, 'projects/nova/avatar.json'), '{"name":"Nova"}');
  expect((await call('/__studio/projects/nova/avatar.json')).status).toBe(200);
  await writeFile(resolve(root, 'outside.mavatar'), 'private');
  await symlink(resolve(root, 'outside.mavatar'), resolve(root, 'projects/redirect.mavatar'));
  expect((await call('/__studio/projects/redirect.mavatar')).status).toBe(400);
  expect((await call('/__studio/projects/avatar.mavatar', 'POST')).status).toBe(404);
});

test('validates before writing and keeps exactly the preceding rig in a one-generation backup', async () => {
  const original = await readFile(resolve(root, 'projects/nova/rig.json'), 'utf8');
  const first = structuredClone(fixture); first.head.cx += 10;
  expect((await call('/__studio/projects/nova/rig', 'POST', first)).status).toBe(200);
  expect(await readFile(resolve(root, 'projects/nova/rig.json.bak'), 'utf8')).toBe(original);
  const second = structuredClone(first); second.head.cx += 10;
  const saved = await call('/__studio/projects/nova/rig', 'POST', second);
  expect(JSON.parse(saved.body)).toEqual({ path: 'projects/nova/rig.json' });
  expect(JSON.parse(await readFile(resolve(root, 'projects/nova/rig.json.bak'), 'utf8'))).toEqual(first);
  expect((await call('/__studio/projects/nova/rig', 'POST', { version: 1 })).status).toBe(400);
  expect(JSON.parse(await readFile(resolve(root, 'projects/nova/rig.json'), 'utf8'))).toEqual(second);
  expect((await call('/__studio/projects/sample-miko-qipao/rig', 'POST', first)).status).toBe(403);
});

test('refuses redirected rig writes and cross-origin operations, and reveals the validated folder', async () => {
  const reveal = vi.fn(async (_path: string) => { void _path; });
  expect((await call('/__studio/projects/nova/reveal', 'POST', {}, {}, reveal)).status).toBe(200);
  expect(reveal).toHaveBeenCalledExactlyOnceWith(resolve(root, 'projects/nova'));
  expect((await call('/__studio/projects/sample-miko-qipao/reveal', 'POST', {}, {}, reveal)).status).toBe(200);
  expect((await call('/__studio/projects/nova/rig', 'POST', fixture, { origin: 'https://example.invalid' })).status).toBe(403);
  expect((await call('/__studio/projects', 'GET', undefined, { host: 'example.invalid' })).status).toBe(403);
  await rm(resolve(root, 'projects/nova/rig.json'));
  await symlink(resolve(root, 'samples/miko-qipao/rig.json'), resolve(root, 'projects/nova/rig.json'));
  expect((await call('/__studio/projects/nova/rig', 'POST', fixture)).status).toBe(400);
});

test('plugin is development-only and has no production or preview middleware hook', () => {
  const plugin = localProjectsPlugin(root);
  expect(plugin.apply).toBe('serve'); expect(plugin.configurePreviewServer).toBeUndefined();
});

for (const operation of ['realpath', 'stat']) for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`lists other projects and an unreadable entry when ${operation} fails with ${code}`, async () => {
    Object.assign(failure, { operation, code, path: resolve(root, 'projects/nova') });
    const response = await call('/__studio/projects');
    expect(response.status).toBe(200);
    const list = JSON.parse(response.body);
    expect(list.find((entry: { name: string }) => entry.name === 'sample-miko-qipao')).toMatchObject({ readOnly: true, hasSprites: false });
    const blocked = list.find((entry: { name: string }) => entry.name === 'nova');
    expect(blocked).toEqual({ name: 'nova', relativePath: 'projects/nova', readOnly: false, error: { code, path: 'projects/nova' } });
    expect(JSON.stringify(blocked)).not.toContain(root);
  });
}

test('a nested file error or unreadable sample does not discard healthy projects', async () => {
  Object.assign(failure, { operation: 'stat', code: 'EACCES', path: resolve(root, 'projects/nova/built/sprites/sprites.json') });
  let list = JSON.parse((await call('/__studio/projects')).body);
  expect(list.find((entry: { name: string }) => entry.name === 'nova').error.path).toBe('projects/nova/built/sprites/sprites.json');
  failure.path = resolve(root, 'samples/miko-qipao/source.png');
  list = JSON.parse((await call('/__studio/projects')).body);
  expect(list.find((entry: { name: string }) => entry.name === 'nova').error).toBeUndefined();
  expect(list.find((entry: { name: string }) => entry.name === 'sample-miko-qipao').error).toEqual({ code: 'EACCES', path: 'samples/miko-qipao/source.png' });
});

for (const [code, status] of [['EPERM', 403], ['EACCES', 403], ['EBUSY', 409], ['ENOENT', 404]] as const) {
  test(`API maps ${code} to ${status} without disclosing absolute paths`, async () => {
    Object.assign(failure, { operation: 'readFile', code, path: resolve(root, 'projects/nova/rig.json') });
    const response = await call('/__studio/projects/nova/rig.json');
    expect(response.status).toBe(status);
    expect(JSON.parse(response.body)).toMatchObject({ code, path: 'projects/nova/rig.json' });
    expect(response.body).not.toContain(root);
    expect(response.body).not.toContain('Private filesystem details');
  });
}

test('a denied projects directory returns a specific error instead of an empty list', async () => {
  Object.assign(failure, { operation: 'readdir', code: 'EACCES', path: resolve(root, 'projects') });
  const response = await call('/__studio/projects');
  expect(response.status).toBe(403);
  expect(JSON.parse(response.body)).toMatchObject({ code: 'EACCES', path: 'projects' });
});

test('errors outside the repository or without a path use a safe project-relative fallback', async () => {
  for (const path of [undefined, resolve(root, '../outside-private-file'), 'C:\\Users\\private-account\\secret', '\\\\host\\private\\secret']) {
    const reveal = vi.fn(async () => { throw Object.assign(new Error('private details'), { code: 'EACCES', path }); });
    const response = await call('/__studio/projects/nova/reveal', 'POST', {}, {}, reveal);
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toEqual({ error: 'Permission denied (EACCES): projects/nova', code: 'EACCES', path: 'projects/nova' });
  }
});

test('watch ignores hidden project paths while preserving existing exclusions and variant reloads after EBUSY', async () => {
  const plugin = localProjectsPlugin(root);
  const config = await resolveConfig({ configFile: false, root, plugins: [plugin], server: { watch: { ignored: ['**/existing-ignore/**'] } } }, 'serve');
  const ignored = config.server.watch?.ignored as (string | ((path: string) => boolean))[];
  expect(ignored).toContain('**/existing-ignore/**');
  const excludes = ignored.find(value => typeof value === 'function') as (path: string) => boolean;
  for (const path of ['projects/.studio-job-123', 'projects/.readme-tmp-123/built/base.png', 'projects/nova/variants/.scratch/image.png']) {
    expect(excludes(resolve(root, path)), path).toBe(true);
  }
  for (const path of ['projects', 'projects/nova/variants/mouth_a.png', 'projects/nova/built/sprites/sprites.json', 'src/editor/App.tsx']) {
    expect(excludes(resolve(root, path)), path).toBe(false);
  }
  vi.useFakeTimers();
  const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
  const send = vi.fn(), warn = vi.fn(), httpServer = new EventEmitter();
  const configure = plugin.configureServer as (server: ViteDevServer) => void;
  configure({ watcher, ws: { send }, config: { logger: { warn } }, middlewares: { use: vi.fn() }, httpServer } as unknown as ViteDevServer);
  expect(() => watcher.emit('error', Object.assign(new Error('private detail'), { code: 'EBUSY', path: resolve(root, 'projects/.studio-job-123') }))).not.toThrow();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('EBUSY'));
  expect(warn.mock.calls[0][0]).not.toContain(root);
  watcher.emit('all', 'change', resolve(root, 'projects/.studio-job-123/variants/mouth_a.png'));
  watcher.emit('all', 'change', resolve(root, 'projects/nova/variants/mouth_a.png'));
  watcher.emit('all', 'change', resolve(root, 'projects/nova/built/sprites/sprites.json'));
  await vi.advanceTimersByTimeAsync(800);
  expect(send).toHaveBeenCalledExactlyOnceWith({ type: 'custom', event: 'studio:variants-changed', data: { name: 'nova' } });
  const response = await call('/__studio/projects'); expect(response.status).toBe(200);
  watcher.emit('all', 'change', resolve(root, 'projects/nova/variants/mouth_a.png'));
  httpServer.emit('close'); await vi.advanceTimersByTimeAsync(800);
  expect(send).toHaveBeenCalledTimes(1);
});

test('the live watcher skips temporary directories and still detects new variants and sprite updates', async () => {
  const stage = resolve(root, 'projects/.studio-job-123');
  await mkdir(resolve(stage, 'built'), { recursive: true });
  await writeFile(resolve(stage, 'built/base.png'), 'scratch');
  const server = await createServer({ configFile: false, root, cacheDir: resolve(root, '.vite'), plugins: [localProjectsPlugin(root)], server: { middlewareMode: true, hmr: false } });
  try {
    await vi.waitFor(() => expect(server.watcher.getWatched()[resolve(root, 'projects/nova/variants')]).toBeDefined());
    expect(Object.keys(server.watcher.getWatched()).some(path => path.includes('.studio-job-123'))).toBe(false);
    const send = vi.spyOn(server.ws, 'send');
    await writeFile(resolve(root, 'projects/nova/variants/mouth_a.png'), 'new variant');
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'custom', event: 'studio:variants-changed', data: { name: 'nova' } }), { timeout: 5000 });
    send.mockClear();
    await writeFile(resolve(root, 'projects/nova/built/sprites/sprites.json'), '{"layers":{}}');
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'custom', event: 'studio:variants-changed', data: { name: 'nova' } }), { timeout: 5000 });
  } finally { await server.close(); }
}, 15_000);


test('sample copies reserve unused names, carry edits and built assets, and reject invalid or redirected sources', async () => {
  const edited = structuredClone(fixture); edited.head.cx += 10;
  const original = await readFile(resolve(root, 'samples/miko-qipao/rig.json'));
  expect((await call('/__studio/copy-sample', 'POST', { version: 1 })).status).toBe(400);
  expect((await call('/__studio/copy-sample', 'POST', edited, { origin: 'https://example.invalid' })).status).toBe(403);
  await mkdir(resolve(root, 'projects/miko-qipao-copy'));
  await writeFile(resolve(root, 'projects/miko-qipao-copy/keep.txt'), 'keep');
  const results = await Promise.all([call('/__studio/copy-sample', 'POST', edited), call('/__studio/copy-sample', 'POST', edited)]);
  expect(results.map(result => result.status)).toEqual([200, 200]);
  const names = results.map(result => JSON.parse(result.body).name).sort();
  expect(names).toEqual(['miko-qipao-copy-1', 'miko-qipao-copy-2']);
  for (const name of names) {
    expect(JSON.parse(await readFile(resolve(root, 'projects', name, 'rig.json'), 'utf8'))).toEqual(edited);
    expect(await readFile(resolve(root, 'projects', name, 'source.png'), 'utf8')).toBe('synthetic image bytes');
    expect(await readFile(resolve(root, 'projects', name, 'built/base.png'), 'utf8')).toBe('synthetic base bytes');
  }
  expect(await readFile(resolve(root, 'samples/miko-qipao/rig.json'))).toEqual(original);
  expect(await readFile(resolve(root, 'projects/miko-qipao-copy/keep.txt'), 'utf8')).toBe('keep');
  await symlink(resolve(root, 'projects/nova'), resolve(root, 'samples/miko-qipao/redirect'));
  expect((await call('/__studio/copy-sample', 'POST', edited)).status).toBe(400);
  expect((await call('/__studio/projects/miko-qipao-copy-3/rig.json')).status).toBe(404);
});
