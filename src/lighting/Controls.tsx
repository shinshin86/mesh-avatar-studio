import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { colorHex, DEFAULT_LIGHTING, type LightingSettings } from 'mesh-avatar';
import './lighting.css';

export const lightingText = {
  en: { title: 'Lighting', enabled: 'Enable lighting', height: 'Light height', strength: 'Strength', intensity: 'Intensity', ambient: 'Ambient light', color: 'Light color', mode: 'Shading', soft: 'Soft', cel: 'Cel', shadow: 'Drop shadow', reset: 'Reset lighting', handle: 'Light position', hint: 'Drag the light over the preview. Arrow keys move it too.', reach: 'Light spread', ambientColor: 'Ambient color', softness: 'Shading smoothness', specular: 'Gloss', rim: 'Rim light', detail: 'Stroke relief', light: 'Light', surface: 'Shading' },
  ja: { title: 'ライティング', enabled: 'ライティングを有効にする', height: '光源の高さ', strength: '陰影の強さ', intensity: '光の強さ', ambient: '環境光', color: '光の色', mode: '陰影の種類', soft: 'やわらかい陰影', cel: 'セル調', shadow: '背後の影', reset: 'ライティングをリセット', handle: '光源の位置', hint: 'プレビュー上の光源をドラッグします。矢印キーでも移動できます。', reach: '光の広がり', ambientColor: '環境光の色', softness: '陰影のなめらかさ', specular: 'つや', rim: 'リムライト', detail: '描線の凹凸', light: '光源', surface: '陰影' },
  zh: { title: '光源与阴影', enabled: '启用光照', height: '光源高度', strength: '明暗强度', intensity: '光照强度', ambient: '环境光', color: '光源颜色', mode: '着色方式', soft: '柔和', cel: '赛璐璐', shadow: '投影', reset: '重置光照', handle: '光源位置', hint: '在预览上拖动光源，也可使用方向键移动。', reach: '光照范围', ambientColor: '环境光颜色', softness: '明暗过渡', specular: '光泽', rim: '轮廓光', detail: '线条凹凸', light: '光源', surface: '明暗' },
};
type Props = { value: LightingSettings; onChange: (value: LightingSettings) => void; language: keyof typeof lightingText };
export function LightingControls({ value, onChange, language }: Props) {
  const t = lightingText[language];
  type Key = 'z' | 'reach' | 'intensity' | 'ambient' | 'strength' | 'softness' | 'specular' | 'rim' | 'detail';
  const sliders = (items: { key: Key; label: keyof typeof t; min: number; max: number }[]) => items.map(({ key, label, min, max }) =>
    <label className="lighting-slider" key={key}>{t[label]}<input aria-label={t[label]} type="range" min={min} max={max} step="0.01" value={value[key]} onChange={e => onChange({ ...value, [key]: Number(e.target.value) })} /><output>{value[key].toFixed(2)}</output></label>);
  return <div className="lighting-controls">
    <label className="lighting-check"><input type="checkbox" checked={value.enabled} onChange={e => onChange({ ...value, enabled: e.target.checked })} />{t.enabled}</label>
    <fieldset disabled={!value.enabled}>
      <legend>{t.light}</legend>
      {sliders([{ key: 'z', label: 'height', min: 0.1, max: 2 }, { key: 'reach', label: 'reach', min: 0.2, max: 3 },
        { key: 'intensity', label: 'intensity', min: 0, max: 2 }, { key: 'ambient', label: 'ambient', min: 0, max: 1 }])}
      <label className="lighting-color">{t.color}<input aria-label={t.color} type="color" value={colorHex(value.color)} onChange={e => onChange({ ...value, color: parseInt(e.target.value.slice(1), 16) })} /></label>
      <label className="lighting-color">{t.ambientColor}<input aria-label={t.ambientColor} type="color" value={colorHex(value.ambientColor)} onChange={e => onChange({ ...value, ambientColor: parseInt(e.target.value.slice(1), 16) })} /></label>
    </fieldset>
    <fieldset disabled={!value.enabled}>
      <legend>{t.surface}</legend>
      {sliders([{ key: 'strength', label: 'strength', min: 0, max: 1 }, { key: 'softness', label: 'softness', min: 0, max: 1 },
        { key: 'specular', label: 'specular', min: 0, max: 1 }, { key: 'rim', label: 'rim', min: 0, max: 1 }, { key: 'detail', label: 'detail', min: 0, max: 1 }])}
      <label>{t.mode}<select aria-label={t.mode} value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as 'soft' | 'cel' })}><option value="soft">{t.soft}</option><option value="cel">{t.cel}</option></select></label>
      <label className="lighting-check"><input type="checkbox" checked={value.shadow} onChange={e => onChange({ ...value, shadow: e.target.checked })} />{t.shadow}</label>
    </fieldset>
    <button type="button" onClick={() => onChange({ ...DEFAULT_LIGHTING })}>{t.reset}</button><p className="lighting-hint">{t.hint}</p>
  </div>;
}
export function LightHandle({ value, onChange, language }: Props) {
  const handle = useRef<HTMLButtonElement>(null);
  const [area, setArea] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const canvas = handle.current?.parentElement?.querySelector('canvas');
    if (!canvas) return;
    const update = () => setArea({ left: canvas.offsetLeft, top: canvas.offsetTop, width: canvas.clientWidth, height: canvas.clientHeight });
    const observer = new ResizeObserver(update); observer.observe(canvas); observer.observe(canvas.parentElement!); update();
    return () => observer.disconnect();
  }, []);
  const position = (e: PointerEvent<HTMLButtonElement>) => {
    const bounds = e.currentTarget.parentElement!.querySelector('canvas')!.getBoundingClientRect();
    onChange({ ...value, x: Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (e.clientY - bounds.top) / bounds.height)) });
  };
  const move = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const offsets: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!offsets[e.key]) return;
    e.preventDefault();
    onChange({ ...value, x: Math.max(0, Math.min(1, value.x + offsets[e.key][0])), y: Math.max(0, Math.min(1, value.y + offsets[e.key][1])) });
  };
  return <button ref={handle} type="button" className="light-handle" aria-label={lightingText[language].handle} title={lightingText[language].hint}
    disabled={!value.enabled} style={{ left: area ? area.left + value.x * area.width : `${value.x * 100}%`, top: area ? area.top + value.y * area.height : `${value.y * 100}%` }}
    onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); position(e); }}
    onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) position(e); }}
    onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }} onKeyDown={move}>☀</button>;
}
