import { expect, test } from 'vitest';
import { DEFAULT_LIGHTING, parseLighting } from 'mesh-avatar';
import { lightingFromQuery, loadLighting, writeLightingQuery } from '../src/lighting/storage';
import { detailGradient, generateNormals, silhouetteDistance } from '../packages/runtime/src/lighting/normals';
import { attenuation, diffuseTerm, shadedColor, headRotation, rimTerm, shadowOffset } from '../packages/runtime/src/lighting/shading';
import { lightingMessage, lightingValue, lightingWire } from '../src/lighting/protocol';
import { viewSettings, streamUrl } from '../src/live/settings';

test('inflated disc normals face outward at the rim and forward at the centre', () => {
  const size = 65, alpha = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (Math.hypot(x - 32, y - 32) <= 28) alpha[y * size + x] = 255;
  const data = generateNormals(alpha, size, size, [0, 0, size, size]);
  const normal = (x: number, y: number) => [...data.slice((y * size + x) * 4, (y * size + x) * 4 + 2)].map(v => v / 255 * 2 - 1);
  expect(normal(32, 32)[0]).toBeCloseTo(0, 2); expect(normal(32, 32)[1]).toBeCloseTo(0, 2);
  // Without painting data the relief channels stay neutral.
  expect(data[(32 * size + 32) * 4 + 2]).toBe(128); expect(data[(32 * size + 32) * 4 + 3]).toBe(128);
  expect(normal(58, 32)[0]).toBeGreaterThan(0.2); expect(normal(6, 32)[0]).toBeLessThan(-0.2);
  expect(normal(32, 58)[1]).toBeGreaterThan(0.2); expect(normal(32, 6)[1]).toBeLessThan(-0.2);
  expect(silhouetteDistance(alpha, size, size)[0]).toBe(0);
});
test('transparent and fully opaque rectangles produce finite normals', () => {
  for (const alpha of [new Uint8Array(1), new Uint8Array(100).fill(255)]) {
    const n = generateNormals(alpha, Math.sqrt(alpha.length), Math.sqrt(alpha.length), [0, 0, 100, 100]);
    expect([...n].every(Number.isFinite)).toBe(true);
    for (let i = 3; i < n.length; i += 4) expect(n[i]).toBe(128);
  }
});
test('diffuse is brighter facing the light, cel has three bands, and light fades with distance', () => {
  for (const mode of ['soft', 'cel'] as const) expect(diffuseTerm(1, mode, 0.45)).toBeGreaterThan(diffuseTerm(-1, mode, 0.45));
  const levels = new Set(Array.from({ length: 201 }, (_, i) => Math.round(diffuseTerm(i / 100 - 1, 'cel', 0) * 1000)));
  expect(levels.size).toBeLessThanOrEqual(8); expect([...levels].filter(v => [200, 650, 1000].includes(v))).toHaveLength(3);
  expect(diffuseTerm(-1, 'soft', 1)).toBe(0); expect(diffuseTerm(0.3, 'soft', 1)).toBeLessThan(diffuseTerm(0.3, 'soft', 0));
  expect(attenuation(0, 1)).toBe(1); expect(attenuation(2, 1)).toBeLessThan(attenuation(1, 1)); expect(attenuation(1, 3)).toBeGreaterThan(attenuation(1, 1));
  expect(rimTerm(1, 1)).toBe(0); expect(rimTerm(0, 1)).toBeGreaterThan(rimTerm(0, -1));
  expect(shadowOffset(0, 0)).toEqual([0.06, 0.06]); expect(shadowOffset(1, 1)).toEqual([-0.06, -0.06]);
});
test('painted strokes become grooves; flat paint and transparent pixels add no relief', () => {
  const size = 21, alpha = new Uint8Array(size * size).fill(255), luminance = new Float32Array(size * size).fill(0.8);
  for (let y = 0; y < size; y++) luminance[y * size + 10] = 0.1;
  const g = detailGradient(luminance, alpha, size, size);
  // Left of the dark line the surface tilts right (into the groove), right of it tilts left.
  expect(g[2 * (10 * size + 9)]).toBeGreaterThan(0); expect(g[2 * (10 * size + 11)]).toBeLessThan(0);
  expect(g[2 * (10 * size + 2)]).toBeCloseTo(0, 5);
  alpha.fill(0); expect([...detailGradient(luminance, alpha, size, size)].every(v => v === 0)).toBe(true);
});
test('head yaw rotates the front normal toward the new direction; roll uses the rig angle', () => {
  const r = headRotation(30, 0, 0, 0.3);
  expect(r[6]).toBeCloseTo(0.5); expect(r[7]).toBeCloseTo(0); expect(r[8]).toBeCloseTo(Math.sqrt(3)/2);
  const roll = headRotation(0, 0, 30, 0.3);
  expect(roll[0]).toBeCloseTo(Math.cos(-0.3)); expect(roll[1]).toBeCloseTo(Math.sin(-0.3));
});
test('lighting URLs round trip every option and clamp malformed numbers', () => {
  const light = { ...DEFAULT_LIGHTING, enabled: true, x: 0.9, y: 0.8, z: 1.2, color: 0x1234ff, strength: 0.8, intensity: 1.5, ambient: 0.2, mode: 'cel' as const, shadow: true,
    reach: 2.5, ambientColor: 0x203040, softness: 0.1, specular: 0.6, rim: 0.9, detail: 0.7 };
  const query = new URLSearchParams(); writeLightingQuery(query, light); expect(lightingFromQuery(query)).toEqual(light);
  const view = { ...viewSettings(''), lighting: light };
  expect(viewSettings(new URL(streamUrl(view, 'http://127.0.0.1:5173')).search)).toEqual(view);
  expect(lightingFromQuery(new URLSearchParams('light=true&lx=999&ly=NaN&lz=&lc=javascript&ls=-2&lm=unknown'))).toEqual({ ...DEFAULT_LIGHTING, x: 1, strength: 0 });
});
test('relay accepts only complete, numeric or enumerated lighting settings', () => {
  const message = lightingWire('project-a', { ...DEFAULT_LIGHTING, enabled: true });
  expect(lightingMessage(message)).toEqual(message);
  expect(lightingValue(message)).toEqual({ ...DEFAULT_LIGHTING, enabled: true });
  for (const change of [{ ambientColor: 0.5 }, { reach: '1' }, { z: Infinity }, { x: '0.5' }, { color: '#ffffff' }, { color: 1.2 }, { mode: 'other' }, { enabled: true }, { enabled: '1' }, { shadow: 2 }, { url: 'https://example.com' }]) {
    expect(lightingMessage({ ...message, lighting: { ...message.lighting, ...change } })).toBeNull();
  }
  for (const invalid of [null, [], { ...message, project: '../private' }, { ...message, params: {} }, { project: 'a', lighting: {} }]) expect(lightingMessage(invalid)).toBeNull();
  expect(parseLighting({ ...DEFAULT_LIGHTING, x: NaN })).toBeNull();
});

