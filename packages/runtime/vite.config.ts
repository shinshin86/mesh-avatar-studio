import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));
// The standalone browser bundle includes fflate, so retain its full MIT notice.
const require = createRequire(import.meta.url);
const fflateLicense = readFileSync(join(dirname(require.resolve('fflate/package.json')), 'LICENSE'), 'utf8');

export default defineConfig({
  publicDir: false,
  esbuild: { legalComments: 'inline' },
  build: {
    target: 'es2022',
    lib: { entry: fromHere('./src/index.ts'), formats: ['es'], fileName: () => 'index.js' },
    rollupOptions: { output: { banner: `/*! fflate\n${fflateLicense}\n*/` } },
  },
});
