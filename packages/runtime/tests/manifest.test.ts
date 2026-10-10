import { expect, test } from 'vitest';
import { parseManifest } from 'mesh-avatar';
import { defaultManifest } from '../src/format/manifest';

const manifest = { format: 'mesh-avatar', version: 1, name: 'My avatar' };

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
