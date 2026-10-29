import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { packProjectAvatar } from '../packages/runtime/src/format/project-archive';
import { readAvatarFolder } from '../tools/avatar-files.mjs';
import { mediapipeAssets } from '../src/server/mediapipe-assets';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));
// Forward slashes on every platform, as Vite matches deny patterns against normalized paths.
const repository = fromHere('..').replace(/\\/g, '/').replace(/\/$/, '');
const base = '/mesh-avatar-studio/';
// External mesh-avatar-element embeds use this path as their default src; keep it stable.
const avatarFile = 'miko.mavatar';
const publishedUrl = `https://shinshin86.github.io${base}`;

function socialImage(): Plugin {
  return {
    name: 'site-social-image',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        const language = context.filename === fromHere('./ja/index.html') ? 'ja' : 'en';
        const screenshot = `docs/images/${language}/01-overview.png`;
        // Vite can prepend the base to the placeholder on the root development page.
        const setImage = (url: string) => html.replace(/content="[^"]*__SOCIAL_IMAGE__"/, () => `content="${url}"`);
        if (context.server) {
          return setImage(`${base}@fs/${fromHere(`../${screenshot}`)}`);
        }
        const image = Object.values(context.bundle ?? {}).find(asset =>
          asset.type === 'asset' && asset.originalFileNames.some(path => path.replaceAll('\\', '/').endsWith(screenshot)));
        if (!image) throw new Error('The overview screenshot is missing from the site build.');
        return setImage(new URL(image.fileName, publishedUrl).href);
      },
    },
  };
}

function sampleAvatar(): Plugin {
  const pack = () => packProjectAvatar(
    paths => readAvatarFolder(fromHere('../samples/miko-qipao'), paths),
    { name: 'Miko', includeSource: false },
  );

  return {
    name: 'site-sample-avatar',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] !== `${base}${avatarFile}`) return next();
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.writeHead(405, { Allow: 'GET, HEAD' });
          response.end();
          return;
        }
        void pack().then(bytes => {
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': bytes.byteLength,
            'Cache-Control': 'no-store',
          });
          response.end(request.method === 'HEAD' ? undefined : bytes);
        }).catch(next);
      });
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: avatarFile, source: await pack() });
    },
  };
}

// Retain the license of the archive library bundled into the browser script.
const require = createRequire(import.meta.url);
const fflateLicense = readFileSync(join(dirname(require.resolve('fflate/package.json')), 'LICENSE'), 'utf8');

export default defineConfig({
  root: fromHere('./'),
  base,
  publicDir: false,
  // The Player page tracks the face in the browser with the same local MediaPipe files as Studio.
  plugins: [react(), sampleAvatar(), socialImage(), mediapipeAssets(fromHere('..'), base)],
  resolve: { alias: { 'mesh-avatar': fromHere('../packages/runtime/src/index.ts') } },
  server: {
    host: '127.0.0.1',
    fs: {
      // Only the packed avatar is served; raw sample and private project files stay local.
      // The folders are anchored to this repository: "**/projects/**" would also match a
      // checkout that itself lives under a folder named projects/ and deny every page.
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**',
        ...['samples', 'projects', 'work', 'reference'].map(folder => `${repository}/${folder}/**`)],
    },
  },
  preview: { host: '127.0.0.1' },
  esbuild: { legalComments: 'inline' },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        en: fromHere('./index.html'),
        ja: fromHere('./ja/index.html'),
        play: fromHere('./play/index.html'),
        'ja-play': fromHere('./ja/play/index.html'),
        embed: fromHere('./embed/index.html'),
        'ja-embed': fromHere('./ja/embed/index.html'),
      },
      output: { banner: `/*! fflate\n${fflateLicense}\n*/` },
    },
  },
});
