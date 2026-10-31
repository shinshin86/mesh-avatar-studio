// Classic-worker helper, deliberately free of browser/model dependencies.
// Two bad GPU windows trigger one CPU trial; a failed trial cannot cause flapping.
self.TrackingBudget = class TrackingBudget {
  constructor() { this.reset(); }
  reset() { this.mode = 'GPU'; this.frames = 0; this.bad = 0; this.samples = []; this.start = null; this.cooldown = -Infinity; this.gpu = null; }
  sample(total, poseRan, now) {
    if (now < this.cooldown || ++this.frames <= 5) return null;
    if (this.start === null) this.start = now;
    this.samples.push({ total, poseRan });
    if (this.samples.length < 16 || this.samples.filter(s => s.poseRan).length < 8 || now - this.start < 1000) return null;
    const value = { mean: this.samples.reduce((s, x) => s + x.total, 0) / this.samples.length, fps: (this.samples.length - 1) * 1000 / (now - this.start) };
    this.samples = []; this.start = null;
    if (this.mode === 'trial') {
      const better = value.mean < this.gpu.mean * 0.85 && value.fps > this.gpu.fps * 1.1;
      this.mode = better ? 'CPU' : 'GPU'; this.cooldown = now + 30000; this.frames = 0; this.bad = 0;
      return better ? 'keepCPU' : 'restoreGPU';
    }
    if (this.mode === 'CPU') return null;
    this.bad = value.mean > 1000 / 30 || value.fps < 15 ? this.bad + 1 : 0;
    if (this.bad < 2) return null;
    this.gpu = value; this.mode = 'trial'; this.frames = 0; return 'tryCPU';
  }
  failed(now) { this.mode = 'GPU'; this.cooldown = now + 30000; this.frames = 0; this.bad = 0; this.samples = []; this.start = null; }
};
