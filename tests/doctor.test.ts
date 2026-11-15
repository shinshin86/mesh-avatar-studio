import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { checkEnvironment, formatReport, language, nodeVersionOk, probes } from '../tools/doctor.mjs';

const mocked = vi.hoisted(() => ({ execFile: vi.fn(), executablePath: vi.fn(), launch: vi.fn(), newPage: vi.fn(), evaluate: vi.fn(), close: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocked.execFile }));
vi.mock('@playwright/test', () => ({ chromium: { executablePath: mocked.executablePath, launch: mocked.launch } }));

const ready = { node: async () => '22.17.1', packages: async () => true, uv: async () => '0.9.21', python: async () => '3.12.4', chromium: async () => true };
const statuses = (results: { id: string; status: string }[]) => Object.fromEntries(results.map(r => [r.id, r.status]));

describe('environment check', () => {
  test('requires Node.js 22.17 or later', () => {
    expect([nodeVersionOk('v22.17.0'), nodeVersionOk('22.16.9'), nodeVersionOk('23.0.0'), nodeVersionOk('20.19.0')]).toEqual([true, false, true, false]);
  });

  test('passes with every tool and tells the person how to start the editor', async () => {
    const results = await checkEnvironment('en', ready);
    expect(statuses(results)).toEqual({ node: 'ok', packages: 'ok', uv: 'ok', python: 'ok', chromium: 'ok' });
    expect(formatReport(results, 'en')).toContain('Everything is ready. Start the editor with: npm run dev');
  });

  test('an old Node.js or missing packages are errors', async () => {
    const results = await checkEnvironment('en', { ...ready, node: async () => '20.19.0', packages: async () => false });
    expect(statuses(results)).toMatchObject({ node: 'error', packages: 'error' });
    expect(formatReport(results, 'en')).toMatch(/✗ Node\.js 22\.17 or later is required \(found 20\.19\.0\)[\s\S]*✗ Packages are not installed\. Run: npm install[\s\S]*Fix the errors above/);
  });

  test('missing uv, Python or Chromium are warnings that keep the editor usable', async () => {
    const noUv = await checkEnvironment('en', { ...ready, uv: async () => null, chromium: async () => false });
    expect(statuses(noUv)).toEqual({ node: 'ok', packages: 'ok', uv: 'warn', python: 'warn', chromium: 'warn' });
    const report = formatReport(noUv, 'en');
    expect(report).toContain('Python was not checked because uv is missing.');
    expect(report).toContain('Creating avatars with an agent, or importing drawn eyes and mouths, needs it');
    expect(report).toContain('npx playwright install chromium');
    expect(report).toContain('You can start the editor with: npm run dev');
    const noPython = await checkEnvironment('en', { ...ready, python: async () => null });
    expect(formatReport(noPython, 'en')).toContain('uv python install 3.12');
  });

  test('a free-threaded Python is a warning because OpenCV has no package for it', async () => {
    const results = await checkEnvironment('en', { ...ready, python: async () => '3.14.0t' });
    expect(statuses(results).python).toBe('warn');
    expect(formatReport(results, 'en')).toContain('free-threaded Python 3.14.0');
  });

  test('reports in Japanese, chosen by flag or locale', async () => {
    expect([language(['--lang', 'ja'], {}), language(['--lang=en'], { LANG: 'ja_JP.UTF-8' }), language([], { LANG: 'ja_JP.UTF-8' }), language([], { LANG: 'en_US.UTF-8' })]).toEqual(['ja', 'en', 'ja', 'en']);
    const report = formatReport(await checkEnvironment('ja', { ...ready, chromium: async () => false }), 'ja');
    expect(report).toContain('⚠ Playwright の Chromium が見つかりません。エディタと配信画面はこのまま使えます。');
    expect(report).toContain('エディタは次のコマンドで起動できます: npm run dev');
  });

  test.each(['en', 'ja'])('reports uv failures separately from missing Python in %s', async lang => {
    const results = await checkEnvironment(lang, { ...ready, python: async () => ({ error: 'error: Failed to initialize cache' }) });
    const report = formatReport(results, lang);
    expect(statuses(results).python).toBe('warn');
    expect(report).toContain('error: Failed to initialize cache');
    expect(report).toContain('UV_CACHE_DIR');
    expect(report).not.toContain('uv python install');
    expect(report).toContain(lang === 'en' ? 'uv could not look for Python' : 'uv で Python を探せませんでした');
  });

  test.each(['en', 'ja'])('reports Chromium startup failures as warnings in %s', async lang => {
    const results = await checkEnvironment(lang, { ...ready, chromium: async () => ({ status: 'failed', error: 'Browser process exited' }) });
    const report = formatReport(results, lang);
    expect(statuses(results).chromium).toBe('warn');
    expect(report).toContain('Browser process exited');
    expect(report).toContain(lang === 'en' ? 'could not start or complete its WebGL2 check' : 'WebGL2 の確認を完了できませんでした');
    expect(report).toContain(lang === 'en' ? 'pose images cannot be rendered' : 'ポーズ画像を書き出せません');
    expect(report).not.toContain('npx playwright install');
  });

  test.each(['en', 'ja'])('reports unavailable WebGL2 as a warning in %s', async lang => {
    const results = await checkEnvironment(lang, { ...ready, chromium: async () => ({ status: 'no-webgl2' }) });
    const report = formatReport(results, lang);
    expect(statuses(results).chromium).toBe('warn');
    expect(report).toContain(lang === 'en' ? 'started, but WebGL2 is unavailable' : '起動しましたが、WebGL2 が使えません');
    expect(report).toContain(lang === 'en' ? 'pose images cannot be rendered' : 'ポーズ画像を書き出せません');
    expect(report).not.toContain('npx playwright install');
  });
});

