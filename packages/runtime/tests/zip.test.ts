import { expect, test } from 'vitest';
import { zipSync } from 'fflate';
import { packAvatar, unpackAvatar, validateAvatarFiles } from 'mesh-avatar';
import { sampleFiles } from './avatar-fixture';

const files = sampleFiles();
test('sample round trip preserves the complete file set and every byte, with the manifest first', () => {
  const archive = packAvatar(files), result = unpackAvatar(archive);
  const header = new DataView(archive.buffer);
  expect(header.getUint32(0, true)).toBe(0x04034b50);
  expect(header.getUint16(8, true)).toBe(0);
  expect(new TextDecoder().decode(archive.subarray(30, 30 + header.getUint16(26, true)))).toBe('avatar.json');
  expect(Object.keys(result).sort()).toEqual(Object.keys(files).sort());
  for (const name of Object.keys(files)) expect(Buffer.from(result[name]).equals(Buffer.from(files[name])), name).toBe(true);
  expect(validateAvatarFiles(result)).toEqual([]);
});

test('preserves numeric and prototype-like unknown root filenames and UTF-8 names', () => {
  const input = { ...files, '0': new Uint8Array([1]), ['__proto__']: new Uint8Array([2]), '表情.txt': new Uint8Array([3]) };
  const archive = packAvatar(input), result = unpackAvatar(archive);
  expect(new TextDecoder().decode(archive.subarray(30, 41))).toBe('avatar.json');
  for (const name of ['0', '__proto__', '表情.txt']) expect(result[name]).toEqual(input[name as keyof typeof input]);
  expect(Object.getPrototypeOf(result)).toBeNull();
});

test('creates a missing manifest, merges explicit overrides and rejects invalid contents', () => {
  const legacy = { ...files }; delete legacy['avatar.json'];
  const named = unpackAvatar(packAvatar(legacy, { manifest: { name: 'Custom' } }));
  expect(JSON.parse(new TextDecoder().decode(named['avatar.json']))).toEqual({ format: 'mesh-avatar', version: 1, name: 'Custom' });
  const broken = { ...files }; delete broken['built/base.png'];
  expect(() => packAvatar(broken)).toThrow('built/base.png: missing file');
  expect(() => packAvatar(files, { manifest: { name: '' } })).toThrow('avatar.json.name:');
});

test.each(['/absolute.png', '../escape.png', 'built/../escape.png', 'C:/escape.png', 'C:escape.png', 'built\\escape.png', 'bad\0name'])('rejects unsafe ZIP entry %j before extraction', name => {
  expect(() => unpackAvatar(zipSync({ [name]: new Uint8Array([1]) }, { level: 0 }))).toThrow(`ZIP entry ${JSON.stringify(name)}: path must be relative`);
  expect(() => packAvatar({ ...files, [name]: new Uint8Array([1]) })).toThrow(`ZIP entry ${JSON.stringify(name)}: path must be relative`);
});

test('rejects too many entries and oversized declared data before allocating it', () => {
  const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`file-${i}`, new Uint8Array()]));
  expect(() => unpackAvatar(zipSync(many, { level: 0 }))).toThrow('ZIP entry "file-200": more than 200 entries');
  const large = zipSync({ large: new Uint8Array([1]) }, { level: 0 });
  const view = new DataView(large.buffer), central = view.getUint32(large.length - 6, true);
  view.setUint32(central + 24, 64 * 1024 * 1024 + 1, true);
  expect(() => unpackAvatar(large)).toThrow('ZIP entry "large": exceeds 64 MB');
});

test('rejects compression, truncation, duplicate names and contradictory headers', () => {
  expect(() => unpackAvatar(zipSync({ compressed: new Uint8Array([1]) }))).toThrow('ZIP entry "compressed": expected stored compression');
  for (const data of [new Uint8Array(), new Uint8Array(100), packAvatar(files).subarray(0, 30)]) expect(() => unpackAvatar(data)).toThrow('invalid or truncated ZIP');
  const duplicate = zipSync({ a: new Uint8Array(), b: new Uint8Array() }, { level: 0 });
  const view = new DataView(duplicate.buffer), central = view.getUint32(duplicate.length - 6, true);
  duplicate[central + 47 + 46] = 'a'.charCodeAt(0);
  expect(() => unpackAvatar(duplicate)).toThrow('ZIP entry "a": duplicate entry');
  const mismatch = zipSync({ name: new Uint8Array([1]) }, { level: 0 });
  mismatch[30] = 'X'.charCodeAt(0);
  expect(() => unpackAvatar(mismatch)).toThrow('ZIP entry "name": invalid or truncated ZIP');
});
