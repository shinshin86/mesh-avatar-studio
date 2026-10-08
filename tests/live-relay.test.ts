import { expect, test, vi } from 'vitest';
import type { ViteDevServer, WebSocketClient } from 'vite';
import { LIVE_EVENT, liveMessage, LivePose } from '../src/live/protocol';
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
