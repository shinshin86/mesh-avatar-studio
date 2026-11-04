import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { dismissGuide, samplePresent, sampleSkipReason } from './sample';

const snapshot = async (page: Page) => createHash('sha256').update(await page.getByTestId('preview').evaluate(c => (c as HTMLCanvasElement).toDataURL())).digest('hex');
async function ready(page: Page, revision: string | null) {
  if (revision) await expect(page.getByTestId('preview')).not.toHaveAttribute('data-revision', revision);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
}

test('a paused preview switches drawn eyes as the Eyes open slider moves', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/'); await dismissGuide(page); await ready(page, null);
  let revision = await page.getByTestId('preview').getAttribute('data-revision');
  await page.getByTestId('idle-toggle').click(); await ready(page, revision);
  const open = await snapshot(page);
  // Drag down through the half-closed drawing to fully closed, as a person would.
  const slider = page.getByRole('slider', { name: 'Eyes open', exact: true });
  for (const value of ['0.9', '0.7', '0.5', '0.3', '0.1', '0']) await slider.fill(value);
  const viaSlider = await snapshot(page);
  expect(viaSlider).not.toBe(open);
  // Rebuilding the paused preview at the same pose runs its fixed warm-up: the reference image.
  revision = await page.getByTestId('preview').getAttribute('data-revision');
  await page.getByTestId('idle-toggle').click(); await ready(page, revision);
  revision = await page.getByTestId('preview').getAttribute('data-revision');
  await page.getByTestId('idle-toggle').click(); await ready(page, revision);
  await expect(slider).toHaveValue('0');
  expect(await snapshot(page)).toBe(viaSlider);
});

test('drawn half eyes follow horizontal and vertical gaze while a closed eye stays still', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  await page.goto('/e2e/fixtures/embed.html');
  const frames = await page.evaluate(async () => {
    const entry = '/packages/runtime/src/index.ts';
    const { createMeshAvatar, PARAMS } = await import(entry) as typeof import('mesh-avatar');
    const rig = await (await fetch('/miko-qipao/rig.json')).json();
    const canvas = document.createElement('canvas');
    canvas.style.width = rig.image.width + 'px'; canvas.style.height = rig.image.height + 'px';
    document.body.append(canvas);
    const avatar = await createMeshAvatar(canvas, { rig, assetsBase: '/miko-qipao/built', manual: true, padTop: 0, padSide: 0 });
    const defaults = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
    const eye = rig.eyes[0], x = Math.floor(eye.x0), y = Math.floor(Math.min(...eye.top));
    const crop = document.createElement('canvas');
    crop.width = Math.ceil(eye.x1) - x; crop.height = Math.ceil(Math.max(...eye.bot)) - y;
    const ctx = crop.getContext('2d')!;
    const draw = (open: number, gazeX: number, gazeY: number) => {
      avatar.setParameters({ ...defaults, eyeROpen: open, eyeLOpen: open, gazeX, gazeY });
      avatar.advance(0);
      ctx.clearRect(0, 0, crop.width, crop.height);
      ctx.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return crop.toDataURL();
    };
    try {
      return { left: draw(0.5, -1, 0), right: draw(0.5, 1, 0), up: draw(0.5, 0, 1), down: draw(0.5, 0, -1),
        closedLeft: draw(0, -1, 0), closedRight: draw(0, 1, 0), reopened: draw(0.5, 1, 0) };
    } finally { avatar.destroy(); canvas.remove(); }
  });
  expect(frames.left === frames.right).toBe(false);
  expect(frames.up === frames.down).toBe(false);
  expect(frames.closedLeft === frames.closedRight).toBe(true);
  expect(frames.reopened === frames.right).toBe(true);
});
