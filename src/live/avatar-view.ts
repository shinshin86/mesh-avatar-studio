import { createMeshAvatar, loadMeshAvatar, type MeshAvatar, PARAMS } from 'mesh-avatar';
import { localProjects, openLocalProject, openSampleAvatar } from '../editor/project';
import { SAMPLE_PROJECT, type ViewSettings } from './settings';

export const neutralParameters: Record<string, number> = Object.fromEntries(PARAMS.map(param => [param.id, param.def]));
export interface FrameTiming { frames: number; totalMs: number; maxMs: number }
/** Names of the avatar's overlay layers (built/overlays/overlays.json), or none. */
async function listOverlays(assets: Record<string, string>): Promise<string[]> {
  const url = assets['overlays/overlays.json'];
  if (!url) return [];
  try {
    const sheet = await (await fetch(url)).json();
    return Array.isArray(sheet?.overlays) ? sheet.overlays.map((item: { name?: unknown }) => item?.name).filter((name: unknown): name is string => typeof name === 'string') : [];
  } catch { return []; }
}
export async function createAvatarView(canvas: HTMLCanvasElement, settings: ViewSettings,
  beforeFrame?: (avatar: MeshAvatar, now: number, dt: number) => void,
  afterFrame?: (avatar: MeshAvatar, now: number) => void) {
  canvas.dataset.state = 'loading';
  const options = { manual: true, fit: settings.fit, preserveMouthForm: true };
  let avatar: MeshAvatar, overlays: string[] = [];
  if (settings.avatar) avatar = await loadMeshAvatar(canvas, settings.avatar, options);
  else {
    const projects = await localProjects(), project = projects?.find(entry => entry.name === settings.project);
    if (project?.error || (!project && settings.project !== SAMPLE_PROJECT)) throw new Error('Project unavailable');
    const loaded = project ? await openLocalProject(project) : await openSampleAvatar();
    const lipSync = 'manifest' in loaded ? loaded.manifest.lipSync : loaded.lipSync;
    avatar = await createMeshAvatar(canvas, { ...options, lipSync, rig: loaded.rig!, assets: loaded.assets });
    overlays = await listOverlays(loaded.assets);
  }
  if (settings.lighting) avatar.setLighting(settings.lighting);
  if (settings.overlays) avatar.setOverlays(settings.overlays);
  avatar.setAutoIdle(settings.idle); avatar.setAutoMotion(settings.idle);
  if (!settings.idle) avatar.setParameters(neutralParameters);
  canvas.dataset.state = 'ready';
  const timing: FrameTiming = { frames: 0, totalMs: 0, maxMs: 0 };
  let raf = 0, previous = performance.now(), lastPaint = previous;
  const update = (now: number, draw = true) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - previous) / 1000)); previous = now;
    beforeFrame?.(avatar, now, dt);
    const start = performance.now();
    if (draw) avatar.advance(dt, 1 / dt); else avatar.advanceParameters(dt);
    const elapsed = performance.now() - start;
    if (draw) { timing.frames++; timing.totalMs += elapsed; timing.maxMs = Math.max(timing.maxMs, elapsed); }
    afterFrame?.(avatar, now);
  };
  const frame = (now: number) => { lastPaint = now; update(now); raf = requestAnimationFrame(frame); };
  raf = requestAnimationFrame(frame);
  return { avatar, timing, overlays,
    paintPaused(now: number) { return now - lastPaint > 1000; },
    updateIfStalled(now: number) { if (now - previous >= 1000 / 30 - 2) update(now, false); },
    destroy() { cancelAnimationFrame(raf); avatar.destroy(); } };
}
