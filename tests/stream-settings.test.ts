import { expect, test } from 'vitest';
import { backgroundColor, streamUrl, viewSettings } from '../src/live/settings';
import { overlaysMessage } from '../src/live/overlay-protocol';

test('stream defaults are transparent, contained, idle and use the bundled sample', () => {
  expect(viewSettings('')).toEqual({ project: 'sample-miko-qipao', background: 'transparent', fit: 'contain', idle: true });
});
test('background and query parsing accept colors but reject CSS and project paths', () => {
  for (const [value, expected] of [['green', '#00ff00'], ['blue', '#0000ff'], ['#abc', '#abc'], ['123456', '#123456'], ['url(https://example.com)', 'transparent']]) expect(backgroundColor(value)).toBe(expected);
  expect(viewSettings('?project=../private&bg=blue&fit=cover&idle=0')).toEqual({ project: 'sample-miko-qipao', background: '#0000ff', fit: 'cover', idle: false });
  const settings = viewSettings('?project=nova&bg=%23123456&fit=cover&idle=0');
  const url = new URL(streamUrl(settings, 'http://127.0.0.1:5173'));
  expect(url.pathname).toBe('/stream.html'); expect(viewSettings(url.search)).toEqual(settings);
});

test('archive URLs round-trip while an explicit project takes precedence', () => {
  const settings = viewSettings('?avatar=%2F__studio%2Fprojects%2Favatar.mavatar&idle=0');
  expect(settings.avatar).toBe('/__studio/projects/avatar.mavatar');
  expect(viewSettings(new URL(streamUrl(settings, 'https://example.test')).search)).toEqual(settings);
  expect(viewSettings('?project=nova&avatar=ignored.mavatar').avatar).toBeUndefined();
  expect(viewSettings('?project=../bad&avatar=ignored.mavatar').avatar).toBeUndefined();
});

test('stream avatar sources stay on the current server origin', () => {
  const origin = 'http://127.0.0.1:5173';
  for (const value of ['https://example.com/a.mavatar', '//example.com/a.mavatar', 'http://127.0.0.1:5174/a.mavatar', 'data:application/zip,abc', 'blob:http://127.0.0.1:5173/id', 'http://user@127.0.0.1:5173/a.mavatar', 'http://[invalid']) {
    expect(viewSettings(`?avatar=${encodeURIComponent(value)}`, origin).avatar, value).toBeUndefined();
  }
  for (const value of ['/a.mavatar', 'a.mavatar', `${origin}/a.mavatar`]) {
    expect(viewSettings(`?avatar=${encodeURIComponent(value)}`, origin).avatar).toBe(value);
  }
});

test('overlay names round-trip through the stream URL and invalid lists are dropped', () => {
  const settings = viewSettings('?project=mio&overlays=glasses,hat');
  expect(settings.overlays).toEqual(['glasses', 'hat']);
  expect(new URL(streamUrl(settings, 'http://127.0.0.1:5173')).searchParams.get('overlays')).toBe('glasses,hat');
  expect(viewSettings('?project=mio').overlays).toBeUndefined();
  expect(viewSettings('?project=mio&overlays=').overlays).toEqual([]);
  expect(viewSettings('?project=mio&overlays=glasses,../x').overlays).toEqual([]);
  expect(new URL(streamUrl({ ...settings, overlays: [] }, 'http://127.0.0.1:5173')).searchParams.has('overlays')).toBe(false);
});

test('overlay relay messages accept only a project and a short list of safe, unique names', () => {
  expect(overlaysMessage({ project: 'mio', overlays: ['glasses', 'glasses', 'hat'] })).toEqual({ project: 'mio', overlays: ['glasses', 'hat'] });
  expect(overlaysMessage({ project: 'mio', overlays: [] })).toEqual({ project: 'mio', overlays: [] });
  for (const bad of [null, [], { project: 'mio' }, { project: '../x', overlays: [] }, { project: 'mio', overlays: 'glasses' },
    { project: 'mio', overlays: ['has space'] }, { project: 'mio', overlays: [1] }, { project: 'mio', overlays: [], extra: 1 },
    { project: 'mio', overlays: Array.from({ length: 33 }, (_, i) => `o${i}`) }]) {
    expect(overlaysMessage(bad)).toBeNull();
  }
});
