# MediaPipe Face Landmarker

- Asset: `face_landmarker.task`, Face Landmarker float16, model version 1.
- Source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`
- Downloaded: 2026-10-05. The model is unmodified.
- Copyright: The MediaPipe Authors. Licensed under the Apache License, Version 2.0;
  see [LICENSE](LICENSE). Distributed without warranties or conditions of any kind.

The runtime uses `@mediapipe/tasks-vision` version **0.10.21**, pinned in `package.json`
and `package-lock.json`. Its JavaScript and WASM are licensed under Apache-2.0.
Vite serves the installed WASM files at `/mediapipe/` and includes them, this model,
and these notices in builds. No CDN or remote model request is needed at runtime.

This version is retained because version 1.0.1 includes metrics reporting to an external
service. Before upgrading, inspect the JavaScript bundle and WASM loading scripts for
telemetry and remote asset URLs, then run the live and stream network-isolation tests
with the real tracker initialized. All assets must still load locally, with no outbound
requests. Camera frames and microphone audio are processed locally and are never
included in relay messages.

## Optional Pose Landmarker lite

- Asset: `pose_landmarker_lite.task`, float16, model version 1; 5,777,746 bytes.
- Source: https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task
- SHA-256: `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a`
- Downloaded: 2026-10-29. The model is unmodified.
- Copyright: The MediaPipe Authors. Apache License, Version 2.0 (see LICENSE).
  The [official model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf),
  page 2, specifies the model license.

Body tracking is off by default. The worker loads this local model only when body
tracking is enabled, and runs it on every second accepted face frame. Only numeric
shoulder/hip coordinates return; no frame, segmentation mask or image is returned.
