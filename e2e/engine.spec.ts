import { dismissGuide, samplePresent, sampleSkipReason } from './sample';
import { expect, test } from '@playwright/test';

test('renders the data-driven engine without browser errors', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByText('Engine ready', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/screenshots/shell.png' });
  expect(errors).toEqual([]);
});

test('sample views load without the local project server', async ({ page }) => {
  test.skip(!samplePresent, sampleSkipReason);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/__studio/projects', route => route.fulfill({ status: 404, body: 'Not found' }));
  await page.goto('/');
  await dismissGuide(page);
  await expect(page.getByTestId('preview-status')).toHaveAttribute('data-state', 'ready');
  for (const path of ['/live.html?idle=0', '/stream.html?idle=0']) {
    await page.goto(path);
    await expect(page.locator('canvas')).toHaveAttribute('data-state', 'ready');
  }
  expect(errors).toEqual([]);
});
