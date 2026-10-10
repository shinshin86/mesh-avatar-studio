import type { Ellipse, Rig } from '../rig/types';

// Two-pass chamfer distance. Full-image borders may cut through the artwork;
// do not curl those crop edges as if they were part of the visible silhouette.
export function silhouetteDistance(alpha: Uint8Array, width: number, height: number, cropped = false) {
  const boundary = cropped ? Math.max(width, height) * 2 : 1;
  const d = new Float32Array(alpha.length), diagonal = Math.SQRT2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (alpha[i] <= 3) continue;
    d[i] = Math.min(x ? d[i - 1] + 1 : boundary, y ? d[i - width] + 1 : boundary,
      x && y ? d[i - width - 1] + diagonal : boundary, y && x + 1 < width ? d[i - width + 1] + diagonal : boundary);
    // The upper-right pixel is already on the previous row; all distances there are final for this pass.
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (!alpha[i] || alpha[i] <= 3) continue;
    d[i] = Math.min(d[i], x + 1 < width ? d[i + 1] + 1 : boundary, y + 1 < height ? d[i + width] + 1 : boundary,
      x && y + 1 < height ? d[i + width - 1] + diagonal : boundary,
      x + 1 < width && y + 1 < height ? d[i + width + 1] + diagonal : boundary);
  }
  return d;
}
function gaussian(x: number, y: number, e: Ellipse) { return Math.exp(-(((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2)); }
export function rigHeight(x: number, y: number, rig: Rig) {
  // Facial overlays share this field.
  // The head is an ellipsoid so its sides turn away from a frontal light; the field is smoothed later.
  const r2 = ((x - rig.head.cx) / rig.head.rx) ** 2 + ((y - rig.head.cy) / rig.head.ry) ** 2;
  let h = rig.head.rx * 0.8 * Math.sqrt(Math.max(0, 1 - r2)) + rig.body.chest.rx * 0.23 * gaussian(x, y, rig.body.chest);
  h += rig.face.nose.rx * 0.2 * gaussian(x, y, rig.face.nose);
  for (const [cx, cy] of rig.cheeks) h += rig.head.rx * 0.012 * gaussian(x, y, { cx, cy, rx: rig.head.rx * 0.3, ry: rig.head.ry * 0.16 });
  return h;
}
// Separable box blur with running sums; edges average only the pixels inside the image.
function boxBlur(src: Float32Array, width: number, height: number, radius: number) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const pass = (input: Float32Array, output: Float32Array, length: number, lines: number, step: number, stride: number) => {
    for (let line = 0; line < lines; line++) {
      const start = line * stride;
      let sum = 0, count = 0;
      for (let k = 0; k < Math.min(radius, length - 1) + 1; k++) { sum += input[start + k * step]; count++; }
      for (let i = 0; i < length; i++) {
        output[start + i * step] = sum / count;
        const add = i + radius + 1, remove = i - radius;
        if (add < length) { sum += input[start + add * step]; count++; }
        if (remove >= 0) { sum -= input[start + remove * step]; count--; }
      }
    }
  };
  pass(src, tmp, width, height, 1, width);
  pass(tmp, out, height, width, width, 1);
  return out;
}
// Fine relief from the painting itself: dark strokes become shallow grooves, so hair strands and
// folds catch the light. Only local contrast is kept; large painted shadows are not reinterpreted.
export function detailGradient(luminance: Float32Array, alpha: Uint8Array, width: number, height: number) {
  const fine = boxBlur(luminance, width, height, 1), coarse = boxBlur(luminance, width, height, 6);
  const relief = new Float32Array(luminance.length);
  for (let i = 0; i < relief.length; i++) relief[i] = alpha[i] > 128 ? fine[i] - coarse[i] : 0;
  const gradient = new Float32Array(luminance.length * 2);
  const at = (x: number, y: number) => relief[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (alpha[i] <= 128) continue;
    gradient[2 * i] = Math.max(-1, Math.min(1, -(at(x + 1, y) - at(x - 1, y)) * 4));
    gradient[2 * i + 1] = Math.max(-1, Math.min(1, -(at(x, y + 1) - at(x, y - 1)) * 4));
  }
  return gradient;
}
// RG: the smooth surface normal's x/y (z is rebuilt in the shader). BA: the painting's relief gradient.
export function generateNormals(alpha: Uint8Array, width: number, height: number, rect: readonly number[], rig?: Rig, inflate = true, luminance?: Float32Array) {
  const cropped = !!rig && rect[0] === 0 && rect[1] === 0 && rect[2] === rig.image.width && rect[3] === rig.image.height;
  const distances = silhouetteDistance(alpha, width, height, cropped), heights = new Float32Array(alpha.length);
  const dx = rect[2] / width, dy = rect[3] / height, unit = Math.min(dx, dy);
  const depth = Math.min(rect[2], rect[3]) * 0.08;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    heights[i] = (inflate ? Math.sqrt(distances[i] * unit * depth) * 0.55 : 0)
      + (rig ? rigHeight(rect[0] + (x + 0.5) * dx, rect[1] + (y + 0.5) * dy, rig) : 0);
  }
  // The distance field has creases along the silhouette's medial axis; smoothing removes the
  // visible seams they would draw across large areas such as the face.
  const radius = Math.max(1, Math.round(Math.min(width, height) * 0.02));
  heights.set(boxBlur(boxBlur(heights, width, height, radius), width, height, radius));
  const detail = luminance ? detailGradient(luminance, alpha, width, height) : null;
  const normals = new Uint8Array(width * height * 4);
  const sample = (x: number, y: number) => heights[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    // A small derivative footprint suppresses staircase artifacts in the distance field.
    const nx = -(sample(x + 2, y) - sample(x - 2, y)) / (4 * dx), ny = -(sample(x, y + 2) - sample(x, y - 2)) / (4 * dy);
    const len = Math.hypot(nx, ny, 1), i = (y * width + x) * 4, j = y * width + x;
    normals[i] = Math.round((nx / len * 0.5 + 0.5) * 255);
    normals[i + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
    normals[i + 2] = Math.round(((detail?.[2 * j] ?? 0) * 0.5 + 0.5) * 255);
    normals[i + 3] = Math.round(((detail?.[2 * j + 1] ?? 0) * 0.5 + 0.5) * 255);
  }
  return normals;
}
// CPU data survives preview renderer rebuilds; weak image keys release closed projects.
const cache = new WeakMap<HTMLImageElement, { key: string; data: Uint8Array; width: number; height: number }>();
export function layerNormals(image: HTMLImageElement, rect: number[], rig: Rig, inflate: boolean) {
  const key = JSON.stringify([rect, rig.head, rig.body.chest, rig.face.nose, rig.cheeks, inflate]);
  const cached = cache.get(image);
  if (cached?.key === key) return { ...cached, computed: false, ms: 0 };
  const start = performance.now(), scale = Math.min(1, 512 / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data, alpha = new Uint8Array(width * height);
  const luminance = new Float32Array(width * height);
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = pixels[4 * i + 3];
    luminance[i] = (0.2126 * pixels[4 * i] + 0.7152 * pixels[4 * i + 1] + 0.0722 * pixels[4 * i + 2]) / 255;
  }
  // Eye and mouth layers are redrawn by the shader, so painted relief would not line up there.
  const result = { key, data: generateNormals(alpha, width, height, rect, rig, inflate, inflate ? luminance : undefined), width, height };
  cache.set(image, result);
  return { ...result, computed: true, ms: performance.now() - start };
}
