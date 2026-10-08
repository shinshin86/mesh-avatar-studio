import { LIGHTING_EVENT, lightingWire, lightingMessage, lightingValue } from '../lighting/protocol';
import type { LightingSettings } from '../lighting/settings';
import { LIVE_EVENT, liveMessage } from './protocol';
import { EXPRESSION_EVENT, expressionMessage, type RemoteExpression } from './expression-protocol';

export function createLiveSender(project: string) {
  let sent = -Infinity;
  return (params: Record<string, number>, now: number) => {
    if (!import.meta.hot || now - sent < 1000 / 60) return;
    const message = liveMessage({ project, params, t: now });
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
