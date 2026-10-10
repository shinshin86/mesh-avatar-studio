import { createAvatarView, neutralParameters } from './avatar-view';
import { viewSettings } from './settings';
import { LivePose } from './protocol';
import { receiveLighting, receiveLiveParameters } from './relay';
import './stream.css';

const settings = viewSettings(location.search);
document.documentElement.style.background = settings.background;
const canvas = document.querySelector<HTMLCanvasElement>('#avatar')!;
const pose = new LivePose(settings.project);
let avatarInstance: import('mesh-avatar').MeshAvatar | undefined;
const unsubscribeLighting = receiveLighting(settings.project, value => { settings.lighting = value; avatarInstance?.setLighting(value); });
const unsubscribe = receiveLiveParameters(data => pose.receive(data, performance.now()));
void createAvatarView(canvas, settings, (avatar, now, dt) => {
  const sampled = pose.sample(now, dt);
  canvas.dataset.live = sampled.active ? 'active' : 'idle';
  avatar.setAutoIdle(settings.idle && !sampled.active); avatar.setAutoMotion(settings.idle && !sampled.active);
  if (settings.idle) avatar.setParameters(sampled.params, sampled.weight);
  else {
    const params = { ...neutralParameters };
    for (const [key, value] of Object.entries(sampled.params)) params[key] = (params[key] ?? 0) * (1 - sampled.weight) + value * sampled.weight;
    avatar.setParameters(params);
  }
}).then(view => {
  avatarInstance = view.avatar;
  if (settings.lighting) view.avatar.setLighting(settings.lighting);
  const destroy = () => { unsubscribe(); unsubscribeLighting(); avatarInstance = undefined; view.destroy(); };
  window.addEventListener('pagehide', destroy, { once: true });
  import.meta.hot?.dispose(destroy);
}).catch(() => { unsubscribe(); unsubscribeLighting(); canvas.dataset.state = 'error'; });
