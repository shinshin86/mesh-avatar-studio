import { LIGHTING_EVENT, lightingMessage } from '../lighting/protocol';
import type { Plugin, WebSocketClient } from 'vite';
import { LIVE_EVENT, liveMessage } from '../live/protocol';
import { resolve } from 'node:path';
import { EXPRESSION_EVENT, LIGHTING_PRESET_EVENT } from '../live/expression-protocol';
import { expressionRemote } from './expression-remote';

export function liveRelay(root: string): Plugin {
  return {
    name: 'local-live-relay',
    configureServer(server) {
      server.middlewares.use(expressionRemote(resolve(root, 'projects', '.expression-token'),
        message => server.ws.send(EXPRESSION_EVENT, message), message => server.ws.send(LIGHTING_PRESET_EVENT, message)));
      const lastLighting = new WeakMap<WebSocketClient['socket'], number>();
      server.ws.on(LIGHTING_EVENT, (data, client) => {
        const message = lightingMessage(data), now = performance.now();
        if (!message || now - (lastLighting.get(client.socket) ?? -Infinity) < 1000 / 60) return;
        lastLighting.set(client.socket, now);
        server.ws.send(LIGHTING_EVENT, message);
      });
      const lastSent = new WeakMap<WebSocketClient['socket'], number>();
      server.ws.on(LIVE_EVENT, (data, client) => {
        const now = performance.now();
        if (now - (lastSent.get(client.socket) ?? -Infinity) < 1000 / 60) return;
        const message = liveMessage(data);
        if (!message) return;
        lastSent.set(client.socket, now);
        server.ws.send(LIVE_EVENT, message);
      });
    },
  };
}
