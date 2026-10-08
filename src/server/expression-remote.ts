import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { EXPRESSION_PATH, EXPRESSION_TOKEN_PATH, TOKEN_HEADER, expressionMessage, type ExpressionMessage } from '../live/expression-protocol';

const MAX_BODY = 1024, MIN_INTERVAL_MS = 50;
const newToken = () => randomBytes(24).toString('base64url');

/**
 * Lets keyboard-shortcut and button-panel apps on this machine switch the Live page's expression.
 * Requests need the token shown on the Live page. No CORS headers are sent, so other websites can
 * neither read the token nor send the custom token header.
 */
export function expressionRemote(tokenFile: string, broadcast: (message: ExpressionMessage) => void) {
  let token: string | null = null, last = -Infinity;
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
    const path = req.url?.split('?')[0];
    if (path !== EXPRESSION_PATH && path !== EXPRESSION_TOKEN_PATH) { next(); return; }
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
      const message = expressionMessage(data);
      if (!message) { json(res, 400, { error: 'Send {"expression": "smile"} with a known expression.' }); return; }
      const now = performance.now();
      if (now - last < MIN_INTERVAL_MS) { json(res, 429, { error: 'Too many requests.' }); return; }
      last = now; broadcast(message);
      json(res, 200, { ok: true, expression: message.expression });
    } catch { json(res, 500, { error: 'Expression switch failed.' }); }
  };
}