test('cropped opaque borders do not bend toward an artificial outside silhouette', () => {
  const size = 25, alpha = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 5; x < 20; x++) alpha[y * size + x] = 255;
  const distance = silhouetteDistance(alpha, size, size, true);
  expect(distance[12]).toBe(distance[12 * size + 12]);
  expect(distance[24 * size + 12]).toBe(distance[12 * size + 12]);
});

test('settings saved before newer options existed keep their values', () => {
  const store = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
  const old = { enabled: true, x: 0.7, y: 0.3, z: 0.9, color: 0xffeedd, strength: 0.5, intensity: 1, ambient: 0.6, mode: 'cel', shadow: true };
  store.set('mesh-avatar:lighting:old', JSON.stringify(old));
  expect(loadLighting('old')).toEqual({ ...DEFAULT_LIGHTING, ...old });
  store.set('mesh-avatar:lighting:bad', '[1]'); expect(loadLighting('bad')).toEqual(DEFAULT_LIGHTING);
});

test('shadows deepen the base colour instead of turning it grey', () => {
  const skin = [1, 0.9, 0.85], lit = shadedColor(skin, 1), shadow = shadedColor(skin, 0.5);
  expect(lit).toEqual(skin);
  const saturation = (c: number[]) => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  expect(saturation(shadow)).toBeGreaterThan(saturation(skin));
  expect(shadedColor([0.5, 0.5, 0.5], 0.5)[0]).toBeCloseTo(0.1875);
});
