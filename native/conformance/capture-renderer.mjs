// Capture the real avatar tick path without a browser or GPU.
import { createRenderer as realRenderer } from '../../packages/runtime/src/engine/renderer.js';
export const capture = { renderer: null };
const f32 = values => Array.from(new Float32Array(values));

export function createRenderer(engine, rig) {
  const { buildGrid } = realRenderer(engine, rig);
  class Renderer {
    constructor() { this.layers = []; capture.renderer = this; }
    addLayer(name, image, mesh, options = {}) {
      const layer = { name, image, mesh, visible: true, ...options };
      this.layers.push(layer); return layer;
    }
    draw(state) { this.state = state; }
    destroy() {}
    snapshot() {
      const state = this.state, mouth = rig.mouth;
      return { layers: this.layers.filter(layer => layer.visible && !layer.overlay).map(layer => ({
        name: layer.name, texture: layer.image.asset ?? `${layer.name.startsWith('eyes_') || layer.name.startsWith('mouth_') ? 'sprites/' : ''}${layer.name}.png`,
        rect: layer.mesh.rect, positions: Array.from(layer.mesh.pos), uvs: Array.from(layer.mesh.uv), indices: Array.from(layer.mesh.tris),
        alpha: layer.alpha ?? 1, face: !!layer.face, eye_ball: layer.eyeBall ?? null,
      })), uniforms: {
        angles: f32([state.angleX, state.angleY, state.angleZ]),
        eye_box: rig.eyes.map(e => f32([e.x0, e.x1, 0, 0])), eye_top: rig.eyes.map(e => f32(e.top)), eye_bot: rig.eyes.map(e => f32(e.bot)),
        eyes: f32(state.eyes), mouth: f32([mouth.cx, mouth.cy, mouth.angle, mouth.halfLen]),
        mouth_state: f32([state.mouthOpen, state.mouthForm, mouth.bow, 0]), cheeks: f32(rig.cheeks.flat()), cheek: Math.fround(state.cheek),
      } };
    }
  }
  return { Renderer, buildGrid };
}
