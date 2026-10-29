// Optional overlay layers (built/overlays/overlays.json): full-size drawings such as glasses
// that the app switches on and off by name. They sit above the eye / mouth sprites and follow
// the face like the base illustration does.

/** [x, y, w, h] around the opaque pixels (alpha > 3) plus `pad`, or null when fully transparent. */
export function opaqueRect(alpha, width, height, pad = 6) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] > 3) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const left = Math.max(0, x0 - pad), top = Math.max(0, y0 - pad);
  return [left, top, Math.min(width, x1 + 1 + pad) - left, Math.min(height, y1 + 1 + pad) - top];
}

/**
 * Builds one layer per overlay. Like the sprites, only the opaque part of each drawing gets a
 * grid: a grid over the whole image would move every transparent vertex each frame (about
 * 100k vertices for a 1254 x 1254 image at 4 px, ~12 ms per frame on a mid-range phone).
 * `crop(img, rect)` returns that part of the image (a canvas, for example) for the texture.
 * Brows and jaw do not move an accessory, so their weights are zeroed; hair weight is 0 as for
 * the sprites.
 */
export function createOverlayLayers(renderer, sheet, images, buildGrid, alphaOf, baseWeights, cell = 16, width, height, crop) {
  const items = new Map();
  for (const item of sheet.overlays) {
    const img = images[item.name];
    if ((width !== undefined && img.width !== width) || (height !== undefined && img.height !== height)) {
      throw new Error(`overlay ${item.name}: image size does not match base.png`);
    }
    const alpha = alphaOf(img);
    const rect = opaqueRect(alpha, img.width, img.height);
    if (!rect) continue;
    const [rx, ry, rw, rh] = rect;
    const cropped = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) cropped.set(alpha.subarray((ry + y) * img.width + rx, (ry + y) * img.width + rx + rw), y * rw);
    const mesh = buildGrid(rect, cell, cropped, rw);
    const weights = [];
    for (let i = 0; i < mesh.rest.length; i += 2) {
      const w = baseWeights(mesh.rest[i], mesh.rest[i + 1], 0);
      weights.push({ ...w, brow: 0, jaw: 0 });
    }
    const layer = renderer.addLayer(`overlay_${item.name}`, crop(img, rect), mesh);
    layer.visible = false;
    items.set(item.name, { mesh, weights, layer });
  }
  return {
    /** Shows the named overlays and hides the rest. Unknown names are ignored. */
    set(names) {
      const selected = new Set(names);
      for (const [name, item] of items) item.layer.visible = selected.has(name);
    },
    update(P, phys, deformBase, out) {
      for (const { mesh, weights, layer } of items.values()) {
        if (!layer.visible) continue; // hidden overlays cost nothing per frame
        for (let i = 0; i < weights.length; i++) {
          deformBase(mesh.rest[i * 2], mesh.rest[i * 2 + 1], weights[i], P, phys, out);
          mesh.pos[i * 2] = out[0]; mesh.pos[i * 2 + 1] = out[1];
        }
      }
    },
  };
}
