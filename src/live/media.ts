import { createTrackingWorker, type TrackingWorkerMessage } from './face-tracker';
import { rmsLevel, type FaceResult } from './tracking';

export type CameraState = 'stopped' | 'starting' | 'running' | 'cameraBlocked' | 'cameraUnavailable' | 'modelError';
export type BackgroundTracking = 'backgroundStopped' | 'backgroundSlow' | null;
type TrackProcessor = new (options: { track: MediaStreamTrack; maxBufferSize: number }) => { readable: ReadableStream<VideoFrame> };
export class CameraCapture {
  private bodyTracking = false;
  setBodyTracking(enabled: boolean) { this.bodyTracking = enabled; this.worker?.postMessage({ type: 'body', enabled }); }
  private generation = 0;
  private stream?: MediaStream;
  private worker?: Worker;
  private reader?: ReadableStreamDefaultReader<VideoFrame>;
  private pendingFrame?: VideoFrame;
  private videoCallback = 0;
  private busy = false;
  private lastVideo = -1;
  private lastCallback = -Infinity;
  private started = Infinity;
  private results: number[] = [];
  readonly timing = { frames: 0, totalMs: 0, maxMs: 0, delegate: '', source: '' };
  constructor(private video: HTMLVideoElement, private onResult: (result: FaceResult, now: number) => void, private onState: (state: CameraState) => void,
    private workerUrl?: string) {}
  stop() {
    this.generation++;
    if (this.videoCallback) this.video.cancelVideoFrameCallback?.(this.videoCallback);
    this.videoCallback = 0;
    void this.reader?.cancel().catch(() => undefined); this.reader = undefined;
    this.pendingFrame?.close(); this.pendingFrame = undefined;
    this.worker?.terminate(); this.worker = undefined;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    this.video.srcObject = null;
    this.busy = false; this.started = Infinity; this.results = [];
    this.onState('stopped');
  }
  backgroundStatus(hidden: boolean, now: number): BackgroundTracking {
    this.results = this.results.filter(time => now - time < 2000);
    if (!hidden || now - this.started < 2000) return null;
    if (!this.results.length || now - this.results[this.results.length - 1] > 1000) return 'backgroundStopped';
    return this.results.length / 2 < 15 ? 'backgroundSlow' : null;
  }
  async start(deviceId: string) {
    this.stop(); const generation = this.generation;
    this.onState('starting');
    let loadingModel = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream; this.video.srcObject = stream;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('Camera unavailable');
      track.addEventListener('ended', () => { if (this.stream === stream) { this.stop(); this.onState('cameraUnavailable'); } }, { once: true });
      // Preview playback must not gate track processing when the document is hidden.
      void this.video.play().catch(() => undefined);
      loadingModel = true;
      const worker = createTrackingWorker(this.workerUrl); this.worker = worker;
      const fail = () => { if (generation === this.generation) { this.stop(); this.onState('modelError'); } };
      worker.onerror = fail;
      worker.onmessage = ({ data }: MessageEvent<TrackingWorkerMessage>) => {
        if (generation !== this.generation) return;
        if (data.type === 'ready') {
          this.timing.delegate = data.delegate; this.started = performance.now();
          this.onState('running'); this.startFrames(track, generation);
        } else if (data.type === 'delegate') this.timing.delegate = data.delegate;
        else if (data.type === 'result') {
          const now = performance.now(); this.results.push(now);
          this.results = this.results.filter(time => now - time < 2000);
          this.timing.frames++; this.timing.totalMs += data.elapsed; this.timing.maxMs = Math.max(this.timing.maxMs, data.elapsed);
          this.onResult(data.result, now);
        } else if (data.type === 'consumed') {
          this.busy = false;
          if (this.pendingFrame) { const frame = this.pendingFrame; this.pendingFrame = undefined; this.sendFrame(frame); }
        }
        else if (data.type === 'tick' && !this.reader && performance.now() - this.lastCallback > 100) void this.sendBitmap(generation);
        else if (data.type === 'error') fail();
      };
      worker.postMessage({ type: 'init', ...(this.bodyTracking ? { bodyTracking: true } : {}) });
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      this.onState(loadingModel ? 'modelError' : error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name) ? 'cameraBlocked' : 'cameraUnavailable');
    }
  }
  private startFrames(track: MediaStreamTrack, generation: number) {
    this.lastVideo = -1; this.lastCallback = -Infinity;
    const Processor = (globalThis as typeof globalThis & { MediaStreamTrackProcessor?: TrackProcessor }).MediaStreamTrackProcessor;
    if (Processor) {
      try {
        this.reader = new Processor({ track, maxBufferSize: 1 }).readable.getReader();
        this.timing.source = 'track-processor';
        void this.readFrames(this.reader, generation); return;
      } catch { /* Fall back on browsers that expose an unusable processor. */ }
    }
    this.startVideoCallbacks(generation);
  }
  private async readFrames(reader: ReadableStreamDefaultReader<VideoFrame>, generation: number) {
    try {
      while (generation === this.generation) {
        const { value, done } = await reader.read();
        if (done) break;
        if (generation !== this.generation) { value.close(); continue; }
        if (this.busy) { this.pendingFrame?.close(); this.pendingFrame = value; continue; }
        this.sendFrame(value);
      }
    } catch { /* A failed track processor can still have a playable video preview. */ }
    finally {
      reader.releaseLock();
      if (generation === this.generation) { this.reader = undefined; this.startVideoCallbacks(generation); }
    }
  }
  private startVideoCallbacks(generation: number) {
    if (generation !== this.generation) return;
    this.timing.source = typeof this.video.requestVideoFrameCallback === 'function' ? 'video-frame-callback' : 'worker-timer';
    if (typeof this.video.requestVideoFrameCallback !== 'function') return;
    const frame = () => {
      if (generation !== this.generation) return;
      this.lastCallback = performance.now();
      void this.sendBitmap(generation);
      this.videoCallback = this.video.requestVideoFrameCallback(frame);
    };
    this.videoCallback = this.video.requestVideoFrameCallback(frame);
  }
  private sendFrame(frame: VideoFrame | ImageBitmap) {
    this.busy = true;
    try { this.worker!.postMessage({ type: 'frame', frame, timestamp: 'timestamp' in frame ? frame.timestamp / 1000 : this.video.currentTime * 1000 }, [frame]); }
    catch { frame.close(); this.busy = false; this.stop(); this.onState('modelError'); }
  }
  private async sendBitmap(generation: number) {
    if (this.busy || this.video.readyState < 2 || this.video.currentTime === this.lastVideo) return;
    this.busy = true; this.lastVideo = this.video.currentTime;
    try {
      const bitmap = await createImageBitmap(this.video);
      if (generation !== this.generation) { bitmap.close(); return; }
      this.sendFrame(bitmap);
    } catch { if (generation === this.generation) this.busy = false; }
  }
}

