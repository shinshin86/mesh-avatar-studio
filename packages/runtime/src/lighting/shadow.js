import { shadowOffset } from './shading';

// Render the avatar once into a transparent target. Two separable blur passes operate
// only on its alpha; the original premultiplied color is then composited over the shadow.
export class DropShadow {
  constructor(gl, compile) {
    this.gl = gl;
    this.program = compile(gl, `#version 300 es
      out vec2 vUv;
      void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0, 1); }`, `#version 300 es
      precision highp float; in vec2 vUv; out vec4 o;
      uniform sampler2D uTex; uniform vec2 uStep; uniform vec2 uShift; uniform int uPass;
      float alphaAt(vec2 p) { if (any(lessThan(p, vec2(0))) || any(greaterThan(p, vec2(1)))) return 0.0; return texture(uTex, p).a; }
      void main() {
        if (uPass == 2) { o = texture(uTex, vUv); return; }
        vec2 p = vUv - uShift;
        float a = alphaAt(p) * 0.227027;
        a += (alphaAt(p + uStep * 1.384615) + alphaAt(p - uStep * 1.384615)) * 0.316216;
        a += (alphaAt(p + uStep * 3.230769) + alphaAt(p - uStep * 3.230769)) * 0.070270;
        o = uPass == 0 ? vec4(0, 0, 0, a) : vec4(vec3(0.035, 0.045, 0.065) * a * 0.28, a * 0.28);
      }`);
    this.vao = gl.createVertexArray(); this.targets = [];
  }
  target(w, h) {
    const gl = this.gl, texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Shadow framebuffer unavailable');
    return { texture, framebuffer };
  }
  begin(w, h) {
    const gl = this.gl;
    if (this.width !== w || this.height !== h) {
      this.clearTargets(); this.width = w; this.height = h;
      this.targets = [this.target(w, h), this.target(Math.ceil(w / 2), Math.ceil(h / 2))];
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0].framebuffer);
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  composite(light) {
    const gl = this.gl, { prog, u } = this.program, w = this.width, h = this.height;
    gl.useProgram(prog); gl.bindVertexArray(this.vao); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.uTex, 0);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[1].framebuffer); gl.viewport(0, 0, Math.ceil(w / 2), Math.ceil(h / 2));
    gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
    gl.uniform1i(u.uPass, 0); gl.uniform2f(u.uShift, 0, 0); gl.uniform2f(u.uStep, 3 / w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[1].texture);
    const offset = shadowOffset(light.x, light.y);
    gl.uniform1i(u.uPass, 1); gl.uniform2f(u.uShift, offset[0], -offset[1]); gl.uniform2f(u.uStep, 0, 3 / h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[0].texture);
    gl.uniform1i(u.uPass, 2); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
  clearTargets() { for (const t of this.targets) { this.gl.deleteTexture(t.texture); this.gl.deleteFramebuffer(t.framebuffer); } this.targets = []; }
  destroy() { this.clearTargets(); this.gl.deleteProgram(this.program.prog); this.gl.deleteVertexArray(this.vao); }
}
