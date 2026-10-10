import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { samplePresent, sampleSkipReason } from './sample';

test.beforeEach(() => { test.skip(!samplePresent, sampleSkipReason); });

async function guardNetwork(context: BrowserContext) {
  const outside: string[] = [];
  await context.route('**/*', route => {
    if (new URL(route.request().url()).hostname !== '127.0.0.1') { outside.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const watchSockets = (page: Page) => page.on('websocket', socket => {
    if (new URL(socket.url()).hostname !== '127.0.0.1') outside.push(socket.url());
  });
  context.pages().forEach(watchSockets); context.on('page', watchSockets);
  return outside;
}
async function syntheticMedia(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [] });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async (constraints: MediaStreamConstraints) => {
      if (constraints.audio) {
        const audio = new AudioContext(), oscillator = audio.createOscillator(), gain = audio.createGain();
        gain.gain.value = 0.3;
        const target = audio.createMediaStreamDestination();
        oscillator.connect(gain).connect(target); oscillator.start(); await audio.resume();
        const track = target.stream.getTracks()[0], stop = track.stop.bind(track);
        track.stop = () => { oscillator.stop(); void audio.close(); stop(); };
        return target.stream;
      }
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      const draw = () => { if ((window as Window & { freezeVideo?: boolean }).freezeVideo) return; ctx.fillStyle = '#999'; ctx.fillRect(0, 0, 640, 480); ctx.fillStyle = '#fff'; ctx.fillRect(Date.now() % 500, 100, 40, 40); };
      draw(); const timer = window.setInterval(draw, 33);
      const stream = canvas.captureStream(30), track = stream.getTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      return stream;
    } });
  });
}
async function stubTracker(page: Page, moving = false) {
  await page.context().route('**/mediapipe/vision_bundle.cjs', route => route.fulfill({ contentType: 'application/javascript', body: `
    self.exports.FilesetResolver = { forVisionTasks: async () => ({}) };
    self.exports.FaceLandmarker = { createFromOptions: async () => ({ close() {}, detectForVideo() {
      const a = ${moving ? 'Math.sin(performance.now() / 300) * 24' : '24'} * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return { faceLandmarks: [[]], facialTransformationMatrixes: [{ data: [c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1] }],
        faceBlendshapes: [{ categories: [{ categoryName: 'mouthPucker', score: .8 }, { categoryName: 'jawOpen', score: .1 }] }] };
    } }) };` }));
}
async function ready(page: Page, url: string) {
  await page.goto(url); await expect(page.locator('canvas[data-state="ready"]')).toBeVisible();
}

