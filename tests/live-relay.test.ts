import { expect, test, vi } from 'vitest';
import type { ViteDevServer, WebSocketClient } from 'vite';
import { LIVE_EVENT, liveMessage, LivePose, LIVE_EXPRESSION_EVENT, liveExpressionMessage } from '../src/live/protocol';
import { liveRelay } from '../src/server/live-relay';

const message = { project: 'sample-miko-qipao', params: { angleX: 25, mouthOpen: 0.7 }, t: 10 };
test('relay accepts only project names, finite timestamps and known numeric parameters', () => {
  expect(liveMessage(message)).toEqual(message);
  expect(liveMessage({ ...message, params: { angleX: 100, mouthOpen: -1 } })?.params).toEqual({ angleX: 30, mouthOpen: 0 });
  for (const invalid of [null, [], { ...message, project: '../private' }, { ...message, t: NaN },
    { ...message, video: 'data:video' }, { ...message, params: { camera: 1 } },
    { ...message, params: { angleX: '20' } }, { ...message, params: { angleX: Infinity } },
    { ...message, params: {} }]) expect(liveMessage(invalid)).toBeNull();
});
test('stream isolates projects and smoothly returns to idle after one second without updates', () => {
  const pose = new LivePose(message.project);
  expect(pose.receive({ ...message, project: 'another' }, 100)).toBe(false);
  expect(pose.sample(100, 1 / 60).weight).toBe(0);
  expect(pose.receive({ ...message, t: 9e12 }, 100)).toBe(true);
  expect(pose.sample(1100, 1 / 60)).toMatchObject({ active: true, weight: 1 });
  const lost = pose.sample(1101, 1 / 60);
  expect(lost.active).toBe(false); expect(lost.weight).toBeGreaterThan(0.9); expect(lost.weight).toBeLessThan(1);
  for (let i = 0; i < 100; i++) pose.sample(1200 + i * 17, 0.017);
  expect(pose.sample(3000, 0.017).weight).toBe(0);
  pose.receive(message, 3001); expect(pose.sample(3001, 0.017).weight).toBe(1);
});
test('server rebroadcasts validated numbers at most 60 times per second per socket', () => {
  const handlers = new Map<string, (data: unknown, client: WebSocketClient) => void>();
  const send = vi.fn();
  const server = { middlewares: { use: vi.fn() }, ws: { on: (event: string, handler: (data: unknown, client: WebSocketClient) => void) => handlers.set(event, handler), send } } as unknown as ViteDevServer;
  const plugin = liveRelay('/unused');
  if (typeof plugin.configureServer !== 'function') throw new Error('Missing configureServer');
  plugin.configureServer.call({} as never, server);
  const receive = handlers.get(LIVE_EVENT)!, socket = {} as WebSocketClient['socket'];
  const clock = vi.spyOn(performance, 'now');
  try {
    for (let time = 0; time < 1000; time++) {
      clock.mockReturnValue(time);
      receive(message, { socket } as WebSocketClient);
    }
    expect(send.mock.calls.length).toBeGreaterThan(50); expect(send.mock.calls.length).toBeLessThanOrEqual(60);
    expect(send).toHaveBeenLastCalledWith(LIVE_EVENT, message);
    clock.mockReturnValue(2000);
    const count = send.mock.calls.length;
    receive({ ...message, audio: [1, 2] }, { socket } as WebSocketClient);
    expect(send).toHaveBeenCalledTimes(count);
    receive(message, { socket } as WebSocketClient);
    expect(send).toHaveBeenCalledTimes(count + 1);
  } finally { clock.mockRestore(); }
});

