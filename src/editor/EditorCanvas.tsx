import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point, Rig } from 'mesh-avatar';
import { buildOverlay, changeVertex, imagePoint, moveHandle, nearestEdge, nearestHandle, screen, type Handle, type Viewport } from './model';
import { useI18n, type PartGroup } from './i18n';
import { PART_COLORS } from './parts';
import { readPreference, savePreference } from './preferences';
import { coarseWheel, fitBounds, inputFocused, partBounds, zoomAt } from './viewport';

interface Props {
  rig: Rig;
  sourceUrl: string;
  visible: string[];
  selected: string | null;
  onSelect: (path: string) => void;
  onChange: (rig: Rig) => void;
  onBegin?: () => void;
  onEnd?: () => void;
  focusRequest?: { group: string; id: number };
}
export function EditorCanvas({ rig, sourceUrl, visible, selected, onSelect, onChange, onBegin, onEnd, focusRequest }: Props) {
  const { t, title } = useI18n();
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<HTMLImageElement | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport>({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  const setViewport = (value: Viewport | ((current: Viewport) => Viewport)) => {
    viewRef.current = typeof value === 'function' ? value(viewRef.current) : value;
    setView(viewRef.current);
  };
  const [wheelMode, setWheelMode] = useState(() => readPreference('mesh-avatar-wheel-mode') === 'pan' ? 'pan' : 'auto');
  const measured = useRef({ width: 0, height: 0, source: '' });
  const focused = useRef(0);
  const space = useRef(false);
  const [hover, setHover] = useState<{ handle: Handle; point: Point } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ handle?: Handle; rig: Rig; start: Point; view: Viewport; offset: Point } | null>(null);
  const overlay = useMemo(() => buildOverlay(rig), [rig]);
  const handles = overlay.handles.filter(h => visible.includes(h.group));
  const shapes = overlay.shapes.filter(s => visible.includes(s.group));
  const focusGroup = selected?.split('.')[0] ?? '';
  const interactiveHandles = handles.filter(h => !focusGroup || h.group === focusGroup);
  const interactiveShapes = shapes.filter(s => !focusGroup || s.group === focusGroup);
  const hint = !selected ? t.pickHint : interactiveShapes.some(s => s.editable) ? t.lineHint : interactiveHandles.length ? t.dragHint : t.noDots;
  useEffect(() => {
    setImageReady(false); source.current = null;
    const image = new Image();
    image.onload = () => { source.current = image; setImageReady(true); };
    image.src = sourceUrl;
    const observer = new ResizeObserver(entries => {
      const rect = entries[0].contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(canvas.current!);
    return () => { image.onload = null; observer.disconnect(); };
  }, [sourceUrl]);
  const fitImage = () => setViewport(fitBounds({ x: 0, y: 0, ...rig.image }, size));
  const fitPart = (group: string) => {
    const bounds = partBounds(group, overlay.shapes, overlay.handles);
    if (bounds) setViewport(fitBounds(bounds, size, 28));
  };
  useEffect(() => {
    if (!size.width || !size.height) return;
    const key = `${sourceUrl}:${rig.image.width}:${rig.image.height}`, previous = measured.current;
    if (key !== previous.source) fitImage();
    else setViewport(current => ({ ...current, x: current.x + (size.width - previous.width) / 2, y: current.y + (size.height - previous.height) / 2 }));
    measured.current = { ...size, source: key };
  }, [size, rig.image.width, rig.image.height, sourceUrl]);
  useEffect(() => {
    if (!focusRequest || focusRequest.id === focused.current || !size.width || !size.height) return;
    focused.current = focusRequest.id; fitPart(focusRequest.group);
  }, [focusRequest, overlay, size]);
  useEffect(() => {
    const element = canvas.current!;
    const point = (event: { clientX: number; clientY: number }): Point => {
      const rect = element.getBoundingClientRect();
      return [event.clientX - rect.left, event.clientY - rect.top];
    };
    const wheel = (event: WheelEvent) => {
      if (element.closest('[inert]') || drag.current) return;
      event.preventDefault(); setHover(null);
      if (gesture) return;
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1;
      if (event.ctrlKey || event.metaKey || (wheelMode === 'auto' && coarseWheel(event))) {
        setViewport(current => zoomAt(current, current.scale * Math.exp(-event.deltaY * units * 0.001), point(event)));
      } else setViewport(current => ({ ...current, x: current.x - event.deltaX * units, y: current.y - event.deltaY * units }));
    };
    type Gesture = Event & { scale: number; clientX: number; clientY: number };
    let gesture: { view: Viewport; point: Point; scale: number } | null = null;
    const start = (raw: Event) => {
      if (element.closest('[inert]') || drag.current) return;
      raw.preventDefault(); setHover(null); const event = raw as Gesture;
      const anchor = point(event);
      gesture = { view: { ...viewRef.current }, point: anchor.every(Number.isFinite) && anchor[0] >= 0 && anchor[0] <= size.width && anchor[1] >= 0 && anchor[1] <= size.height ? anchor : [size.width / 2, size.height / 2], scale: event.scale > 0 ? event.scale : 1 };
    };
    const change = (raw: Event) => {
      if (!gesture) return;
      raw.preventDefault(); const event = raw as Gesture;
      if (Number.isFinite(event.scale) && event.scale > 0) setViewport(zoomAt(gesture.view, gesture.view.scale * event.scale / gesture.scale, gesture.point));
    };
    const end = (event: Event) => { if (gesture) event.preventDefault(); gesture = null; };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('gesturestart', start, { passive: false });
    element.addEventListener('gesturechange', change, { passive: false });
    element.addEventListener('gestureend', end, { passive: false });
    return () => { element.removeEventListener('wheel', wheel); element.removeEventListener('gesturestart', start); element.removeEventListener('gesturechange', change); element.removeEventListener('gestureend', end); };
  }, [size, wheelMode]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || inputFocused(event.target) || canvas.current?.closest('[inert]')) return;
      const key = event.key;
      if (!['+', '=', '-', '0', '1'].includes(key)) return;
      event.preventDefault(); setHover(null);
      if (key === '0') fitImage();
      else setViewport(current => zoomAt(current, key === '1' ? 1 : current.scale * (key === '-' ? 0.8 : 1.25), [size.width / 2, size.height / 2]));
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [size, rig.image.width, rig.image.height]);
  useEffect(() => {
    const element = canvas.current!;
    element.width = Math.round(size.width);
    element.height = Math.round(size.height);
    const context = element.getContext('2d')!;
    context.fillStyle = '#f9fafc';
    context.fillRect(0, 0, element.width, element.height);
    if (imageReady && source.current) {
      context.globalAlpha = 0.7;
      context.drawImage(source.current, view.x, view.y, rig.image.width * view.scale, rig.image.height * view.scale);
      context.globalAlpha = 1;
    }
    for (const shape of shapes) {
      if (shape.band && selected?.split('.')[0] !== shape.group) continue;
      const active = focusGroup === shape.group;
      context.globalAlpha = !focusGroup ? 0.6 : active ? 1 : 0.2;
      context.strokeStyle = PART_COLORS[shape.group as PartGroup];
      context.lineWidth = active ? 2.5 : 1;
      context.beginPath();
      if (shape.kind === 'ellipse') {
        const [x, y] = screen(shape.points[0], view);
        context.ellipse(x, y, shape.radius![0] * view.scale, shape.radius![1] * view.scale, shape.angle ?? 0, 0, Math.PI * 2);
      } else {
        shape.points.forEach((point, i) => {
          const [x, y] = screen(point, view);
          if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
        });
        if (shape.closed) context.closePath();
      }
      context.stroke();
    }
    for (const handle of handles) {
      const [x, y] = screen(handle.point, view);
      const active = focusGroup === handle.group;
      context.globalAlpha = !focusGroup ? 0.6 : active ? 1 : 0.2;
      context.beginPath();
      context.arc(x, y, active ? 5 : 3.5, 0, Math.PI * 2);
      context.fillStyle = PART_COLORS[handle.group as PartGroup];
      context.fill();
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1;
      context.stroke();
    }
    context.globalAlpha = 1;
  }, [rig, handles, shapes, selected, focusGroup, size, imageReady, view]);
  const local = (event: { clientX: number; clientY: number }): Point => {
    const rect = canvas.current!.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };
  return (
    <div className="canvas-content">
      <div className="canvas-surface">
      <canvas ref={canvas} className="editor-canvas" data-testid="editor" tabIndex={0}
        aria-label={t.canvas} data-scale={view.scale} data-offset-x={view.x} data-offset-y={view.y}
        data-focus-group={focusGroup} data-visible-groups={visible.join(',')}
        data-dimmed-groups={focusGroup ? visible.filter(g => g !== focusGroup).join(',') : ''}
        data-inactive-opacity={focusGroup ? '0.2' : '0.6'}
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onKeyDown={event => { if (event.code === 'Space') { event.preventDefault(); space.current = true; } }}
        onKeyUp={event => { if (event.code === 'Space') space.current = false; }}
        onBlur={() => { space.current = false; }}
        onContextMenu={event => event.preventDefault()}
        onPointerDown={event => {
          event.preventDefault();
          event.currentTarget.focus();
          const point = local(event);
          if (event.button === 1 || space.current) {
            drag.current = { rig, start: point, view: { ...viewRef.current }, offset: [0, 0] };
          } else if (event.button === 0) {
            const handle = nearestHandle(interactiveHandles, point, view);
            if (!handle) {
              drag.current = { rig, start: point, view: { ...viewRef.current }, offset: [0, 0] };
            } else {
              onSelect(handle.item);
              if (event.altKey && handle.vertex) {
                onChange(changeVertex(rig, handle.vertex.path, handle.vertex.index, null, handle.vertex.closed));
                return;
              }
              const origin = imagePoint(point, view);
              drag.current = { handle, rig, start: point, view: { ...viewRef.current }, offset: [handle.point[0] - origin[0], handle.point[1] - origin[1]] };
              onBegin?.();
            }
          } else return;
          setHover(null);
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!drag.current) {
            const point = local(event), handle = nearestHandle(interactiveHandles, point, view);
            setHover(handle ? { handle, point } : null);
            return;
          }
          const point = local(event), current = drag.current;
          if (!current.handle) setViewport({ ...current.view, x: current.view.x + point[0] - current.start[0], y: current.view.y + point[1] - current.start[1] });
          else {
            const target = imagePoint(point, view);
            onChange(moveHandle(current.rig, current.handle, [target[0] + current.offset[0], target[1] + current.offset[1]]));
          }
        }}
        onPointerLeave={() => setHover(null)}
        onPointerUp={() => { if (drag.current?.handle) onEnd?.(); drag.current = null; setDragging(false); }}
        onPointerCancel={() => { if (drag.current?.handle) onEnd?.(); drag.current = null; setDragging(false); }}
        onDoubleClick={event => {
          const edge = nearestEdge(interactiveShapes, local(event), view);
          if (edge) {
            onSelect(edge.shape.item);
            onChange(changeVertex(rig, edge.shape.item, edge.index, edge.point, !!edge.shape.closed));
          }
        }} />
      {hover && interactiveHandles.includes(hover.handle) && <div role="tooltip" className="handle-tooltip"
        style={{ left: Math.max(8, Math.min(hover.point[0] + 12, size.width - 220)), top: Math.max(8, hover.point[1] - 38) }}>{title(hover.handle.id)}</div>}
      </div>
      <div className="canvas-help">
        <span className="context-hint">{hint}</span>
        <div className="zoom-tools" role="group" aria-label={t.zoom}>
          <button disabled={view.scale <= 0.1} aria-label={t.zoomOut} title={t.zoomOut} onClick={() => setViewport(current => zoomAt(current, current.scale * 0.8, [size.width / 2, size.height / 2]))}>−</button>
          <button className="zoom-value" data-testid="zoom-value" title={t.actualSize} aria-label={t.actualSize} onClick={() => setViewport(current => zoomAt(current, 1, [size.width / 2, size.height / 2]))}>{Math.round(view.scale * 100)}%</button>
          <button disabled={view.scale >= 16} aria-label={t.zoomIn} title={t.zoomIn} onClick={() => setViewport(current => zoomAt(current, current.scale * 1.25, [size.width / 2, size.height / 2]))}>+</button>
          <button title={t.panHint} onClick={fitImage}>{t.fit}</button>
          <button disabled={!focusGroup || !partBounds(focusGroup, overlay.shapes, overlay.handles)} onClick={() => fitPart(focusGroup)}>{t.fitPart}</button>
        </div>
      </div>
      <label className="wheel-setting">{t.wheelMode}<select aria-label={t.wheelMode} value={wheelMode} onChange={event => { setWheelMode(event.target.value); savePreference('mesh-avatar-wheel-mode', event.target.value); }}><option value="auto">{t.wheelAuto}</option><option value="pan">{t.wheelPan}</option></select></label>
    </div>
  );
}