test('stream has actual alpha, exact green, no controls and no external requests', async ({ context, page }) => {
  const outside = await guardNetwork(context);
  for (const bg of ['transparent', 'green']) {
    await ready(page, `/stream.html?bg=${bg}&idle=0`);
    const image = PNG.sync.read(await page.screenshot({ omitBackground: true }));
    expect([...image.data.subarray(0, 4)]).toEqual(bg === 'transparent' ? [0, 0, 0, 0] : [0, 255, 0, 255]);
    expect(await page.locator('body > :not(canvas):not(script)').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
  expect(outside).toEqual([]);
});

test('relay changes only the matching stream and eases back after updates stop', async ({ context, page }) => {
  const outside = await guardNetwork(context);
  await ready(page, '/stream.html?idle=0');
  const sender = await context.newPage(); await ready(sender, '/live.html');
  const send = async (project: string, angleX: number) => sender.evaluate(async ({ project, angleX }) => {
    const path = '/src/live/relay.ts'; const { createLiveSender } = await import(path);
    createLiveSender(project)({ angleX, angleZ: angleX / 2, mouthOpen: 0.8 }, performance.now());
  }, { project, angleX });
  const canvas = page.locator('#avatar');
  await send('another-project', 30);
  await expect(canvas).toHaveAttribute('data-live', 'idle');
  const before = PNG.sync.read(await canvas.screenshot());
  await send('sample-miko-qipao', 30);
  await expect(canvas).toHaveAttribute('data-live', 'active');
  const after = PNG.sync.read(await canvas.screenshot());
  let changed = 0;
  for (let i = 0; i < before.data.length; i += 4) if (Math.abs(before.data[i] - after.data[i]) > 15) changed++;
  expect(changed).toBeGreaterThan(500);
  await expect(canvas).toHaveAttribute('data-live', 'idle', { timeout: 2500 });
  expect(outside).toEqual([]);
});

test('live controls calibrate, mirror, compose mic mouth, localize and relay without a physical camera', async ({ context, page }) => {
  const outside = await guardNetwork(context), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await syntheticMedia(page); await stubTracker(page); await ready(page, '/live.html');
  const stream = await context.newPage(); await ready(stream, '/stream.html');
  const mic = page.getByRole('checkbox', { name: 'Microphone lip sync' });
  await expect(mic).not.toBeChecked();
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-state', 'tracking');
  await expect(stream.locator('#avatar')).toHaveAttribute('data-live', 'active');
  const nextParams = () => page.evaluate(async () => {
    const path = '/src/live/relay.ts'; const { receiveLiveParameters } = await import(path);
    return await new Promise<Record<string, number>>(resolve => {
      const off = receiveLiveParameters((data: { params: Record<string, number> }) => { off(); resolve(data.params); });
    });
  });
  expect((await nextParams()).angleX).toBeLessThan(-10);
  await page.getByRole('checkbox', { name: 'Mirror', exact: true }).uncheck();
  await expect.poll(async () => (await nextParams()).angleX).toBeGreaterThan(15);
  await mic.check();
  await expect.poll(async () => (await nextParams()).mouthOpen).toBeGreaterThan(0.5);
  expect((await nextParams()).mouthForm).toBeCloseTo(0.8, 1);
  await mic.uncheck();
  await page.getByRole('button', { name: 'Calibrate', exact: true }).click();
  await expect(page.getByText('Neutral pose saved', { exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs((await nextParams()).angleX)).toBeLessThan(0.5);
  await page.getByRole('checkbox', { name: 'Show camera preview' }).uncheck();
  await expect(page.locator('video')).toHaveClass(/camera-hidden/);
  await expect(page.getByTestId('background-hint')).toContainText('Browser Source');
  await expect(page.getByTestId('background-hint')).toContainText('Window Capture does not keep transparency');
  await page.getByLabel('Background', { exact: true }).selectOption('#00ff00');
  await expect(page.getByTestId('background-hint')).toContainText('Chroma Key');
  expect(await page.getByRole('textbox', { name: 'Copy OBS URL' }).inputValue()).toContain('bg=%2300ff00');
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByRole('button', { name: '正面の姿勢を登録', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.getByRole('button', { name: '校准', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '停止摄像头', exact: true }).click();
  await expect(stream.locator('#avatar')).toHaveAttribute('data-live', 'idle', { timeout: 2500 });
  expect(errors).toEqual([]); expect(outside).toEqual([]);
});

test('camera denial is explained without starting capture', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  });
  await ready(page, '/live.html');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-state', 'cameraBlocked');
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeEnabled();
});

test('real tracking runtime loads its model and WASM locally with synthetic video only', async ({ context, page }) => {
  test.setTimeout(60000);
  const outside = await guardNetwork(context), assets: string[] = [], errors: string[] = [];
  context.on('request', request => { if (request.url().includes('/mediapipe/')) assets.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await syntheticMedia(page); await ready(page, '/live.html');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-state', 'lost', { timeout: 45000 });
  // Give the initialized runtime several inference frames to expose any outbound requests.
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop camera', exact: true }).click();
  expect(assets.some(url => url.endsWith('/face_landmarker.task'))).toBe(true);
  expect(assets.some(url => url.endsWith('.wasm'))).toBe(true);
  expect(errors).toEqual([]); expect(outside).toEqual([]);
});

async function hideControls(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    // Visibility alone does not pause RAF in a headless test. Also stop both painting callbacks.
    window.requestAnimationFrame = () => 0;
    HTMLVideoElement.prototype.requestVideoFrameCallback = () => 0;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

for (const source of ['processor', 'video-callback', 'worker-timer']) {
  test(`hidden control page relays fresh poses at 15 fps or more using ${source}`, async ({ context, page }) => {
    const outside = await guardNetwork(context);
    if (source !== 'processor') await page.addInitScript(source => {
      Object.defineProperty(window, 'MediaStreamTrackProcessor', { value: undefined });
      if (source === 'worker-timer') Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', { value: undefined, writable: true });
    }, source);
    await syntheticMedia(page); await stubTracker(page, true); await ready(page, '/live.html');
    const stream = await context.newPage(); await ready(stream, '/stream.html');
    await page.getByRole('button', { name: 'Start camera', exact: true }).click();
    await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-state', 'tracking');
    await hideControls(page); await stream.bringToFront();
    const metrics = await stream.evaluate(async () => {
      const path = '/src/live/relay.ts', { receiveLiveParameters } = await import(path);
      const samples: { time: number; angle: number }[] = [], start = performance.now();
      const off = receiveLiveParameters((data: { params: Record<string, number> }) => { samples.push({ time: performance.now(), angle: data.params.angleX }); });
      await new Promise(resolve => setTimeout(resolve, 4000)); off();
      return { fps: samples.length / ((performance.now() - start) / 1000), range: Math.max(...samples.map(p => p.angle)) - Math.min(...samples.map(p => p.angle)), maxGap: Math.max(...samples.slice(1).map((p, i) => p.time - samples[i].time)) };
    });
    expect(metrics.fps).toBeGreaterThanOrEqual(15); expect(metrics.range).toBeGreaterThan(15); expect(metrics.maxGap).toBeLessThan(1000);
    await expect(stream.locator('#avatar')).toHaveAttribute('data-live', 'active');
    await expect(page.getByTestId('background-status')).toHaveCount(0);
    expect(outside).toEqual([]);
    console.log(`Hidden ${source}: ${JSON.stringify(metrics)}`);
  });
}

test('hidden tracking stall warns in all languages and clears when fresh frames resume', async ({ page }) => {
  await syntheticMedia(page); await stubTracker(page); await ready(page, '/live.html');
  await page.getByRole('button', { name: 'Start camera', exact: true }).click();
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-state', 'tracking');
  await hideControls(page);
  await page.evaluate(() => { (window as Window & { freezeVideo?: boolean }).freezeVideo = true; });
  await expect(page.getByTestId('background-status')).toContainText('Tracking has stopped', { timeout: 5000 });
  await page.getByRole('button', { name: '日本語', exact: true }).click();
  await expect(page.getByTestId('background-status')).toContainText('この画面が隠れているため追跡が止まっています');
  await page.getByRole('button', { name: '简体中文', exact: true }).click();
  await expect(page.getByTestId('background-status')).toContainText('面部追踪已停止');
  await page.evaluate(() => { (window as Window & { freezeVideo?: boolean }).freezeVideo = false; });
  await expect(page.getByTestId('background-status')).toHaveCount(0, { timeout: 5000 });
});
