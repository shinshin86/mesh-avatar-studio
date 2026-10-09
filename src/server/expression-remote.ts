import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { EXPRESSION_PATH, EXPRESSION_TOKEN_PATH, LIGHTING_PRESET_PATH, TOKEN_HEADER, expressionMessage, lightingPresetMessage,
  type ExpressionMessage, type LightingPresetMessage } from '../live/expression-protocol';

const MAX_BODY = 1024, MIN_INTERVAL_MS = 50;
const newToken = () => randomBytes(24).toString('base64url');

/**
 * Lets keyboard-shortcut and button-panel apps on this machine switch the Live page's expression
 * and lighting preset. Requests need the token shown on the Live page. No CORS headers are sent,
 * so other websites can neither read the token nor send the custom token header.
 */
export function expressionRemote(tokenFile: string, broadcast: (message: ExpressionMessage) => void,
  broadcastPreset: (message: LightingPresetMessage) => void) {
  let token: string | null = null;
  // Each route validates a body and returns what to broadcast and reply, or null. Routes keep
  // separate rate limits so one shortcut can switch an expression and a preset together.
  const route = <T,>(parse: (data: unknown) => T | null, send: (message: T) => void, reply: (message: T) => object, invalid: string) => ({
    last: -Infinity, invalid,
    accept: (data: unknown) => { const message = parse(data); return message && { send: () => send(message), reply: reply(message) }; },
  });
  const routes: Record<string, ReturnType<typeof route>> = {
    [EXPRESSION_PATH]: route(expressionMessage, broadcast, m => ({ expression: m.expression }), 'Send {"expression": "smile"} with a known expression.'),
    [LIGHTING_PRESET_PATH]: route(lightingPresetMessage, broadcastPreset, m => ({ preset: m.preset }), 'Send {"preset": 1} with a preset number from 1 to 8.'),
  };
  const load = async () => {
    if (token) return token;
    try { const saved = (await readFile(tokenFile, 'utf8')).trim(); if (/^[A-Za-z0-9_-]{32}$/.test(saved)) return (token = saved); } catch { /* Created below. */ }
    return save(newToken());
  };
  const save = async (value: string) => {
    await mkdir(dirname(tokenFile), { recursive: true });
    await writeFile(tokenFile, `${value}\n`, { mode: 0o600 }); await chmod(tokenFile, 0o600);
    return (token = value);
  };
  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage) => new Promise<string | null>(resolve => {
    let size = 0; const chunks: Buffer[] = [];
    // Oversized bodies are drained and dropped so the response can still be written.
    req.on('data', (chunk: Buffer) => { size += chunk.length; if (size <= MAX_BODY) chunks.push(chunk); });
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
  const matches = (given: string | string[] | undefined, expected: string) => {
    const header = Array.isArray(given) ? given[0] : given ?? '';
    const value = header.startsWith('Bearer ') ? header.slice(7) : header;
    const a = Buffer.from(value), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = req.url?.split('?')[0] ?? '';
    const target = Object.hasOwn(routes, path) ? routes[path] : null;
    if (!target && path !== EXPRESSION_TOKEN_PATH) { next(); return; }
    try {
      if (path === EXPRESSION_TOKEN_PATH) {
        // Only the Live page itself reads or renews the token: a browser sends this custom header
        // cross-site only after a CORS preflight, which this server never approves.
        if (req.headers['x-studio-request'] !== '1') { json(res, 403, { error: 'Forbidden.' }); return; }
        if (req.method === 'GET') { json(res, 200, { token: await load(), path: EXPRESSION_PATH }); return; }
        if (req.method === 'POST') { json(res, 200, { token: await save(newToken()), path: EXPRESSION_PATH }); return; }
        json(res, 405, { error: 'Method not allowed.' }, { allow: 'GET, POST' }); return;
      }
      if (req.method !== 'POST') { json(res, 405, { error: 'Use POST.' }, { allow: 'POST' }); return; }
      if (!matches(req.headers[TOKEN_HEADER] ?? req.headers.authorization, await load())) { json(res, 401, { error: 'Missing or wrong token.' }); return; }
      const body = await readBody(req);
      if (body === null) { json(res, 413, { error: 'Request too large.' }); return; }
      let data: unknown; try { data = JSON.parse(body); } catch { data = null; }
      const accepted = target!.accept(data);
      if (!accepted) { json(res, 400, { error: target!.invalid }); return; }
      const now = performance.now();
      if (now - target!.last < MIN_INTERVAL_MS) { json(res, 429, { error: 'Too many requests.' }); return; }
      target!.last = now; accepted.send();
      json(res, 200, { ok: true, ...accepted.reply });
    } catch { json(res, 500, { error: 'Switch failed.' }); }
  };
}
