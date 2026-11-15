#!/usr/bin/env node
// Checks what Mesh Avatar Studio needs on this machine and explains what each missing tool
// is for. Only Node.js and the installed packages are required to run the editor.
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIN_NODE = [22, 17];
const root = fileURLToPath(new URL('..', import.meta.url));

const text = {
  en: {
    title: 'Mesh Avatar Studio environment check',
    node: version => `Node.js ${version}`,
    nodeOld: version => `Node.js ${MIN_NODE.join('.')} or later is required (found ${version}). Install it from https://nodejs.org/`,
    packages: 'Packages installed',
    packagesMissing: 'Packages are not installed. Run: npm install',
    uv: version => `uv ${version}`,
    uvMissing: 'uv was not found. The editor works without it, but rebuilding layers and creating avatars need it.\n  Install: https://docs.astral.sh/uv/getting-started/installation/',
    python: version => `Python ${version} (found by uv)`,
    pythonMissing: 'uv found no Python 3.10 or later. The editor works, but rebuilding layers and creating avatars need it.\n  Install: uv python install 3.12',
    pythonFailed: error => `uv could not look for Python: ${error}\n  If uv cannot write to its cache folder, point UV_CACHE_DIR at a writable folder.`,
    pythonSkipped: 'Python was not checked because uv is missing.',
    pythonFreeThreaded: version => `uv picks the free-threaded Python ${version}. OpenCV has no ready-made package for it, so rebuilding layers can fail.\n  Install a regular build: uv python install 3.13`,
    chromium: 'Playwright Chromium',
    chromiumMissing: 'Playwright Chromium was not found. The editor and the Live page work as they are.\n  Creating avatars with an agent, or importing drawn eyes and mouths, needs it to render the motion review.\n  Install: npx playwright install chromium',
    chromiumFailed: error => `Playwright Chromium could not start or complete its WebGL2 check: ${error}\n  The editor works, but pose images cannot be rendered.`,
    chromiumNoWebGL2: 'Playwright Chromium started, but WebGL2 is unavailable. The editor works, but pose images cannot be rendered.',
    failed: 'Fix the errors above before starting the editor.',
    warned: 'You can start the editor with: npm run dev\nResolve the warnings above before creating avatars.',
    passed: 'Everything is ready. Start the editor with: npm run dev',
  },
  ja: {
    title: 'Mesh Avatar Studio の動作環境チェック',
    node: version => `Node.js ${version}`,
    nodeOld: version => `Node.js ${MIN_NODE.join('.')} 以降が必要です(現在 ${version})。https://nodejs.org/ からインストールしてください。`,
    packages: 'パッケージはインストール済みです',
    packagesMissing: 'パッケージがインストールされていません。次を実行してください: npm install',
    uv: version => `uv ${version}`,
    uvMissing: 'uv が見つかりません。エディタはこのまま使えますが、レイヤーの作り直しとアバターの作成には必要です。\n  インストール: https://docs.astral.sh/uv/getting-started/installation/',
    python: version => `Python ${version}(uv で検出)`,
    pythonMissing: 'uv から Python 3.10 以降が見つかりません。エディタは使えますが、レイヤーの作り直しとアバターの作成には必要です。\n  インストール: uv python install 3.12',
    pythonFailed: error => `uv で Python を探せませんでした: ${error}\n  uv がキャッシュのフォルダに書き込めない場合は、UV_CACHE_DIR に書き込めるフォルダを指定してください。`,
    pythonSkipped: 'uv がないため、Python は確認していません。',
    pythonFreeThreaded: version => `uv がフリースレッド版の Python ${version} を選んでいます。OpenCV にはこの版向けのビルド済みパッケージがなく、レイヤーの作り直しに失敗することがあります。\n  通常版をインストール: uv python install 3.13`,
    chromium: 'Playwright の Chromium',
    chromiumMissing: 'Playwright の Chromium が見つかりません。エディタと配信画面はこのまま使えます。\n  エージェントでアバターを作るときや、描き分け画像を取り込むときは、動きの確認(ポーズ画像の書き出し)に必要です。\n  インストール: npx playwright install chromium',
    chromiumFailed: error => `Playwright の Chromium を起動できないか、WebGL2 の確認を完了できませんでした: ${error}\n  エディタは使えますが、ポーズ画像を書き出せません。`,
    chromiumNoWebGL2: 'Playwright の Chromium は起動しましたが、WebGL2 が使えません。エディタは使えますが、ポーズ画像を書き出せません。',
    failed: '上のエラーを解決してからエディタを起動してください。',
    warned: 'エディタは次のコマンドで起動できます: npm run dev\nアバターを作る前に、上の警告を解決してください。',
    passed: 'すべて揃っています。次のコマンドでエディタを起動できます: npm run dev',
  },
};

export function language(argv = process.argv.slice(2), env = process.env) {
  const flag = argv.find(arg => arg.startsWith('--lang='))?.slice(7) ?? argv[argv.indexOf('--lang') + 1];
  if (flag === 'ja' || flag === 'en') return flag;
  const locale = env.LC_ALL || env.LC_MESSAGES || env.LANG || Intl.DateTimeFormat().resolvedOptions().locale;
  return /^ja/i.test(locale ?? '') ? 'ja' : 'en';
}

