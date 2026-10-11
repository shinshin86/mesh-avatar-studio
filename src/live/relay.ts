import { LIGHTING_EVENT, lightingWire, lightingMessage, lightingValue } from '../lighting/protocol';
import type { LightingSettings } from 'mesh-avatar';
import { LIVE_EVENT, liveMessage } from './protocol';
import { EXPRESSION_EVENT, LIGHTING_PRESET_EVENT, expressionMessage, lightingPresetMessage, type RemoteExpression } from './expression-protocol';

export function createLiveSender(project: string, sender = randomSender()) {
  let sent = -Infinity;
  return (params: Record<string, number>, now: number) => {
    if (!import.meta.hot || now - sent < 1000 / 60) return;
    const message = liveMessage({ project, params, t: now, sender });
    if (message) { import.meta.hot.send(LIVE_EVENT, message); sent = now; }
  };
}
export function receiveLiveParameters(callback: (data: unknown) => void) {
  import.meta.hot?.on(LIVE_EVENT, callback);
  return () => import.meta.hot?.off(LIVE_EVENT, callback);
}

export function sendLighting(project: string, value: LightingSettings) {
  const message = lightingMessage(lightingWire(project, value));
  if (message) import.meta.hot?.send(LIGHTING_EVENT, message);
}
export function receiveLighting(project: string, callback: (value: LightingSettings) => void) {
  const receive = (data: unknown) => { const message = lightingMessage(data); if (message?.project === project) callback(lightingValue(message)); };
  import.meta.hot?.on(LIGHTING_EVENT, receive);
  return () => import.meta.hot?.off(LIGHTING_EVENT, receive);
}

/** Expressions sent from other apps; a message without a project applies to every Live page. */
export function receiveExpression(project: string, callback: (expression: RemoteExpression) => void) {
  const receive = (data: unknown) => { const message = expressionMessage(data); if (message && (message.project === null || message.project === project)) callback(message.expression); };
  import.meta.hot?.on(EXPRESSION_EVENT, receive);
  return () => import.meta.hot?.off(EXPRESSION_EVENT, receive);
}
/** Lighting preset numbers (1–8) sent from other apps, addressed like expressions. */
export function receiveLightingPreset(project: string, callback: (preset: number) => void) {
  const receive = (data: unknown) => { const message = lightingPresetMessage(data); if (message && (message.project === null || message.project === project)) callback(message.preset); };
  import.meta.hot?.on(LIGHTING_PRESET_EVENT, receive);
  return () => import.meta.hot?.off(LIGHTING_PRESET_EVENT, receive);
}

export function randomSender() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
}

/** Tells Live pages in this browser when another one has the same project open. */
export function watchDuplicateLivePages(project: string, onChange: (duplicate: boolean) => void) {
  if (typeof BroadcastChannel === 'undefined') return () => undefined;
  const id = randomSender(), channel = new BroadcastChannel('mesh-avatar-live-pages');
  let seen = -Infinity, duplicate = false;
  const update = () => { const next = performance.now() - seen < 5000; if (next !== duplicate) onChange(duplicate = next); };
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as { project?: unknown; id?: unknown; leaving?: unknown } | null;
    if (!data || data.project !== project || data.id === id) return;
    seen = data.leaving === true ? -Infinity : performance.now(); update();
  };
  const announce = () => channel.postMessage({ project, id });
  announce();
  const timer = setInterval(() => { announce(); update(); }, 2000);
  return () => { clearInterval(timer); channel.postMessage({ project, id, leaving: true }); channel.close(); };
}