export type MicState = 'micOff' | 'micStarting' | 'micOn' | 'micBlocked' | 'micUnavailable';
export class MicrophoneCapture {
  private generation = 0;
  private stream?: MediaStream;
  private context?: AudioContext;
  private analyser?: AnalyserNode;
  private samples = new Float32Array(1024);
  constructor(private onState: (state: MicState) => void) {}
  stop() {
    this.generation++;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = undefined;
    void this.context?.close().catch(() => undefined); this.context = undefined; this.analyser = undefined;
    this.onState('micOff');
  }
  async start(deviceId: string) {
    this.stop(); const generation = this.generation; this.onState('micStarting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getAudioTracks()[0]?.addEventListener('ended', () => { if (this.stream === stream) { this.stop(); this.onState('micUnavailable'); } }, { once: true });
      const context = new AudioContext(); this.context = context;
      await context.resume();
      if (generation !== this.generation) return;
      this.analyser = context.createAnalyser(); this.analyser.fftSize = this.samples.length;
      context.createMediaStreamSource(stream).connect(this.analyser);
      // Never connect to the audio output or record the captured samples.
      this.onState('micOn');
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop(); this.onState(error instanceof DOMException && error.name === 'NotAllowedError' ? 'micBlocked' : 'micUnavailable');
    }
  }
  level(gain: number) {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    return rmsLevel(this.samples, gain);
  }
}
