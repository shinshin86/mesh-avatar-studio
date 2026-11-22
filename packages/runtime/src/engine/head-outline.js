const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const DEFAULT_FEATHER = 16;

/**
 * Optional head.weightOutline (polygon, px) around the head, hair and neck: outside it the head
 * influence fades to zero over head.weightFeather px (default 16), so a hand raised beside the
 * head stays with the body instead of rolling and turning with the head.
 * Returns null without a usable outline, so callers keep the full-width bands exactly as before.
 * A missing or non-positive feather falls back to the default instead of dividing by zero.
 * @param {{weightOutline?: number[][], weightFeather?: number}|null|undefined} head
 * @returns {((x: number, y: number) => number) | null}
 */
export function createHeadSideFade(head) {
  const outline = head?.weightOutline;
  if (!Array.isArray(outline) || outline.length < 3) return null;
  const feather = Number.isFinite(head.weightFeather) && head.weightFeather > 0 ? head.weightFeather : DEFAULT_FEATHER;
  function outsideBy(x, y) {
    let inside = false, best = Infinity;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [ax, ay] = outline[j], [bx, by] = outline[i];
      if ((ay > y) !== (by > y) && x < ax + ((y - ay) * (bx - ax)) / (by - ay)) inside = !inside;
      const vx = bx - ax, vy = by - ay;
      const u = Math.min(1, Math.max(0, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
      best = Math.min(best, Math.hypot(x - ax - vx * u, y - ay - vy * u));
    }
    return inside ? 0 : best;
  }
  return (x, y) => 1 - sstep(0, feather, outsideBy(x, y));
}
