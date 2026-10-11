import type { Point } from 'mesh-avatar';
import type { Viewport, Shape, Handle } from './model';

export const MIN_SCALE = 0.1, MAX_SCALE = 16;
export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
export function zoomAt(view: Viewport, scale: number, point: Point): Viewport {
  const next = clampScale(scale), ratio = next / view.scale;
  return { scale: next, x: point[0] - (point[0] - view.x) * ratio, y: point[1] - (point[1] - view.y) * ratio };
}
export function fitBounds(bounds: { x: number; y: number; width: number; height: number }, size: { width: number; height: number }, padding = 16): Viewport {
  const scale = clampScale(Math.min(Math.max(1, size.width - padding * 2) / Math.max(1, bounds.width), Math.max(1, size.height - padding * 2) / Math.max(1, bounds.height)));
  return { scale, x: size.width / 2 - (bounds.x + bounds.width / 2) * scale, y: size.height / 2 - (bounds.y + bounds.height / 2) * scale };
}
export function partBounds(group: string, shapes: Shape[], handles: Handle[]) {
  const bands = new Set(shapes.filter(shape => shape.band).map(shape => shape.item));
  const points: Point[] = handles.filter(handle => handle.group === group && !bands.has(handle.item)).map(handle => handle.point);
  for (const shape of shapes.filter(shape => shape.group === group && !shape.band)) {
    if (shape.kind === 'ellipse') {
      const [rx, ry] = shape.radius!, angle = shape.angle ?? 0, [cx, cy] = shape.points[0];
      const dx = Math.hypot(rx * Math.cos(angle), ry * Math.sin(angle)), dy = Math.hypot(rx * Math.sin(angle), ry * Math.cos(angle));
      points.push([cx - dx, cy - dy], [cx + dx, cy + dy]);
    } else points.push(...shape.points);
  }
  if (!points.length) return null;
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
export function coarseWheel(event: Pick<WheelEvent, 'deltaMode' | 'deltaX' | 'deltaY'>) {
  return event.deltaMode !== 0 || (event.deltaX === 0 && Number.isInteger(event.deltaY) && Math.abs(event.deltaY) >= 80);
}
export function inputFocused(target: EventTarget | null) {
  return target instanceof HTMLElement && (!!target.closest('input, textarea, select') || target.isContentEditable);
}