describe('machine probes without running external tools', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked.executablePath.mockReturnValue(process.execPath);
    mocked.launch.mockResolvedValue({ newPage: mocked.newPage, close: mocked.close });
    mocked.newPage.mockResolvedValue({ evaluate: mocked.evaluate });
    mocked.evaluate.mockResolvedValue(true);
    mocked.close.mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

  test('only the known uv no-match diagnostic means Python is missing', async () => {
    mocked.execFile.mockImplementationOnce((_command, _args, _options, done) => done({ code: 2 }, '', 'error: No interpreter found for Python >=3.10 in virtual environments, managed installations, or search path\n'));
    expect(await probes.python()).toBeNull();
    mocked.execFile.mockImplementationOnce((_command, _args, _options, done) => done({ code: 2 }, '', 'error: No interpreter found for Python >=3.10 in search path\n  hint: a later uv may add a line here'));
    expect(await probes.python()).toBeNull();
  });

  test('preserves a short uv error summary for operational failures with the same exit code', async () => {
    mocked.execFile.mockImplementationOnce((_command, _args, _options, done) => done({ code: 2 }, '', 'error: Failed to initialize cache\n  cause: Permission denied\n  hint: cache folder\nadditional details'));
    const result = await probes.python();
    expect(result).toEqual({ error: 'error: Failed to initialize cache\n    cause: Permission denied\n    hint: cache folder' });
  });

  test('does not hide an unfamiliar uv error or a failed subprocess without stderr', async () => {
    mocked.execFile.mockImplementationOnce((_command, _args, _options, done) => done({ code: 2 }, '', 'error: Unexpected failure'));
    expect(await probes.python()).toEqual({ error: 'error: Unexpected failure' });
    mocked.execFile.mockImplementationOnce((_command, _args, _options, done) => done({ code: 'ENOENT', message: 'spawn uv ENOENT' }, '', ''));
    expect(await probes.python()).toEqual({ error: 'spawn uv ENOENT' });
  });

  test('keeps successful Python version detection', async () => {
    mocked.execFile.mockImplementationOnce((_command, _args, _options, done) => done(null, '/path/to/python\n', ''));
    mocked.execFile.mockImplementationOnce((_command, _args, _options, done) => done(null, '3.12.4\n', ''));
    expect(await probes.python()).toBe('3.12.4');
  });

  test('does not launch Chromium if its executable is missing', async () => {
    mocked.executablePath.mockReturnValue('');
    expect(await probes.chromium()).toBe(false);
    expect(mocked.launch).not.toHaveBeenCalled();
  });

  test('closes Chromium after a successful WebGL2 check', async () => {
    expect(await probes.chromium()).toBe(true);
    expect(mocked.close).toHaveBeenCalledOnce();
  });

  test('closes Chromium when WebGL2 is unavailable', async () => {
    mocked.evaluate.mockResolvedValue(false);
    expect(await probes.chromium()).toEqual({ status: 'no-webgl2' });
    expect(mocked.close).toHaveBeenCalledOnce();
  });

  test('returns startup errors without throwing', async () => {
    mocked.launch.mockRejectedValue(new Error('Launch failed\nMissing library\nMore information\nVerbose details'));
    expect(await probes.chromium()).toEqual({ status: 'failed', error: 'Launch failed\n  Missing library\n  More information' });
  });

  test('closes Chromium if creating a page fails', async () => {
    mocked.newPage.mockRejectedValue(new Error('Browser disconnected'));
    expect(await probes.chromium()).toEqual({ status: 'failed', error: 'Browser disconnected' });
    expect(mocked.close).toHaveBeenCalledOnce();
  });

  test('closes Chromium if the WebGL2 check times out', async () => {
    vi.useFakeTimers();
    mocked.evaluate.mockReturnValue(new Promise(() => {}));
    const pending = probes.chromium();
    await vi.waitFor(() => expect(mocked.evaluate).toHaveBeenCalled());
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ status: 'failed', error: 'Chromium WebGL2 check timed out.' });
    expect(mocked.close).toHaveBeenCalledOnce();
  });

  test('a browser close failure does not crash doctor', async () => {
    mocked.close.mockRejectedValue(new Error('Browser already closed'));
    expect(await probes.chromium()).toBe(true);
  });
});
