import { zipSync, unzipSync } from 'fflate';
import { defaultManifest, parseManifest, type AvatarManifest } from './manifest.ts';
import { validateAvatarFiles } from './validate.ts';

const MAX_ENTRIES = 200, MAX_SIZE = 64 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });
export function checkEntryName(name: string) {
  if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\\') || name.includes('\0') || name.split('/').includes('..')) {
    throw new Error(`ZIP entry ${JSON.stringify(name)}: path must be relative, without .. or backslashes`);
  }
}

// Check the directory before extraction, including local headers that unzipSync does not validate.
function entries(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const invalid = (name = '(archive)'): never => { throw new Error(`ZIP entry ${JSON.stringify(name)}: invalid or truncated ZIP`); };
  const u16 = (offset: number) => offset >= 0 && offset + 2 <= data.length ? view.getUint16(offset, true) : invalid();
  const u32 = (offset: number) => offset >= 0 && offset + 4 <= data.length ? view.getUint32(offset, true) : invalid();
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--) {
    if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === data.length) break;
  }
  if (end < 0 || end < data.length - 65557) invalid();
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) invalid();
  const count = u16(end + 10), directory = u32(end + 16), directoryEnd = directory + u32(end + 12);
  if (directoryEnd !== end) invalid();
  const result: { name: string; offset: number; start: number; size: number; central: number }[] = [];
  const seen = new Set<string>();
  let position = directory;
  for (let i = 0; i < count; i++) {
    if (position + 46 > directoryEnd || u32(position) !== 0x02014b50) invalid();
    const length = u16(position + 28), next = position + 46 + length + u16(position + 30) + u16(position + 32);
    if (next > directoryEnd) invalid();
    let name: string;
    try { name = decoder.decode(data.subarray(position + 46, position + 46 + length)); }
    catch { throw new Error('ZIP entry (invalid UTF-8 name): invalid filename'); }
    checkEntryName(name);
    if (i >= MAX_ENTRIES) throw new Error(`ZIP entry ${JSON.stringify(name)}: more than ${MAX_ENTRIES} entries`);
    if (seen.has(name)) throw new Error(`ZIP entry ${JSON.stringify(name)}: duplicate entry`);
    seen.add(name);
    const size = u32(position + 24), compressed = u32(position + 20), offset = u32(position + 42);
    if (size > MAX_SIZE || compressed > MAX_SIZE) throw new Error(`ZIP entry ${JSON.stringify(name)}: exceeds 64 MB`);
    if (u16(position + 10) !== 0) throw new Error(`ZIP entry ${JSON.stringify(name)}: expected stored compression (method 0)`);
    if (u16(position + 8) & 1) throw new Error(`ZIP entry ${JSON.stringify(name)}: encrypted entries are not supported`);
    if (compressed !== size || offset + 30 > directory || u32(offset) !== 0x04034b50) invalid(name);
    const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
    if (start + size > directory || u16(offset + 8) !== 0 || u16(offset + 6) !== u16(position + 8)) invalid(name);
    let localName: string;
    try { localName = decoder.decode(data.subarray(offset + 30, offset + 30 + u16(offset + 26))); }
    catch { invalid(name); }
    if (localName! !== name) invalid(name);
    result.push({ name, offset, start, size, central: position });
    position = next;
  }
  if (position !== directoryEnd) invalid();
  return { files: result };
}

export function unpackAvatar(input: ArrayBuffer | Uint8Array): Record<string, Uint8Array> {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const directory = entries(data);
  const extracted = unzipSync(data, { filter: entry => entry.name !== '__proto__' });
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const entry of directory.files) {
    // Avoid the special setter on fflate's ordinary output object for this valid filename.
    const bytes = entry.name === '__proto__' ? data.slice(entry.start, entry.start + entry.size) : extracted[entry.name];
    if (!(bytes instanceof Uint8Array) || bytes.length !== entry.size) throw new Error(`ZIP entry ${JSON.stringify(entry.name)}: invalid size`);
    files[entry.name] = bytes;
  }
  return files;
}

export function packAvatar(files: Record<string, Uint8Array>, options: { manifest?: Partial<AvatarManifest> } = {}): Uint8Array {
  const existing = Object.hasOwn(files, 'avatar.json') ? files['avatar.json'] : undefined;
  const manifest = existing ? parseManifest(JSON.parse(decoder.decode(existing))) : defaultManifest('Avatar');
  const bytes = existing && !options.manifest ? existing : new TextEncoder().encode(JSON.stringify(parseManifest({ ...manifest, ...options.manifest }), null, 2) + '\n');
  const packed: Record<string, Uint8Array> = Object.create(null);
  packed['avatar.json'] = bytes;
  for (const [name, data] of Object.entries(files)) if (name !== 'avatar.json') packed[name] = data;
  for (const [i, [name, data]] of Object.entries(packed).entries()) {
    checkEntryName(name);
    if (i >= MAX_ENTRIES) throw new Error(`ZIP entry ${JSON.stringify(name)}: more than ${MAX_ENTRIES} entries`);
    if (data.byteLength > MAX_SIZE) throw new Error(`ZIP entry ${JSON.stringify(name)}: exceeds 64 MB`);
  }
  const errors = validateAvatarFiles(packed);
  if (errors.length) throw new Error(errors.join('\n'));
  let alias = 'proto0000';
  for (let i = 0; Object.hasOwn(packed, alias); i++) alias = `proto${String(i + 1).padStart(4, '0')}`;
  const input = Object.fromEntries(Object.entries(packed).map(([name, data]) => [name === '__proto__' ? alias : name, data]));
  const archive = zipSync(input, { level: 0 });
  if (Object.hasOwn(packed, '__proto__')) {
    const entry = entries(archive).files.find(entry => entry.name === alias)!;
    const name = new TextEncoder().encode('__proto__');
    archive.set(name, entry.offset + 30); archive.set(name, entry.central + 46);
  }
  const directory = entries(archive);
  // Numeric root filenames sort before other object keys. Put the manifest first physically too.
  const first = directory.files.find(entry => entry.name === 'avatar.json')!;
  if (first.offset !== 0) {
    const length = first.start + first.size - first.offset;
    const reordered = new Uint8Array(archive.length);
    reordered.set(archive.subarray(first.offset, first.offset + length));
    reordered.set(archive.subarray(0, first.offset), length);
    reordered.set(archive.subarray(first.offset + length), first.offset + length);
    const view = new DataView(reordered.buffer);
    for (const entry of directory.files) view.setUint32(entry.central + 42, entry === first ? 0 : entry.offset < first.offset ? entry.offset + length : entry.offset, true);
    return reordered;
  }
  return archive;
}
