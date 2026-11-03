import { afterEach, expect, test, vi } from 'vitest';
import { createMeshAvatar, parseRig } from 'mesh-avatar';
import fixture from '../../../samples/miko-qipao/rig.json';

// Parameter blending runs without drawing; only the browser's asset/canvas boundary is stubbed.
vi.mock('../src/engine/renderer.js', () => ({ createRenderer: () => ({
  buildGrid: () => ({ rest: [], pos: [] }),
  Renderer: class {
    addLayer(_name: string, _image: unknown, mesh: unknown) { return { mesh }; }
    destroy() {}
  },
}) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function stubBrowser() {
  vi.stubGlobal('Image', class {
    width = 1; height = 1; onload = () => {};
    set src(_value: string) { queueMicrotask(() => this.onload()); }
  });
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({
    drawImage() {}, getImageData: () => ({ data: new Uint8Array(4) }),
  }) }) });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('layers.json')
    ? new Response(JSON.stringify({ layers: {} })) : new Response('', { status: 404 })));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(console, 'warn').mockImplementation(() => {});
}

test('null parameter weights clear previous overrides and retain global blending, like omitted weights', async () => {
  stubBrowser();
  const avatar = await createMeshAvatar({} as HTMLCanvasElement,
    { rig: parseRig(fixture), assetsBase: 'https://example.test/parameters/', manual: true });
  try {
    avatar.setAutoIdle(false); avatar.setAutoMotion(false);
    avatar.advanceParameters(0); const underlying = avatar.getParameters().angleX;
    avatar.setParameters({ angleX: 10 }, .5, { angleX: 0 });
    avatar.advanceParameters(0); expect(avatar.getParameters().angleX).toBe(underlying);
    avatar.setParameters({ angleX: 10 }, .5, null);
    avatar.advanceParameters(0); const cleared = avatar.getParameters().angleX;
    expect(cleared).toBeCloseTo(underlying + (10 - underlying) * .5);
    avatar.setParameters({ angleX: 10 }, .5);
    avatar.advanceParameters(0); expect(avatar.getParameters().angleX).toBe(cleared);
    avatar.setParameters({ angleX: 10 }, .5, {});
    avatar.advanceParameters(0); expect(avatar.getParameters().angleX).toBe(cleared);
  } finally { avatar.destroy(); }
});

test('per-expression settings set the resting mouth opening of a live expression', async () => {
  stubBrowser();
  const settled = async (options: Parameters<typeof createMeshAvatar>[1]['expressions']) => {
    const avatar = await createMeshAvatar({} as HTMLCanvasElement, { rig: parseRig(fixture),
      assetsBase: 'https://example.test/parameters/', manual: true, ...(options === undefined ? {} : { expressions: options }) });
    try {
      avatar.setAutoIdle(false); avatar.setAutoMotion(false); avatar.setExpression('surprise');
      for (let i = 0; i < 120; i++) avatar.advanceParameters(1 / 60);
      return avatar.getParameters().mouthOpen;
    } finally { avatar.destroy(); }
  };
  expect(await settled(undefined)).toBeCloseTo(0.6, 3);
  expect(await settled({ surprise: { mouthOpen: 0.45 } })).toBeCloseTo(0.45, 3);
  await expect(settled({ surprise: { mouthOpen: 2 } })).rejects.toThrow('expressions.surprise.mouthOpen: expected 0–1');
});
