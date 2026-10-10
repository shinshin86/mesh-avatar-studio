import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { readFile, readdir, realpath, stat, writeFile, rename, unlink, mkdir, cp, lstat, rm } from 'node:fs/promises';
import { resolve, relative, extname, sep, isAbsolute } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
// Vite bundles its config before applying aliases, so use the public source entry here.
import { validateRig } from '../../packages/runtime/src/index';
import type { LocalProject, LocalProjectEntry } from '../project-types';
import { decodeVariants, JobError, projectJob, runTool, variantState, VARIANTS, type Runner } from './project-jobs';

const SAMPLE = 'sample-miko-qipao';
const displayPath = (path: string) => path === homedir() ? '~' : path.startsWith(`${homedir()}${sep}`) ? `~${path.slice(homedir().length)}` : path;
const safeName = /^[A-Za-z0-9._-]+$/;
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const inside = (base: string, path: string) => { const rel = relative(base, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
function fileSystemError(root: string, error: unknown, fallback = 'projects') {
  const failure = error as NodeJS.ErrnoException | null;
  if (!failure?.code || !/^E[A-Z0-9]+$/.test(failure.code)) return;
  const code = failure.code;
  const path = typeof failure.path === 'string' && isAbsolute(failure.path) && inside(root, failure.path)
    ? relative(root, failure.path).split(sep).join('/') || '.' : fallback;
  const status = ['EPERM', 'EACCES', 'EROFS'].includes(code) ? 403 : code === 'EBUSY' ? 409 : ['ENOENT', 'ENOTDIR'].includes(code) ? 404 : 500;
  const reason = status === 403 ? 'Permission denied' : status === 409 ? 'File or folder is in use' : status === 404 ? 'Project or file not found' : 'Local project operation failed';
  return { status, body: { error: `${reason} (${code}): ${path}`, code, path } };
}
async function exists(path: string) { try { await stat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
async function checked(base: string, path: string) {
  if (!inside(base, resolve(path)) || !inside(base, await realpath(path))) throw new HttpError(400, 'Path must stay inside the project.');
  return path;
}
export function revealFolder(path: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  return new Promise((done, reject) => execFile(command, [path], error => error ? reject(error) : done()));
}
export function localProjectMiddleware(root: string, reveal = revealFolder, runner: Runner = runTool) {
  root = resolve(root);
  const base = resolve(root, 'projects'), sample = resolve(root, 'samples/miko-qipao');
  const saving = new Set<string>();
  async function readBody(req: IncomingMessage, limit = 1024 * 1024) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(400, 'Send application/json.');
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON.'); }
  }
  async function saveRig(path: string, rig: unknown) {
    const errors = validateRig(rig);
    if (errors.length) throw new HttpError(400, `Invalid rig: ${errors.join(', ')}`);
    const target = resolve(path, 'rig.json'), temporary = resolve(path, `.rig-${randomUUID()}.tmp`), backup = `${temporary}.bak`;
    try {
      if (await exists(target)) {
        const previous = await readFile(await checked(path, target));
        await writeFile(backup, previous, { flag: 'wx' }); await rename(backup, `${target}.bak`);
      }
      await writeFile(temporary, JSON.stringify(rig, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, target);
    } finally { await Promise.all([temporary, backup].map(file => unlink(file).catch(() => undefined))); }
  }
  async function requests(path: string, name: string) {
    const items = [];
    for (const variant of VARIANTS) {
      const prompt = resolve(path, 'variant-requests', variant, 'prompt.md');
      if (await exists(prompt)) {
        await checked(path, resolve(path, 'variant-requests', variant, 'mask.png'));
        items.push({ name: variant, prompt: await readFile(await checked(path, prompt), 'utf8'),
          maskUrl: `/__studio/projects/${encodeURIComponent(name)}/variant-requests/${variant}/mask.png?v=${Date.now()}` });
      }
    }
    return items;
  }
  async function folder(name: string) {
    if (!safeName.test(name) || name === '.' || name === '..' || name.startsWith('.studio-job-')) throw new HttpError(400, 'Invalid project name.');
    const parent = name === SAMPLE ? sample : base;
    const path = name === SAMPLE ? sample : resolve(base, name);
    // The root itself and every nested symlink must stay under the intended physical folder.
    if (await realpath(parent) !== parent) throw new HttpError(400, 'Project root cannot redirect elsewhere.');
    await checked(parent, path);
    if (!(await stat(path)).isDirectory()) throw new HttpError(404, 'Project not found.');
    return path;
  }
  async function info(name: string): Promise<LocalProject | null> {
    const path = await folder(name), rigPath = resolve(path, 'rig.json');
    const draft = resolve(path, 'rig.draft.json');
    if (!await exists(rigPath) && !(await exists(draft) && await exists(resolve(path, 'built')))) return null;
    const file = await checked(path, await exists(rigPath) ? rigPath : draft);
    return { name, relativePath: relative(root, path).split(sep).join('/'), absolutePath: path, displayPath: displayPath(path),
      rigFile: await exists(rigPath) ? 'rig.json' : 'rig.draft.json',
      updatedAt: (await stat(file)).mtime.toISOString(), hasSprites: await exists(resolve(path, 'built/sprites/sprites.json')),
      hasVariants: await exists(resolve(path, 'variants')), readOnly: name === SAMPLE };
  }
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/__studio/')) { next(); return; }
    const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    let errorPath = 'projects';
    try {
      // Reject cross-origin browser requests, including writes triggered by another website.
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Use the local studio origin.');
      const host = req.headers.host?.split(':')[0];
      if (host !== '127.0.0.1' && host !== 'localhost') throw new HttpError(403, 'Local requests only.');
      const raw = req.url.split('?')[0].slice('/__studio/'.length).split('/');
      const parts = raw.map(part => {
        let value; try { value = decodeURIComponent(part); } catch { throw new HttpError(400, 'Invalid path encoding.'); }
        if (!safeName.test(value) || value === '.' || value === '..') throw new HttpError(400, 'Invalid path segment.');
        return value;
      });
      if (parts.length === 1 && parts[0] === 'context' && req.method === 'GET') { json(200, { rootPath: root, displayRootPath: displayPath(root) }); return; }
      if (parts.length === 1 && parts[0] === 'reveal' && req.method === 'POST') { await reveal(root); json(200, { path: root }); return; }
      if (parts.length === 1 && parts[0] === 'copy-sample' && req.method === 'POST') {
        const rig = await readBody(req), errors = validateRig(rig);
        if (errors.length) throw new HttpError(400, `Invalid rig: ${errors.join(', ')}`);
        await folder(SAMPLE);
        await mkdir(base, { recursive: true });
        if (await realpath(base) !== base) throw new HttpError(400, 'Project root cannot redirect elsewhere.');
        let name = 'miko-qipao-copy', path = resolve(base, name);
        for (let index = 1; ; index++) {
          try { await mkdir(path); break; }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            name = `miko-qipao-copy-${index}`; path = resolve(base, name);
          }
        }
        try {
          // The name is reserved with an exclusive mkdir above, so the target is a fresh empty
          // folder; copy into it without errorOnExist, which Node 24+ throws for that very folder.
          await cp(sample, path, { recursive: true, force: false, filter: async source => {
            if ((await lstat(source)).isSymbolicLink()) throw new HttpError(400, 'Sample contains redirected files.');
            return true;
          } });
          await saveRig(path, rig);
          json(200, await info(name));
        } catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
        return;
      }
      if (parts[0] !== 'projects') throw new HttpError(404, 'Not found.');
      if (parts.length === 1 && req.method === 'GET') {
        if (await exists(base) && await realpath(base) !== base) throw new HttpError(400, 'Project root cannot redirect elsewhere.');
        const entries = await exists(base) ? await readdir(base, { withFileTypes: true }) : [];
        const list: LocalProjectEntry[] = [];
        const add = async (name: string, isSample = false) => {
          try {
            if (isSample && (!await exists(resolve(sample, 'source.png')) || !await exists(resolve(sample, 'built/base.png')))) return;
            const value = await info(name); if (value) list.push(value);
          } catch (error) {
            if (error instanceof HttpError) return;
            const relativePath = isSample ? 'samples/miko-qipao' : `projects/${name}`;
            const failure = fileSystemError(root, error, relativePath);
            if (!failure) throw error;
            // A folder removed during the scan is no longer a project.
            if (failure.body.code === 'ENOENT') return;
            list.push({ name, relativePath, readOnly: isSample, error: { code: failure.body.code, path: failure.body.path } });
          }
        };
        for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.') && safeName.test(entry.name) && entry.name !== SAMPLE) {
          await add(entry.name);
        }
        await add(SAMPLE, true);
        list.sort((a, b) => (b.error ? '' : b.updatedAt).localeCompare(a.error ? '' : a.updatedAt));
        json(200, list); return;
      }
      if (parts.length < 3) throw new HttpError(404, 'Not found.');
      errorPath = parts[1] === SAMPLE ? 'samples/miko-qipao' : `projects/${parts[1]}`;
      const name = parts[1], path = await folder(name), tail = parts.slice(2);
      if (req.method === 'POST' && tail.length === 1 && tail[0] === 'reveal') {
        await reveal(path); json(200, { path }); return;
      }
      if (req.method === 'GET' && tail.length === 1 && tail[0] === 'variants') {
        const manifest = resolve(path, 'built/sprites/sprites.json'); if (await exists(manifest)) await checked(path, manifest);
        json(200, { variants: await variantState(path), requests: await requests(path, name) }); return;
      }
      if (req.method === 'POST' && tail.length === 1 && ['rig', 'rebuild', 'variant-requests', 'import-variants'].includes(tail[0])) {
        if (name === SAMPLE) throw new HttpError(403, 'The sample is read-only.');
        const action = tail[0], body = await readBody(req, action === 'import-variants' ? 36 * 1024 * 1024 : 1024 * 1024);
        let files: ReturnType<typeof decodeVariants> = [];
        if (action === 'import-variants') { try { files = decodeVariants(body); } catch (error) { throw new HttpError(400, (error as Error).message); } }
        if (saving.has(path)) throw new HttpError(409, 'A project operation is already in progress.');
        saving.add(path);
        try {
          if (action === 'rig') { await saveRig(path, body); json(200, { path: relative(root, resolve(path, 'rig.json')).split(sep).join('/') }); }
          else {
            if (action === 'rebuild' || action === 'variant-requests') await saveRig(path, body?.rig);
            const result = await projectJob(root, path, action === 'rebuild' ? 'build-layers' : action === 'variant-requests' ? 'variant-requests' : 'build-sprites', files, runner);
            json(200, { ...result, ...(action === 'variant-requests' ? { requests: await requests(path, name) } : {}) });
          }
        } finally { saving.delete(path); }
        return;
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      const fileName = tail.join('/');
      if (!(fileName === 'rig.json' || fileName === 'rig.draft.json' || fileName === 'source.png' || ['built', 'variants'].includes(tail[0]) || (tail.length === 3 && tail[0] === 'variant-requests' && VARIANTS.includes(tail[1] as typeof VARIANTS[number]) && tail[2] === 'mask.png'))) throw new HttpError(404, 'File not available.');
      const mime: Record<string, string> = { '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
      const contentType = mime[extname(fileName)];
      if (!contentType) throw new HttpError(404, 'File not available.');
      const file = await checked(path, resolve(path, ...tail));
      const bytes = await readFile(file);
      res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(bytes);
    } catch (error) {
      if (error instanceof JobError) { json(422, { error: error.code, code: error.code, log: error.log }); return; }
      const failure = fileSystemError(root, error, errorPath);
      if (failure) { json(failure.status, failure.body); return; }
      const status = error instanceof HttpError ? error.status : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
      json(status, { error: error instanceof HttpError ? error.message : status === 404 ? 'Project or file not found.' : 'Local project operation failed.' });
    }
  };
}
export function localProjectsPlugin(root: string): Plugin {
  const base = resolve(root, 'projects');
  const variantProject = (file: string) => {
    const parts = relative(base, file).split(sep);
    if (!safeName.test(parts[0]) || parts[0].startsWith('.') || parts[0] === SAMPLE) return;
    if (parts[1] === 'variants' || (parts[1] === 'built' && parts[2] === 'sprites')) return parts[0];
  };
  return { name: 'local-studio-projects', apply: 'serve', config(config) {
    if (config.server?.watch === null) return;
    // Configure this before Vite starts watching the root, not only after add().
    return { server: { watch: { ignored: [(file: string) => inside(base, file) && relative(base, file).split(sep).some(part => part.startsWith('.'))] } } };
  }, configureServer(server) {
    server.middlewares.use(localProjectMiddleware(root));
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const changed = (file: string) => {
      const name = variantProject(file);
      if (!name) return;
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(() => {
        timers.delete(name);
        server.ws.send({ type: 'custom', event: 'studio:variants-changed', data: { name } });
      }, 800));
    };
    server.watcher.on('error', error => {
      const failure = fileSystemError(root, error);
      server.config.logger.warn(`[local-studio-projects] Watch error: ${failure?.body.error ?? 'File watcher failed.'}`);
    });
    server.watcher.add(base);
    server.watcher.on('all', (_event, file) => changed(file));
    server.httpServer?.once('close', () => { for (const timer of timers.values()) clearTimeout(timer); });
  }, handleHotUpdate(context) {
    // Only the current project's assets change; keep the editor and its history mounted.
    if (variantProject(context.file)) return [];
  } };
}
