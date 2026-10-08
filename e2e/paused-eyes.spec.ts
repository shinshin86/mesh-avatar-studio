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