export function nodeVersionOk(version) {
  const [major, minor] = version.replace(/^v/, '').split('.').map(Number);
  return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

const runResult = (command, args) => new Promise(done => {
  execFile(command, args, { cwd: root, timeout: 30_000, windowsHide: true }, (error, stdout, stderr) => done({ error, stdout: stdout.trim(), stderr: stderr.trim() }));
});
const run = async (command, args) => {
  const result = await runResult(command, args);
  return result.error ? null : result.stdout;
};
const errorSummary = error => String(error).trim().split(/\r?\n/).slice(0, 3).join('\n  ').slice(0, 1000);

/** Probes the machine. Missing tools return null/false; failed checks return details. */
export const probes = {
  node: async () => process.version.replace(/^v/, ''),
  packages: async () => existsSync(fileURLToPath(new URL('../node_modules/vite/package.json', import.meta.url))),
  uv: async () => (await run('uv', ['--version']))?.replace(/^uv\s+/, '').split(' ')[0] ?? null,
  // Studio runs its tools with an interpreter uv finds, without downloading one.
  python: async () => {
    const found = await runResult('uv', ['python', 'find', '>=3.10']);
    if (found.error) {
      // uv uses exit code 2 for both no match and operational failures. Only its
      // no-match diagnostic on the first line means the interpreter needs installing.
      if (found.error.code === 2 && /^error: No interpreter found for Python /.test(found.stderr)) return null;
      return { error: errorSummary(found.stderr || found.error.message) };
    }
    const path = found.stdout;
    // A trailing "t" marks a free-threaded build, as in python3.14t.
    return path ? (await run(path, ['-c', "import platform, sysconfig; print(platform.python_version() + ('t' if sysconfig.get_config_var('Py_GIL_DISABLED') else ''))"])) ?? path : null;
  },
  chromium: async () => {
    let chromium;
    try {
      ({ chromium } = await import('@playwright/test'));
      if (!existsSync(chromium.executablePath())) return false;
    } catch { return false; }
    let browser, timer;
    const deadline = Date.now() + 30_000;
    try {
      // Match render-poses.mjs: use Playwright's default Chromium launch options.
      browser = await chromium.launch({ timeout: 30_000 });
      const webgl2 = await Promise.race([
        (async () => {
          const page = await browser.newPage();
          return page.evaluate(() => !!document.createElement('canvas').getContext('webgl2', {
            premultipliedAlpha: true, antialias: true, alpha: true, preserveDrawingBuffer: true,
          }));
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Chromium WebGL2 check timed out.')), Math.max(1, deadline - Date.now()));
        }),
      ]);
      return webgl2 ? true : { status: 'no-webgl2' };
    } catch (error) {
      return { status: 'failed', error: errorSummary(error.message) };
    } finally {
      clearTimeout(timer);
      if (browser) await browser.close().catch(() => {});
    }
  },
};

/** Returns one result per check: ok, warn (optional for the editor) or error (blocks it). */
export async function checkEnvironment(lang, probe = probes) {
  const t = text[lang], results = [];
  const node = await probe.node();
  results.push(nodeVersionOk(node) ? { id: 'node', status: 'ok', message: t.node(node) } : { id: 'node', status: 'error', message: t.nodeOld(node) });
  results.push(await probe.packages() ? { id: 'packages', status: 'ok', message: t.packages } : { id: 'packages', status: 'error', message: t.packagesMissing });
  const uv = await probe.uv();
  results.push(uv ? { id: 'uv', status: 'ok', message: t.uv(uv) } : { id: 'uv', status: 'warn', message: t.uvMissing });
  const python = uv ? await probe.python() : null;
  if (!python) results.push({ id: 'python', status: 'warn', message: uv ? t.pythonMissing : t.pythonSkipped });
  else if (python.error) results.push({ id: 'python', status: 'warn', message: t.pythonFailed(python.error) });
  else if (/^\d+\.\d+\.\d+t$/.test(python)) results.push({ id: 'python', status: 'warn', message: t.pythonFreeThreaded(python.slice(0, -1)) });
  else results.push({ id: 'python', status: 'ok', message: t.python(python) });
  const chromium = await probe.chromium();
  if (!chromium) results.push({ id: 'chromium', status: 'warn', message: t.chromiumMissing });
  else if (chromium.status === 'failed') results.push({ id: 'chromium', status: 'warn', message: t.chromiumFailed(chromium.error) });
  else if (chromium.status === 'no-webgl2') results.push({ id: 'chromium', status: 'warn', message: t.chromiumNoWebGL2 });
  else results.push({ id: 'chromium', status: 'ok', message: t.chromium });
  return results;
}

export function formatReport(results, lang) {
  const t = text[lang], mark = { ok: '✓', warn: '⚠', error: '✗' };
  const summary = results.some(r => r.status === 'error') ? t.failed : results.some(r => r.status === 'warn') ? t.warned : t.passed;
  return [t.title, '', ...results.map(r => `${mark[r.status]} ${r.message}`), '', summary].join('\n');
}

// npx and npm run start this file through a link, so compare real paths.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const lang = language();
  const results = await checkEnvironment(lang);
  console.log(formatReport(results, lang));
  process.exitCode = results.some(r => r.status === 'error') ? 1 : 0;
}