test('the stream follows one Live page until it goes quiet, so two open pages do not flicker', () => {
  const pose = new LivePose('p');
  const from = (sender: string, mouthOpen: number) => ({ project: 'p', params: { mouthOpen }, t: 1, sender });
  expect(pose.receive(from('aaaaaaaa', 0.6), 0)).toBe(true);
  expect(pose.receive(from('bbbbbbbb', 0), 16)).toBe(false);
  expect(pose.sample(20, 0.016).params.mouthOpen).toBe(0.6);
  expect(pose.receive(from('aaaaaaaa', 0.5), 33)).toBe(true);
  // After the followed page has been silent for a second, the other page takes over.
  expect(pose.receive(from('bbbbbbbb', 0), 1100)).toBe(true);
  expect(pose.sample(1110, 0.016).params.mouthOpen).toBe(0);
  for (const sender of ['UPPER123', 'short', 'x'.repeat(33), 5]) expect(liveMessage({ ...from('aaaaaaaa', 0), sender })).toBeNull();
  expect(liveMessage({ project: 'p', params: { mouthOpen: 0 }, t: 1 })).toEqual({ project: 'p', params: { mouthOpen: 0 }, t: 1 });
});

const expression = { project: message.project, expression: 'sad', sender: 'aaaaaaaa' };
test('live expression protocol rejects unknown fields, names and invalid identities', () => {
  expect(liveExpressionMessage(expression)).toEqual(expression);
  for (const invalid of [null, [], {}, { ...expression, expression: 'constructor' },
    { ...expression, project: '../private' }, { ...expression, sender: 'short' },
    { ...expression, sender: 123 }, { ...expression, expression: 1 },
    { ...expression, project: null }, { ...expression, params: {} }]) {
    expect(liveExpressionMessage(invalid)).toBeNull();
  }
  expect(liveMessage({ ...message, expression: 'sad' })).toBeNull();
});

test('stream expressions expire on the local clock and share pose sender ownership', () => {
  const pose = new LivePose(message.project);
  expect(pose.sampleExpression(0)).toBe('neutral');
  expect(pose.receiveExpression({ ...expression, project: 'other' }, 0)).toBe(false);
  expect(pose.receive({ ...message, sender: 'bbbbbbbb' }, 0)).toBe(true);
  expect(pose.receiveExpression(expression, 1)).toBe(false);
  expect(pose.receiveExpression({ ...expression, sender: 'bbbbbbbb' }, 2)).toBe(true);
  expect(pose.sampleExpression(1002)).toBe('sad');
  expect(pose.sampleExpression(1003)).toBe('neutral');
  expect(pose.receiveExpression(expression, 1003)).toBe(true);
  expect(pose.sample(1003, 0.016).params).toEqual({});
  expect(pose.receive({ ...message, sender: 'bbbbbbbb' }, 1004)).toBe(false);
  expect(pose.receive({ ...message, sender: 'aaaaaaaa' }, 1004)).toBe(true);
  expect(pose.sampleExpression(1004)).toBe('sad');
  expect(pose.receiveExpression({ ...expression, expression: 'neutral' }, 1005)).toBe(true);
  expect(pose.sampleExpression(1005)).toBe('neutral');
});

test('expression relay validates and throttles each socket independently from poses', () => {
  const handlers = new Map<string, (data: unknown, client: WebSocketClient) => void>();
  const send = vi.fn();
  const server = { middlewares: { use: vi.fn() }, ws: { on: (event: string, handler: (data: unknown, client: WebSocketClient) => void) => handlers.set(event, handler), send } } as unknown as ViteDevServer;
  const plugin = liveRelay('/unused');
  if (typeof plugin.configureServer !== 'function') throw new Error('Missing configureServer');
  plugin.configureServer.call({} as never, server);
  const client = { socket: {} } as WebSocketClient;
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    const receive = handlers.get(LIVE_EXPRESSION_EVENT)!;
    receive({ ...expression, expression: 'unknown' }, client);
    expect(send).not.toHaveBeenCalled();
    receive(expression, client);
    expect(send).toHaveBeenLastCalledWith(LIVE_EXPRESSION_EVENT, expression);
    receive(expression, client); expect(send).toHaveBeenCalledTimes(1);
    receive(expression, { socket: {} } as WebSocketClient); expect(send).toHaveBeenCalledTimes(2);
    handlers.get(LIVE_EVENT)!(message, client); expect(send).toHaveBeenCalledTimes(3);
    clock.mockReturnValue(17); receive(expression, client); expect(send).toHaveBeenCalledTimes(4);
  } finally { clock.mockRestore(); }
});
