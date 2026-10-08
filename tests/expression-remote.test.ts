import { expect, test } from 'vitest';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { expressionRemote } from '../src/server/expression-remote';
import { REMOTE_EXPRESSIONS, expressionMessage } from '../src/live/expression-protocol';
import { OVERLAY_EXPRESSIONS } from '../src/engine/expression-overlay.js';

async function call(handler: ReturnType<typeof expressionRemote>, method: string, url: string, headers: Record<string, string> = {}, body = '') {
  const req = Object.assign(Readable.from(body ? [Buffer.from(body)] : []), { method, url, headers }) as unknown as IncomingMessage;
  let status = 0, payload = '', head: Record<string, string> = {}, passed = false;
  const res = { writeHead: (s: number, h: Record<string, string>) => { status = s; head = h; }, end: (b: string) => { payload = b; } } as unknown as ServerResponse;
  await handler(req, res, () => { passed = true; });
  return { status, head, passed, json: payload ? JSON.parse(payload) : null };
}

test('the remote accepts the same expressions as the Live page', () => {
  expect([...REMOTE_EXPRESSIONS]).toEqual(Object.keys(OVERLAY_EXPRESSIONS));
  expect(expressionMessage({ expression: 'smile' })).toEqual({ expression: 'smile', project: null });
  for (const bad of [null, [], 'smile', { expression: 'constructor' }, { expression: 'smile', x: 1 }, { expression: 'smile', project: '../a' }, { expression: 'smile', project: 3 }]) expect(expressionMessage(bad)).toBeNull();
});

test('token is private, persistent and regenerable; requests need it and a valid body', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'expr-')), file = join(dir, 'nested', '.expression-token'), sent: unknown[] = [];
  const handler = expressionRemote(file, message => sent.push(message));
  expect((await call(handler, 'GET', '/other')).passed).toBe(true);
  expect((await call(handler, 'GET', '/__live/expression-token')).status).toBe(403);
  const first = await call(handler, 'GET', '/__live/expression-token', { 'x-studio-request': '1' });
  expect(first.status).toBe(200); expect(first.head['access-control-allow-origin']).toBeUndefined();
  const token = first.json.token as string;
  expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect((await readFile(file, 'utf8')).trim()).toBe(token); expect((await stat(file)).mode & 0o777).toBe(0o600);
  // A fresh server instance reuses the saved token.
  const again = expressionRemote(file, () => undefined);
  expect((await call(again, 'GET', '/__live/expression-token', { 'x-studio-request': '1' })).json.token).toBe(token);

  const post = (headers: Record<string, string>, body: string) => call(handler, 'POST', '/__live/expression', { 'content-type': 'application/json', ...headers }, body);
  expect((await post({}, '{"expression":"smile"}')).status).toBe(401);
  expect((await post({ 'x-studio-token': `${token}x` }, '{"expression":"smile"}')).status).toBe(401);
  expect((await call(handler, 'GET', '/__live/expression', { 'x-studio-token': token })).status).toBe(405);
  expect((await post({ 'x-studio-token': token }, 'not json')).status).toBe(400);
  expect((await post({ 'x-studio-token': token }, JSON.stringify({ expression: 'smile', pad: 'x'.repeat(2000) }))).status).toBe(413);
  expect((await post({ 'x-studio-token': token }, '{"expression":"smile","project":"demo"}')).status).toBe(200);
  expect(sent).toEqual([{ expression: 'smile', project: 'demo' }]);
  expect((await post({ authorization: `Bearer ${token}` }, '{"expression":"wink"}')).status).toBe(429);

  const renewed = await call(handler, 'POST', '/__live/expression-token', { 'x-studio-request': '1' });
  expect(renewed.json.token).not.toBe(token);
  await new Promise(resolve => setTimeout(resolve, 60));
  expect((await post({ 'x-studio-token': token }, '{"expression":"wink"}')).status).toBe(401);
  expect((await post({ authorization: `Bearer ${renewed.json.token}` }, '{"expression":"wink"}')).status).toBe(200);

  // A corrupted token file is replaced instead of trusted.
  await writeFile(file, 'short\n');
  const fresh = await call(expressionRemote(file, () => undefined), 'GET', '/__live/expression-token', { 'x-studio-request': '1' });
  expect(fresh.json.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
});
