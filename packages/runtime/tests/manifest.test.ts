import { expect, test } from 'vitest';
import { parseManifest } from 'mesh-avatar';
import { defaultManifest } from '../src/format/manifest';

const manifest = { format: 'mesh-avatar', version: 1, name: 'My avatar' };

test('optional lip sync settings retain defaults by omission, validate ranges and ignore unknown keys', () => {
  expect(parseManifest(manifest).lipSync).toBeUndefined();
  expect(parseManifest({ ...manifest, lipSync: {} }).lipSync).toEqual({});
  const lipSync = { openness: 0.75, extra: true };
  expect(parseManifest({ ...manifest, lipSync }).lipSync).toEqual({ openness: 0.75 });
  for (const lipSync of [null, [], 'settings', 1])
    expect(() => parseManifest({ ...manifest, lipSync })).toThrow('avatar.json.lipSync');
});

test('parses known manifest fields without retaining unknown data or shared objects', () => {
  const input = { ...manifest, author: 'Artist', license: 'Artwork terms', source: 'source.png',
    thumbnail: 'thumbnail.png', studio: { version: '0.1.0', extra: true }, extra: true };
  const parsed = parseManifest(input);
  expect(parsed).toEqual({ ...manifest, author: 'Artist', license: 'Artwork terms', source: 'source.png',
    thumbnail: 'thumbnail.png', studio: { version: '0.1.0' } });
  expect(parsed).not.toBe(input);
  expect(parsed.studio).not.toBe(input.studio);
  expect(input.studio.extra).toBe(true);
  expect(defaultManifest('Old folder')).toEqual({ ...manifest, name: 'Old folder' });
});

test.each([null, [], 'avatar'])('rejects non-object manifest %j', input => {
  expect(() => parseManifest(input)).toThrow('avatar.json: expected an object');
});

test.each([
  [{ format: 'other' }, 'format'], [{ version: 2 }, 'version'],
  [{ version: undefined }, 'version'], [{ name: '  ' }, 'name'],
  [{ author: 1 }, 'author'], [{ license: false }, 'license'],
  [{ source: null }, 'source'], [{ thumbnail: [] }, 'thumbnail'],
  [{ studio: {} }, 'studio.version'], [{ studio: [] }, 'studio.version'],
  [{ studio: { version: '' } }, 'studio.version'],
])('names invalid manifest field in %j', (change, field) => {
  expect(() => parseManifest({ ...manifest, ...change })).toThrow(`avatar.json.${field}:`);
});

test('movement settings round trip with validation and preserve omission for older manifests', () => {
  const lipSync = { granularity: 0, openness: 0.75, closeSpeed: 1 };
  expect(parseManifest({ ...manifest, lipSync }).lipSync).toEqual(lipSync);
  for (const key of ['granularity', 'openness', 'closeSpeed'])
    for (const value of [-0.01, 1.01, NaN, Infinity, '0.5', null])
      expect(() => parseManifest({ ...manifest, lipSync: { [key]: value } })).toThrow(`lipSync.${key}`);
});

test('editor preset metadata survives parsing without changing playback values', () => {
  for (const preset of ['calm', 'default', 'lively', 'subtle', 'big', 'custom']) {
    const lipSync = { preset, granularity: 0.5, openness: 0.5, closeSpeed: 0.5 };
    expect(parseManifest({ ...manifest, lipSync }).lipSync).toEqual(lipSync);
  }
  for (const preset of ['', 'unknown', null, 1, {}])
    expect(() => parseManifest({ ...manifest, lipSync: { preset } })).toThrow('avatar.json.lipSync: lipSync.preset:');
});
