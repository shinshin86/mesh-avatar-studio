import { afterEach, expect, test, vi } from 'vitest';
import { LivePose } from '../src/live/protocol';

const state = vi.hoisted(() => ({
  beforeFrame: undefined as undefined | ((avatar: unknown, now: number, dt: number) => void),
  receivePose: undefined as undefined | ((data: unknown) => void),
  receiveExpression: undefined as undefined | ((data: unknown) => void),
}));
vi.mock('../src/live/avatar-view', () => ({
  neutralParameters: { angleY: 0, eyeROpen: 1 },
  createAvatarView: vi.fn((_canvas, _settings, beforeFrame) => {
    state.beforeFrame = beforeFrame;
    return new Promise(() => {});
  }),
}));
vi.mock('../src/live/relay', () => ({
  receiveLiveParameters: (receive: (data: unknown) => void) => { state.receivePose = receive; return vi.fn(); },
  receiveLiveExpression: (receive: (data: unknown) => void) => { state.receiveExpression = receive; return vi.fn(); },
  receiveLighting: () => vi.fn(), receiveOverlays: () => vi.fn(),
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

test('stream selects sprites without reapplying expressions to final Live numbers', async () => {
  const canvas = { dataset: {} as Record<string, string> };
  vi.stubGlobal('location', { search: '?project=test&idle=0' });
  vi.stubGlobal('document', { documentElement: { style: {} }, querySelector: () => canvas });
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  await import('../src/live/stream');
  const avatar = { setExpression: vi.fn(), setAutoIdle: vi.fn(), setAutoMotion: vi.fn(), setParameters: vi.fn() };
  const message = { project: 'test', expression: 'sad', sender: 'aaaaaaaa' };
  state.receiveExpression!(message);
  state.receivePose!({ project: 'test', sender: message.sender, params: { angleY: -6, eyeROpen: 0.72 }, t: 0 });
  state.beforeFrame!(avatar, 0, 0.016);
  expect(avatar.setExpression).toHaveBeenLastCalledWith('sad', { parameters: false });
  expect(avatar.setParameters).toHaveBeenLastCalledWith({ angleY: -6, eyeROpen: 0.72 });
  expect(canvas.dataset.expression).toBe('sad');
  clock.mockReturnValue(1001);
  state.beforeFrame!(avatar, 1001, 0.016);
  expect(avatar.setExpression).toHaveBeenLastCalledWith('neutral', { parameters: false });
  expect(canvas.dataset.live).toBe('idle');
  // The shared receiver also rejects a second page's expression while its pose owner is alive.
  const pose = new LivePose('test');
  pose.receive({ project: 'test', params: { angleY: 2 }, t: 0, sender: 'bbbbbbbb' }, 0);
  expect(pose.receiveExpression(message, 1)).toBe(false);
});


test('an idle neutral Live page cannot block tracking or renew sender ownership', () => {
  const pose = new LivePose('test');
  const neutral = (sender: string) => ({ project: 'test', expression: 'neutral', sender });
  const tracked = (sender: string) => ({ project: 'test', params: { angleY: 12 }, t: 0, sender });
  // Page A is opened first and keeps announcing neutral with its camera off.
  for (let now = 0; now <= 1000; now += 250) expect(pose.receiveExpression(neutral('aaaaaaaa'), now)).toBe(false);
  expect(pose.receive(tracked('bbbbbbbb'), 1001)).toBe(true);
  expect(pose.sample(1001, 0.016).params.angleY).toBe(12);
  expect(pose.receiveExpression(neutral('aaaaaaaa'), 1100)).toBe(false);
  expect(pose.receiveExpression({ ...neutral('bbbbbbbb'), expression: 'sad' }, 1200)).toBe(true);
  // The followed page can clear its expression immediately, without extending its lease.
  for (let now = 1250; now <= 2250; now += 250) expect(pose.receiveExpression(neutral('bbbbbbbb'), now)).toBe(true);
  expect(pose.sampleExpression(2250)).toBe('neutral');
  expect(pose.receive(tracked('aaaaaaaa'), 2251)).toBe(true);
  expect(pose.receiveExpression({ ...neutral('bbbbbbbb'), expression: 'sad' }, 2252)).toBe(false);
  expect(pose.sampleExpression(2252)).toBe('neutral');
});
