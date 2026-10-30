// Camera frames stay in this worker. Only the face pose and timing return to the page.
// Asset paths are relative to this worker, so the files can be served under any folder.
const base = new URL('.', self.location.href).href.replace(/\/$/, '');
self.exports = {};
self.importScripts(`${base}/vision_bundle.js`);
const { FaceLandmarker, PoseLandmarker, FilesetResolver } = self.exports;
let pose, files, bodyEnabled = false, bodyFrame = 0, faceOnlyDelegate = 'GPU', configuration = Promise.resolve();
let budget;
let tracker, lastFrame = -Infinity, delegate = 'GPU', frames = 0, gpuSamples = 0, gpuMs = 0;
async function pairDelegate(value) {
  await tracker.setOptions({ baseOptions: { delegate: value } });
  if (pose) await pose.setOptions({ baseOptions: { delegate: value } });
  delegate = value; self.postMessage({ type: 'delegate', delegate });
}
async function configureBody(enabled) {
  if (enabled && !budget) { self.importScripts(`${base}/tracking-budget.js`); budget = new self.TrackingBudget(); }
  bodyFrame = 0; budget?.reset(); frames = 0; gpuSamples = 0; gpuMs = 0;
  if (!enabled) {
    bodyEnabled = false; pose?.close(); pose = null;
    if (delegate !== faceOnlyDelegate) await pairDelegate(faceOnlyDelegate);
    return;
  }
  if (pose && bodyEnabled) return;
  faceOnlyDelegate = delegate; bodyEnabled = true;
  try {
    if (delegate !== 'GPU') await pairDelegate('GPU');
    pose = await PoseLandmarker.createFromOptions(files, { runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: false,
      baseOptions: { modelAssetPath: `${base}/pose_landmarker_lite.task`, delegate: 'GPU' } });
  } catch {
    pose?.close(); pose = null;
    // Face tracking remains available when optional body initialization fails.
    if (delegate !== faceOnlyDelegate) await pairDelegate(faceOnlyDelegate);
  }
}
async function handleMessage({ data }) {
  if (data.type === 'init') {
    try {
      files = await FilesetResolver.forVisionTasks(base);
      const options = { runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true };
      try { tracker = await FaceLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: `${base}/face_landmarker.task`, delegate } }); }
      catch {
        delegate = 'CPU';
        tracker = await FaceLandmarker.createFromOptions(files, { ...options, baseOptions: { modelAssetPath: `${base}/face_landmarker.task`, delegate } });
      }
      if (data.bodyTracking) await configureBody(true);
      self.postMessage({ type: 'ready', delegate });
      // Also wakes the ImageBitmap fallback when video frame callbacks stop in a hidden tab.
      self.setInterval(() => self.postMessage({ type: 'tick' }), 1000 / 30);
    } catch { self.postMessage({ type: 'error' }); }
  } else if (data.type === 'body') {
    try { await configureBody(!!data.enabled); } catch { bodyEnabled = false; pose?.close(); pose = null; }
  } else if (data.type === 'frame') {
    try {
      const now = performance.now();
      if (tracker && data.timestamp - lastFrame >= 1000 / 30 - 2) {
        lastFrame = data.timestamp;
        const start = performance.now(), result = tracker.detectForVideo(data.frame, now);
        const faceElapsed = performance.now() - start;
        const poseRan = bodyEnabled && !!pose && bodyFrame++ % 2 === 0;
        let body = null;
        if (poseRan) {
          try { body = pose.detectForVideo(data.frame, now); }
          catch { pose.close(); pose = null; if (delegate !== faceOnlyDelegate) await pairDelegate(faceOnlyDelegate); }
        }
        const elapsed = performance.now() - start;
        const landmarks = body?.landmarks[0];
        const point = i => ({ x: landmarks[i].x, y: landmarks[i].y, visibility: landmarks[i].visibility ?? 0, presence: landmarks[i].presence ?? 1 });
        self.postMessage({ type: 'result', elapsed, result: {
          faceLandmarks: result.faceLandmarks.length ? [[]] : [],
          faceBlendshapes: result.faceBlendshapes,
          facialTransformationMatrixes: result.facialTransformationMatrixes,
          ...(bodyEnabled && (!pose || poseRan) ? { body: landmarks?.length >= 25 ? { shoulders: [point(11), point(12)], hips: [point(23), point(24)], elbows: [point(13), point(14)], wrists: [point(15), point(16)], aspect: (data.frame.displayWidth || data.frame.width) / (data.frame.displayHeight || data.frame.height) } : null } : {}),
        } });
        // Some worker GPU backends initialize but run too slowly. Ignore warm-up, then
        // try CPU if sustained inference alone cannot meet the 15 fps target.
        if (bodyEnabled && pose) {
          const decision = budget.sample(elapsed, poseRan, performance.now());
          try {
            if (decision === 'tryCPU') await pairDelegate('CPU');
            if (decision === 'restoreGPU') await pairDelegate('GPU');
          } catch { await pairDelegate('GPU'); budget.failed(performance.now()); }
        } else if ((!bodyEnabled || !pose) && delegate === 'GPU' && ++frames > 5) {
          gpuMs += faceElapsed;
          if (++gpuSamples === 8) {
            if (gpuMs / gpuSamples > 1000 / 15) {
              await tracker.setOptions({ baseOptions: { delegate: 'CPU' } });
              delegate = 'CPU'; self.postMessage({ type: 'delegate', delegate });
            }
            gpuMs = 0; gpuSamples = 0;
          }
        }
      }
    } catch { self.postMessage({ type: 'error' }); }
    finally { data.frame.close(); self.postMessage({ type: 'consumed' }); }
  }
 }
// Serialize initialization, control changes and frames. Delegate changes await model
// rebuilding; an off toggle must not close a pose model in the middle of that work.
self.onmessage = event => {
  const operation = configuration.then(() => handleMessage(event));
  configuration = operation.catch(() => {});
  return operation;
};
