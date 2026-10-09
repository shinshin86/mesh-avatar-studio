import { expect, test } from 'vitest';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { expressionRemote } from '../src/server/expression-remote';
import { REMOTE_EXPRESSIONS, expressionMessage, lightingPresetMessage } from '../src/live/expression-protocol';
import { DEFAULT_LIGHTING } from '../src/lighting/settings';
import { parseLightingPresets, sameLighting } from '../src/lighting/presets';
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
  const handler = expressionRemote(file, message => sent.push(message), () => undefined);
  expect((await call(handler, 'GET', '/other')).passed).toBe(true);
  expect((await call(handler, 'GET', '/__live/expression-token')).status).toBe(403);
  const first = await call(handler, 'GET', '/__live/expression-token', { 'x-studio-request': '1' });
  expect(first.status).toBe(200); expect(first.head['access-control-allow-origin']).toBeUndefined();
  const token = first.json.token as string;
  expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect((await readFile(file, 'utf8')).trim()).toBe(token); expect((await stat(file)).mode & 0o777).toBe(0o600);
  // A fresh server instance reuses the saved token.
  const again = expressionRemote(file, () => undefined, () => undefined);
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
  const fresh = await call(expressionRemote(file, () => undefined, () => undefined), 'GET', '/__live/expression-token', { 'x-studio-request': '1' });
  expect(fresh.json.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
});

test('lighting preset requests accept only preset numbers 1 to 8', () => {
  expect(lightingPresetMessage({ preset: 1 })).toEqual({ preset: 1, project: null });
  expect(lightingPresetMessage({ preset: 8, project: 'demo' })).toEqual({ preset: 8, project: 'demo' });
  for (const bad of [null, [], 3, { preset: 0 }, { preset: 9 }, { preset: 1.5 }, { preset: '1' }, { preset: 1, x: 1 }, { preset: 1, project: '../a' }, { expression: 'smile' }]) expect(lightingPresetMessage(bad)).toBeNull();
});

test('lighting presets use the expression token and their own rate limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'preset-')), file = join(dir, '.expression-token'), expressions: unknown[] = [], presets: unknown[] = [];
  const handler = expressionRemote(file, message => expressions.push(message), message => presets.push(message));
  const token = (await call(handler, 'GET', '/__live/expression-token', { 'x-studio-request': '1' })).json.token as string;
  const post = (path: string, headers: Record<string, string>, body: string) => call(handler, 'POST', path, headers, body);
  expect((await post('/__live/lighting', {}, '{"preset":2}')).status).toBe(401);
  expect((await call(handler, 'GET', '/__live/lighting', { 'x-studio-token': token })).status).toBe(405);
  const bad = await post('/__live/lighting', { 'x-studio-token': token }, '{"preset":9}');
  expect(bad.status).toBe(400); expect(bad.json.error).toMatch(/preset/);
  expect((await post('/__live/lighting', { 'x-studio-token': `${token}x` }, '{"preset":2}')).status).toBe(401);
  const ok = await post('/__live/lighting', { 'x-studio-token': token }, '{"preset":2,"project":"demo"}');
  expect(ok.status).toBe(200); expect(ok.json).toEqual({ ok: true, preset: 2 });
  // One shortcut may switch an expression and a preset together.
  expect((await post('/__live/expression', { 'x-studio-token': token }, '{"expression":"sad"}')).json).toEqual({ ok: true, expression: 'sad' });
  expect((await post('/__live/lighting', { authorization: `Bearer ${token}` }, '{"preset":3}')).status).toBe(429);
  expect(presets).toEqual([{ preset: 2, project: 'demo' }]); expect(expressions).toEqual([{ expression: 'sad', project: null }]);
});

test('stored lighting presets keep eight slots and drop invalid entries', () => {
  const red = { ...DEFAULT_LIGHTING, enabled: true, color: 0xff2000, y: 0.95 };
  const presets = parseLightingPresets([red, null, { ...red, mode: 'glow' }, 'x', { color: 0x00ff00 }]);
  expect(presets).toHaveLength(8);
  expect(presets[0]).toEqual(red); expect(presets[1]).toBeNull(); expect(presets[2]).toBeNull(); expect(presets[3]).toBeNull();
  // Presets saved before newer options existed take defaults for the missing ones.
  expect(presets[4]).toEqual({ ...DEFAULT_LIGHTING, color: 0x00ff00 });
  expect(presets.slice(5)).toEqual([null, null, null]);
  expect(parseLightingPresets({ 0: red })).toEqual(Array(8).fill(null));
  expect(sameLighting(red, { ...red })).toBe(true); expect(sameLighting(red, { ...red, x: 0.3 })).toBe(false);
});
