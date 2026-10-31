import { defineConfig } from '@playwright/test';
const port = Number(process.env.PLAYWRIGHT_PORT ?? 5173);
const baseURL = `http://127.0.0.1:${port}`;
const sitePort = Number(process.env.PLAYWRIGHT_SITE_PORT ?? 5174);

export default defineConfig({
  testDir: 'e2e',
  // Real layer builds and pixel comparisons must not compete for GPU/CPU resources.
  workers: 1,
  // A test that passes on retry is reported as flaky instead of failing the run.
  retries: 1,
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
  },
  webServer: [{
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
  }, {
    // The landing site with the Player page, served under its GitHub Pages folder.
    command: `npm run dev:site -- --port ${sitePort} --strictPort`,
    url: `http://127.0.0.1:${sitePort}/mesh-avatar-studio/play/`,
    reuseExistingServer: true,
  }],
});
