import { editorNumber, isIntegerField } from '../../packages/runtime/src/rig/numeric';
import type { Point, Rig } from 'mesh-avatar';

export interface Viewport { scale: number; x: number; y: number }
export interface Handle {
  id: string;
  item: string;
  group: string;
  point: Point;
  xPath: string;
  yPath?: string;
  radius?: { axis: 'x' | 'y'; center: Point; angle: number };
  vertex?: { path: string; index: number; closed: boolean };
}
export interface Shape {
  item: string;
  group: string;
  kind: 'ellipse' | 'line';
  points: Point[];
  closed?: boolean;
  editable?: boolean;
  band?: boolean;
  radius?: Point;
  angle?: number;
}
export function getAt(root: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((value, key) =>
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, root);
}
export function setAt(rig: Rig, path: string, value: unknown): Rig {
  const next = structuredClone(rig);
  const parts = path.split('.');
  let target = next as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) target = target[part] as Record<string, unknown>;
  target[parts.at(-1)!] = typeof value === 'number' ? editorNumber(path, value) : value;
  return next;
}
export function numericFields(value: unknown, path: string): { path: string; value: number }[] {
  if (typeof value === 'number') return [{ path, value }];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => numericFields(child, path ? `${path}.${key}` : key));
}
export function screen(point: Point, view: Viewport): Point {
  return [point[0] * view.scale + view.x, point[1] * view.scale + view.y];
}
export function imagePoint(point: Point, view: Viewport): Point {
  return [(point[0] - view.x) / view.scale, (point[1] - view.y) / view.scale];
}
export function nearestHandle(handles: Handle[], point: Point, view: Viewport, threshold = 8): Handle | undefined {
  let nearest: Handle | undefined;
  let distance = threshold;
  for (const handle of handles) {
    const p = screen(handle.point, view);
    const d = Math.hypot(p[0] - point[0], p[1] - point[1]);
    if (d <= distance) { distance = d; nearest = handle; }
  }
  return nearest;
}
export function moveHandle(rig: Rig, handle: Handle, point: Point): Rig {
  const rounded = (value: number, path: string) => isIntegerField(path) ? Math.round(value) : Math.round(value * 10) / 10;
  if (handle.radius) {
    const { center, axis, angle } = handle.radius;
    const dx = point[0] - center[0], dy = point[1] - center[1];
    const amount = axis === 'x' ? dx * Math.cos(angle) + dy * Math.sin(angle)
      : -dx * Math.sin(angle) + dy * Math.cos(angle);
    return setAt(rig, handle.xPath, Math.max(1, rounded(Math.abs(amount), handle.xPath)));
  }
  return setAt(setAt(rig, handle.xPath, rounded(point[0], handle.xPath)), handle.yPath!, rounded(point[1], handle.yPath!));
}
export function changeVertex(rig: Rig, path: string, index: number, point: Point | null, closed: boolean): Rig {
  const points = structuredClone(getAt(rig, path)) as Point[];
  if (point) points.splice(index, 0, point);
  else if (points.length > (closed ? 3 : 2)) points.splice(index, 1);
  return setAt(rig, path, points);
}
export function nearestEdge(shapes: Shape[], point: Point, view: Viewport) {
  let best: { shape: Shape; index: number; point: Point } | undefined;
  let distance = 8;
  for (const shape of shapes.filter(s => s.editable)) {
    const count = shape.closed ? shape.points.length : shape.points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = screen(shape.points[i], view), b = screen(shape.points[(i + 1) % shape.points.length], view);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const closest: Point = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(point[0] - closest[0], point[1] - closest[1]);
      if (d < distance) { distance = d; best = { shape, index: i + 1, point: imagePoint(closest, view) }; }
    }
  }
  return best;
}
export function buildOverlay(rig: Rig): { handles: Handle[]; shapes: Shape[] } {
  const handles: Handle[] = [], shapes: Shape[] = [];
  const pointHandle = (item: string, group: string, point: Point, xPath: string, yPath: string, id = item) =>
    handles.push({ id, item, group, point, xPath, yPath });
  function walk(value: unknown, path: string, group: string) {
    if (!value || typeof value !== 'object') return;
    const key = path.split('.').at(-1)!;
    if (Array.isArray(value)) {
      if (value.length >= 2 && value.every(p => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number'))) {
        const points = value as Point[];
        const closed = ['opening', 'roi', 'outline', 'background'].includes(key);
        const editable = closed || ['nodes', 'jaw'].includes(key);
        if (group !== 'cheeks') shapes.push({ item: path, group, kind: 'line', points, closed, editable });
        points.forEach((point, index) => {
          const item = group === 'strands' ? path.split('.').slice(0, 2).join('.') : path;
          const handle: Handle = { id: `${path}.${index}`, item, group, point,
            xPath: `${path}.${index}.0`, yPath: `${path}.${index}.1` };
          if (editable) handle.vertex = { path, index, closed };
          handles.push(handle);
        });
        return;
      }
      if (value.length === 2 && value.every(v => typeof v === 'number')) {
        if (!key.toLowerCase().endsWith('band') && !['band', 'jawRange'].includes(key))
          pointHandle(path, group, value as Point, `${path}.0`, `${path}.1`);
        else if (group !== 'hand' || !key.startsWith('fingerX')) {
          value.forEach((y, i) => {
            const center = group === 'body' ? rig.body.chest.cx : rig.head.cx;
            shapes.push({ item: path, group, kind: 'line', band: true, points: [[0, y], [rig.image.width, y]] });
            handles.push({ id: `${path}.${i}`, item: path, group, point: [center, y],
              xPath: `${path}.${i}`, radius: { axis: 'y', center: [center, 0], angle: 0 } });
          });
        }
        return;
      }
      if (key === 'box' && value.length === 4) {
        const [x0, y0, x1, y1] = value as number[];
        shapes.push({ item: path, group, kind: 'line', points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
        pointHandle(path, group, [x0, y0], `${path}.0`, `${path}.1`, `${path}.start`);
        pointHandle(path, group, [x1, y1], `${path}.2`, `${path}.3`, `${path}.end`);
        return;
      }
      value.forEach((child, index) => walk(child, `${path}.${index}`, group));
      return;
    }
    const object = value as Record<string, unknown>;
    if (typeof object.cx === 'number' && typeof object.cy === 'number') {
      const center: Point = [object.cx, object.cy];
      pointHandle(path, group, center, `${path}.cx`, `${path}.cy`, `${path}.center`);
      if (typeof object.rx === 'number' && typeof object.ry === 'number') {
        const angle = typeof object.angle === 'number' ? object.angle : 0;
        shapes.push({ item: path, group, kind: 'ellipse', points: [center], radius: [object.rx, object.ry], angle });
        for (const axis of ['x', 'y'] as const) {
          const theta = angle + (axis === 'y' ? Math.PI / 2 : 0);
          const radius = axis === 'x' ? object.rx : object.ry;
          handles.push({ id: `${path}.r${axis}`, item: path, group,
            point: [center[0] + Math.cos(theta) * radius, center[1] + Math.sin(theta) * radius],
            xPath: `${path}.r${axis}`, radius: { axis, center, angle } });
        }
      }
      if (typeof object.halfLen === 'number' && typeof object.angle === 'number') {
        shapes.push({ item: path, group, kind: 'line', points: [-1, 1].map(sign =>
          [center[0] + sign * (object.halfLen as number) * Math.cos(object.angle as number),
            center[1] + sign * (object.halfLen as number) * Math.sin(object.angle as number)]) });
      }
    }
    if (typeof object.pivotX === 'number' && typeof object.pivotY === 'number')
      pointHandle(path, group, [object.pivotX, object.pivotY], `${path}.pivotX`, `${path}.pivotY`, `${path}.pivot`);
    if (['x0', 'y0', 'x1', 'y1'].every(key => typeof object[key] === 'number')) {
      const { x0, y0, x1, y1 } = object as Record<string, number>;
      shapes.push({ item: path, group, kind: 'line', points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], closed: true });
      pointHandle(path, group, [x0, y0], `${path}.x0`, `${path}.y0`, `${path}.start`);
      pointHandle(path, group, [x1, y1], `${path}.x1`, `${path}.y1`, `${path}.end`);
    }
    Object.entries(object).forEach(([key, child]) => walk(child, `${path}.${key}`, group));
  }
  Object.entries(rig).forEach(([group, value]) => { if (group !== 'image') walk(value, group, group); });
  return { handles, shapes };
}
