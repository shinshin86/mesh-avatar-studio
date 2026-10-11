import { layerNormals } from '../lighting/normals';
import { DEFAULT_LIGHTING, parseLighting } from '../lighting/settings';
import { TERMINATOR, DETAIL_SCALE, SHADOW_SATURATION, MAX_IRRADIANCE, headRotation } from '../lighting/shading';
import { DropShadow } from '../lighting/shadow';

/** @param {ReturnType<import('./rig.js').createRig>} engine
 * @param {import('../rig/types').Rig} rig */
export function createRenderer(engine, rig) {
  const { IMG, EYES, MOUTH, CHEEKS } = engine;
  // WebGL2 renderer: textured grid meshes whose vertices are deformed on the CPU,
  // plus a fragment-shader pass for eyelids, eye balls, mouth and blush on the base layer.


  const VS = `#version 300 es
  in vec2 aPos; in vec2 aUv;
  uniform vec2 uScale; uniform vec2 uOffset;
  out vec2 vUv;
  void main() { vUv = aUv; gl_Position = vec4(aPos * uScale + uOffset, 0.0, 1.0); }`;

  const FS = `#version 300 es
  precision highp float;
  in vec2 vUv; out vec4 outColor;
  uniform sampler2D uTex;
  uniform vec4 uRect;        // layer rect in source px
  uniform int uFace;
  uniform float uAlpha;
  uniform vec4 uEyeBox[2];   // x0, x1, -, -
  uniform float uEyeTop[48]; // 2 eyes x EYE_N samples
  uniform float uEyeBot[48];
  uniform vec4 uEyeState[2]; // open, smile, ballX(px), ballY(px)
  uniform vec4 uMouth;       // cx, cy, angle, halfLen
  uniform vec4 uMouthState;  // open, form, bow, -
  uniform vec4 uCheeks;      // x0, y0, x1, y1
  uniform float uCheek;

  const int EYE_N = 24;
  float crv(int e, bool top, float u) {
    float f = clamp(u, 0.0, 1.0) * float(EYE_N - 1);
    int i = min(int(floor(f)), EYE_N - 2);
    float t = f - float(i);
    int k = e * EYE_N + i;
    return top ? mix(uEyeTop[k], uEyeTop[k + 1], t) : mix(uEyeBot[k], uEyeBot[k + 1], t);
  }

  // Upper lid line and lower lid line of eye e at column u, for the current open/smile state.
  // Must match eyeLids() in rig.js, which moves the lash meshes to the same lines.
  // Must match eyeLidsRaw() / eyeLids() in rig.js.
  vec2 eyeLidsRaw(int e, float u) {
    u = clamp(u, 0.0, 1.0);
    vec4 st = uEyeState[e];
    float top = crv(e, true, u), bot = crv(e, false, u);
    float b = 1.0 - st.x, smile = st.y, hump = 4.0 * u * (1.0 - u);
    float H = crv(e, false, 0.5) - crv(e, true, 0.5);
    float arc = mix(uEyeTop[e * EYE_N], uEyeTop[e * EYE_N + EYE_N - 1], u) - 0.3 * H * hump;
    float closed = max(top, bot + 1.0 + (arc - bot - 1.0) * smile);
    return vec2((closed - top) * max(b, -0.07), b > 0.0 ? (closed - bot) * b * smile : 0.0);
  }

  vec2 eyeLids(int e, float u, float top, float bot) {
    vec4 box = uEyeBox[e];
    float du = 5.0 / (box.y - box.x);
    vec2 raw = eyeLidsRaw(e, u);
    vec2 d = (eyeLidsRaw(e, u - 2.0 * du) + 2.0 * eyeLidsRaw(e, u - du) + 3.0 * raw
            + 2.0 * eyeLidsRaw(e, u + du) + eyeLidsRaw(e, u + 2.0 * du)) / 9.0;
    // for hiding the ball take whichever closes more: the smoothed lash can sit a little
    // above the raw lid near the corners, and the gap must show lid skin, not eye white
    return vec2(top + max(d.x, raw.x), bot + min(d.y, raw.y));
  }

  vec4 texAt(vec2 p) { return texture(uTex, (p - uRect.xy) / uRect.zw); }

  // Eye white + iris layer: shown only between the lids (the lids cover it, it never squashes);
  // the iris slides inside the opening for the gaze.
  vec4 eyeBall(int e, vec2 p) {
    vec4 box = uEyeBox[e]; vec4 st = uEyeState[e];
    float u = clamp((p.x - box.x) / (box.y - box.x), 0.0, 1.0);
    float top = crv(e, true, u), bot = crv(e, false, u);
    vec2 lids = eyeLids(e, u, top, bot);
    float v = clamp((p.y - top) / max(bot - top, 1.0), 0.0, 1.0);
    float w = sqrt(4.0 * u * (1.0 - u)) * sqrt(4.0 * v * (1.0 - v));
    vec4 c = texAt(p - vec2(st.z, st.w) * w);
      // the lash covers ~2px of the ball's upper edge, so the cut can sit under it (no seam)
    return c * smoothstep(lids.x - 1.0, lids.x + 0.5, p.y) * (1.0 - smoothstep(lids.y - 0.9, lids.y + 0.6, p.y));
  }

  vec4 mouth(vec2 p, vec4 base) {
    float open = uMouthState.x;
    if (open < 0.01) return base;
    vec2 d = vec2(cos(uMouth.z), sin(uMouth.z)), n = vec2(-d.y, d.x);
    vec2 r = p - uMouth.xy;
    float s = dot(r, d) / uMouth.w, t = dot(r, n);
    float form = uMouthState.y;                       // -1 wide "i" .. +1 round "o"
    float wf = mix(0.78, 0.46, clamp(form * 0.5 + 0.5, 0.0, 1.0));
    float k = 1.0 - (s / wf) * (s / wf);
    if (k <= 0.0) return base;
    float line = uMouthState.z * (1.0 - s * s);
    float hk = pow(k, mix(0.55, 0.85, clamp(form, 0.0, 1.0)));
    float H = mix(20.0, 26.0, clamp(form, 0.0, 1.0));
    float up = line - 0.6 - open * 2.5 * hk;
    float lo = line + open * H * hk;
    float cov = smoothstep(-0.7, 0.7, t - up) * smoothstep(-0.7, 0.7, lo - t);
    if (cov <= 0.0) return base;
    float tv = clamp((t - up) / max(lo - up, 1.0), 0.0, 1.0);
    vec3 col = mix(vec3(0.24, 0.05, 0.08), vec3(0.48, 0.15, 0.19), tv);
    float tongue = smoothstep(0.5, 0.78, tv) * (1.0 - smoothstep(0.45, 0.8, abs(s) / wf));
    col = mix(col, vec3(0.86, 0.44, 0.47), tongue * 0.9);
    float teeth = (1.0 - smoothstep(0.12, 0.22, tv)) * smoothstep(0.25, 0.45, open) * (1.0 - smoothstep(0.55, 0.85, abs(s) / wf));
    col = mix(col, vec3(0.99, 0.96, 0.94), teeth);
    float rim = 1.0 - smoothstep(0.6, 1.8, lo - t);
    col = mix(col, vec3(0.36, 0.09, 0.11), rim * 0.85);
    return vec4(mix(base.rgb, col, cov), 1.0);
  }

  void main() {
    vec2 p = uRect.xy + vUv * uRect.zw;
    vec4 c;
    if (uFace == 1) {
      c = mouth(p, texAt(p));
      float blush = exp(-dot((p - uCheeks.xy) / vec2(48.0, 22.0), (p - uCheeks.xy) / vec2(48.0, 22.0)))
                  + exp(-dot((p - uCheeks.zw) / vec2(40.0, 20.0), (p - uCheeks.zw) / vec2(40.0, 20.0)));
      c.rgb = mix(c.rgb, c.rgb * vec3(1.0, 0.62, 0.64) , clamp(blush * uCheek * 0.55, 0.0, 1.0) * c.a);
    } else if (uFace >= 2) {
      c = eyeBall(uFace - 2, p);
    } else {
      c = texAt(p);
    }
    outColor = c * uAlpha;
  }`;

  // Compile only when lighting is first enabled. The original off program is untouched.
  const LIGHT_VS = VS.replace('out vec2 vUv;', 'in float aHeadWeight; out float vHeadWeight; out vec2 vScreen; out vec2 vUv;')
    .replace('vUv = aUv;', 'vHeadWeight = aHeadWeight; vScreen = vec2((aPos.x * uScale.x + uOffset.x + 1.0) * 0.5, (1.0 - aPos.y * uScale.y - uOffset.y) * 0.5); vUv = aUv;');
  const LIGHT_FS = FS.replace('uniform sampler2D uTex;', `uniform sampler2D uTex;
    uniform sampler2D uNormal; in float vHeadWeight; in vec2 vScreen;
    uniform mat3 uHeadRotation; uniform vec3 uLight; uniform vec3 uLightColor; uniform vec3 uAmbientColor;
    uniform vec4 uLighting; uniform vec4 uSurface; uniform float uAspect; uniform int uCel;`)
    .replace('outColor = c * uAlpha;', `
      // RG hold the smooth surface normal, BA the painting's relief (see lighting/normals.ts).
      vec4 encoded = texture(uNormal, vUv);
      vec2 base = encoded.rg * 2.0 - 1.0;
      vec3 n = vec3(base, sqrt(max(0.0, 1.0 - dot(base, base))));
      n = normalize(n + vec3((encoded.ba * 2.0 - 1.0) * uSurface.w * ${DETAIL_SCALE.toFixed(3)}, 0.0));
      n = normalize(mix(n, uHeadRotation * n, vHeadWeight));
      vec2 toLight = (uLight.xy - vScreen) * vec2(uAspect, 1.0);
      vec3 light = normalize(vec3(toLight, uLight.z));
      float ndl = dot(n, light);
      float diffuse;
      if (uCel == 1) {
        float w = 0.01 + uSurface.x * 0.08;
        diffuse = 0.2 + 0.45 * smoothstep(${TERMINATOR.toFixed(3)} - w, ${TERMINATOR.toFixed(3)} + w, ndl) + 0.35 * smoothstep(0.55 - w, 0.55 + w, ndl);
      } else {
        float s = 0.05 + uSurface.x * 0.5;
        diffuse = smoothstep(${TERMINATOR.toFixed(3)} - s, ${TERMINATOR.toFixed(3)} + s, ndl) * (0.35 + 0.65 * max(0.0, ndl));
      }
      float reach = dot(toLight, toLight) / (uLighting.w * uLighting.w);
      float attenuation = 1.0 / (1.0 + reach);
      vec3 radiance = uLightColor * uLighting.y * attenuation;
      // A light close to the surface may brighten a little, but must not bleach painted colours.
      vec3 irradiance = min(uAmbientColor * uLighting.z + radiance * diffuse, vec3(${MAX_IRRADIANCE.toFixed(3)}));
      // Painted shadows are deeper versions of the base colour, not grey: multiply by the colour
      // itself as the surface turns away from the light.
      vec3 albedo = c.rgb / max(c.a, 1e-4);
      float dark = 1.0 - clamp(dot(irradiance, vec3(0.3333)), 0.0, 1.0);
      vec3 shaded = c.rgb * mix(vec3(1.0), albedo, dark * ${SHADOW_SATURATION.toFixed(3)}) * irradiance;
      float specular = pow(max(dot(n, normalize(light + vec3(0.0, 0.0, 1.0))), 0.0), 60.0) * uSurface.y;
      if (uCel == 1) specular = smoothstep(0.3, 0.35, specular) * uSurface.y;
      vec2 side = length(n.xy) > 0.001 ? normalize(n.xy) : vec2(0.0);
      float rim = pow(1.0 - max(n.z, 0.0), 4.0) * smoothstep(-0.2, 0.7, dot(side, normalize(toLight + vec2(1e-4)))) * uSurface.z;
      shaded += radiance * (specular * max(0.0, ndl) + rim) * c.a;
      // Strength blends between the original painting and the relit result; alpha is unchanged.
      c.rgb = clamp(mix(c.rgb, shaded, uLighting.x), vec3(0.0), vec3(c.a));
      outColor = c * uAlpha;`);

  const LINE_VS = `#version 300 es
  in vec2 aPos; uniform vec2 uScale; uniform vec2 uOffset;
  void main() { gl_Position = vec4(aPos * uScale + uOffset, 0.0, 1.0); gl_PointSize = 7.0; }`;
  const LINE_FS = `#version 300 es
  precision mediump float; uniform vec4 uColor; out vec4 o; void main() { o = uColor; }`;

  function compile(gl, vs, fs) {
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
      gl.deleteShader(sh);
    }
    gl.bindAttribLocation(prog, 0, 'aPos'); gl.bindAttribLocation(prog, 1, 'aUv'); gl.bindAttribLocation(prog, 2, 'aHeadWeight');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const u = {};
    const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(prog, i).name.replace('[0]', '');
      u[name] = gl.getUniformLocation(prog, name);
    }
    return { prog, u };
  }

  // Grid lines along one axis: `cell` spacing, `fine.cell` inside [fine.from, fine.to).
  function axis(start, len, cell, fine) {
    const out = [start];
    let v = start;
    while (v < start + len - 0.5) {
      const c = fine && v >= fine.from && v < fine.to ? fine.cell : cell;
      v = Math.min(start + len, v + c);
      out.push(v);
    }
    return out;
  }

  // Grid mesh over a layer rect (optionally denser inside `fine`); cells that are fully
  // transparent are dropped.
  function buildGrid(rect, cell, alpha, alphaW, fine = null) {
    const [rx, ry, rw, rh] = rect;
    const xs = axis(rx, rw, cell, fine && { from: fine.x0, to: fine.x1, cell: fine.cell });
    const ys = axis(ry, rh, cell, fine && { from: fine.y0, to: fine.y1, cell: fine.cell });
    const cols = xs.length - 1, rows = ys.length - 1;
    const nv = (cols + 1) * (rows + 1);
    const rest = new Float32Array(nv * 2), uv = new Float32Array(nv * 2);
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const k = j * (cols + 1) + i;
      rest[k * 2] = xs[i]; rest[k * 2 + 1] = ys[j];
      uv[k * 2] = (xs[i] - rx) / rw; uv[k * 2 + 1] = (ys[j] - ry) / rh;
    }
    const tris = [], lines = [];
    const alphaH = alpha.length / alphaW;
    // alpha may be a 1x1 stand-in (fully opaque quad)
    const ax = alphaW === 1 ? 0 : 1;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x0 = Math.floor(xs[i] - rx) * ax - 2, x1 = Math.ceil(xs[i + 1] - rx) * ax + 2;
      const y0 = Math.floor(ys[j] - ry) * ax - 2, y1 = Math.ceil(ys[j + 1] - ry) * ax + 2;
      let any = false;
      for (let y = Math.max(0, y0); y < Math.min(alphaH, y1) && !any; y += 1)
        for (let x = Math.max(0, x0); x < Math.min(alphaW, x1); x += 1)
          if (alpha[y * alphaW + x] > 3) { any = true; break; }
      if (!any) continue;
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      tris.push(a, b, c, b, d, c);
      lines.push(a, b, a, c, b, c);
      if (i === cols - 1) lines.push(b, d);
      if (j === rows - 1) lines.push(c, d);
    }
    return { rect, cols, rows, rest, uv, pos: new Float32Array(rest), tris: new Uint32Array(tris), lines: new Uint32Array(lines) };
  }

  class Renderer {
    // padTop / padSide: margin around the image, as a share of its height / width. A negative
    // padTop pushes the top of the image above the canvas (hides a cut-off top edge).
    constructor(canvas, { padTop = 0, padSide = 0, fit = 'contain' } = {}) {
      this.pad = { top: padTop, side: padSide };
      this.fit = fit;
      const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: true, alpha: true, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL2 is not available');
      this.gl = gl; this.canvas = canvas;
      this.main = compile(gl, VS, FS);
      this.line = compile(gl, LINE_VS, LINE_FS);
      this.layers = [];
      this.lighting = DEFAULT_LIGHTING;
      this.lightingStats = { normalMs: 0, computedLayers: 0, cachedLayers: 0 };
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    texture(img) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }

    addLayer(name, img, mesh, opts = {}) {
      const gl = this.gl;
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const posBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.DYNAMIC_DRAW);
      for (const prog of [this.main, this.line]) {
        const loc = gl.getAttribLocation(prog.prog, 'aPos');
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
      const uvBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW);
      const uvLoc = gl.getAttribLocation(this.main.prog, 'aUv');
      gl.enableVertexAttribArray(uvLoc); gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);
      const triBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, triBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.tris, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      const lineBuf = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lineBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.lines, gl.STATIC_DRAW);
      const layer = { name, image: img, mesh, tex: this.texture(img), vao, posBuf, uvBuf, triBuf, lineBuf, visible: true, face: !!opts.face, eyeBall: opts.eyeBall, color: opts.color || [1, 1, 1, 1] };
      this.layers.push(layer);
      return layer;
    }

    destroy() {
      const gl = this.gl;
      for (const layer of this.layers) {
        gl.deleteTexture(layer.tex);
        if (layer.normal) gl.deleteTexture(layer.normal);
        if (layer.headBuf) gl.deleteBuffer(layer.headBuf);
        gl.deleteVertexArray(layer.vao);
        for (const buffer of [layer.posBuf, layer.uvBuf, layer.triBuf, layer.lineBuf]) gl.deleteBuffer(buffer);
      }
      gl.deleteProgram(this.main.prog);
      gl.deleteProgram(this.line.prog);
      if (this.lit) gl.deleteProgram(this.lit.prog);
      this.shadow?.destroy();
      this.layers.length = 0;
    }

    setLighting(value) {
      this.lighting = parseLighting({ ...DEFAULT_LIGHTING, ...value }) ?? DEFAULT_LIGHTING;
      if (!this.lighting.enabled) return;
      const gl = this.gl;
      if (!this.lit) this.lit = compile(gl, LIGHT_VS, LIGHT_FS);
      for (const layer of this.layers) {
        if (layer.normal || layer.overlay) continue;
        const data = layerNormals(layer.image, layer.mesh.rect, rig, !/^(eye|mouth)/.test(layer.name));
        this.lightingStats.normalMs += data.ms;
        this.lightingStats[data.computed ? 'computedLayers' : 'cachedLayers']++;
        layer.normal = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, layer.normal);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, data.width, data.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.data);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const weights = new Float32Array(layer.mesh.rest.length / 2);
        for (let i = 0; i < weights.length; i++) weights[i] = engine.headWeight(layer.mesh.rest[i * 2], layer.mesh.rest[i * 2 + 1]);
        layer.headBuf = gl.createBuffer(); gl.bindVertexArray(layer.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, layer.headBuf); gl.bufferData(gl.ARRAY_BUFFER, weights, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
      }
      gl.bindVertexArray(null);
      if (this.lighting.shadow && !this.shadow) this.shadow = new DropShadow(gl, compile);
    }

    resize() {
      const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      // Contain anchors the cut-off body to the bottom; cover crops around the image center.
      const s = (this.fit === 'cover' ? Math.max : Math.min)(w / (IMG.w * (1 + 2 * this.pad.side)), h / (IMG.h * (1 + this.pad.top)));
      const ox = (w - IMG.w * s) / 2, oy = (h - IMG.h * s) / (this.fit === 'cover' ? 2 : 1);
      this.scale = [2 * s / w, -2 * s / h];
      this.offset = [-1 + 2 * ox / w, 1 - 2 * oy / h];
      this.pxScale = s; this.pxOff = [ox, oy];
    }

    draw(state) {
      const gl = this.gl;
      this.resize();
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const lit = this.lighting.enabled, shadow = lit && this.lighting.shadow;
      if (shadow) this.shadow.begin(this.canvas.width, this.canvas.height);
      const m = lit ? this.lit : this.main;
      this.current = m;
      gl.useProgram(m.prog);
      if (lit) {
        const light = this.lighting;
        gl.uniform1i(m.u.uNormal, 1);
        gl.uniform3f(m.u.uLight, light.x, light.y, light.z);
        gl.uniform3f(m.u.uLightColor, ((light.color >> 16) & 255) / 255, ((light.color >> 8) & 255) / 255, (light.color & 255) / 255);
        gl.uniform3f(m.u.uAmbientColor, ((light.ambientColor >> 16) & 255) / 255, ((light.ambientColor >> 8) & 255) / 255, (light.ambientColor & 255) / 255);
        gl.uniform4f(m.u.uLighting, light.strength, light.intensity, light.ambient, light.reach);
        gl.uniform4f(m.u.uSurface, light.softness, light.specular, light.rim, light.detail);
        gl.uniform1f(m.u.uAspect, this.canvas.width / this.canvas.height);
        gl.uniform1i(m.u.uCel, light.mode === 'cel' ? 1 : 0);
        gl.uniformMatrix3fv(m.u.uHeadRotation, false, headRotation(state.angleX ?? 0, state.angleY ?? 0, state.angleZ ?? 0, rig.head.maxRoll));
      }
      gl.uniform2fv(m.u.uScale, this.scale); gl.uniform2fv(m.u.uOffset, this.offset);
      gl.uniform1i(m.u.uTex, 0);
      gl.uniform4fv(m.u.uEyeBox, EYES.flatMap(e => [e.x0, e.x1, 0, 0]));
      gl.uniform1fv(m.u.uEyeTop, EYES.flatMap(e => e.top));
      gl.uniform1fv(m.u.uEyeBot, EYES.flatMap(e => e.bot));
      gl.uniform4fv(m.u.uEyeState, state.eyes);
      gl.uniform4f(m.u.uMouth, MOUTH.cx, MOUTH.cy, MOUTH.angle, MOUTH.halfLen);
      gl.uniform4f(m.u.uMouthState, state.mouthOpen, state.mouthForm, MOUTH.bow, 0);
      gl.uniform4f(m.u.uCheeks, CHEEKS[0][0], CHEEKS[0][1], CHEEKS[1][0], CHEEKS[1][1]);
      gl.uniform1f(m.u.uCheek, state.cheek);
      gl.activeTexture(gl.TEXTURE0);

      for (const L of this.layers) {
        if (!L.visible || L.overlay) continue;
        this.drawLayer(L, L.alpha ?? 1);
      }
      if (this.original && state.originalAlpha > 0) this.drawLayer(this.original, state.originalAlpha);

      if (shadow) this.shadow.composite(this.lighting);

      if (state.showMesh) {
        const l = this.line;
        gl.useProgram(l.prog);
        gl.uniform2fv(l.u.uScale, this.scale); gl.uniform2fv(l.u.uOffset, this.offset);
        for (const L of this.layers) {
          if (!L.visible || L.overlay) continue;
          gl.bindVertexArray(L.vao);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.lineBuf);
          gl.uniform4fv(l.u.uColor, L.color);
          gl.drawElements(gl.LINES, L.mesh.lines.length, gl.UNSIGNED_INT, 0);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, L.triBuf);
        }
        if (state.joints?.length) this.drawPoints(state.joints);
        gl.bindVertexArray(null);
      }
    }

    drawLayer(L, alpha) {
      const gl = this.gl, m = this.current;
      gl.useProgram(m.prog);
      gl.bindVertexArray(L.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, L.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, L.mesh.pos);
      if (this.lighting.enabled) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L.normal); gl.activeTexture(gl.TEXTURE0); }
      gl.bindTexture(gl.TEXTURE_2D, L.tex);
      gl.uniform4fv(m.u.uRect, L.mesh.rect);
      gl.uniform1i(m.u.uFace, L.eyeBall !== undefined ? 2 + L.eyeBall : L.face ? 1 : 0);
      gl.uniform1f(m.u.uAlpha, alpha);
      gl.drawElements(gl.TRIANGLES, L.mesh.tris.length, gl.UNSIGNED_INT, 0);
    }

    drawPoints(pts) {
      const gl = this.gl, l = this.line;
      if (!this.pointBuf) {
        this.pointBuf = gl.createBuffer();
        this.pointVao = gl.createVertexArray();
        gl.bindVertexArray(this.pointVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
        const loc = gl.getAttribLocation(l.prog, 'aPos');
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      }
      gl.bindVertexArray(this.pointVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts.flat()), gl.DYNAMIC_DRAW);
      gl.uniform4f(l.u.uColor, 1, 0.85, 0.2, 1);
      gl.drawArrays(gl.POINTS, 0, pts.length);
    }

    // canvas CSS px -> source image px
    toImage(cx, cy) {
      if (!this.pxOff) return null;   // pointer moved before the first frame was drawn
      const dpr = this.canvas.width / this.canvas.clientWidth;
      return [(cx * dpr - this.pxOff[0]) / this.pxScale, (cy * dpr - this.pxOff[1]) / this.pxScale];
    }
  }
  return { Renderer, buildGrid };
}
