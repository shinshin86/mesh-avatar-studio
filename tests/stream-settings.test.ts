import { expect, test } from 'vitest';
import { backgroundColor, streamUrl, viewSettings } from '../src/live/settings';

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
