import { expect, test, vi } from 'vitest';
import { createMeshAvatar, parseRig } from 'mesh-avatar';
import fixture from '../../../samples/miko-qipao/rig.json';

test('missing asset sources fail before attempting a request or accessing the canvas', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(createMeshAvatar({} as HTMLCanvasElement, { rig: parseRig(fixture) }))
      .rejects.toThrow('createMeshAvatar requires assets or assetsBase.');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
