import { LightingControls, LightHandle, lightingText } from '../lighting/Controls';
import { loadLighting, saveLighting } from '../lighting/storage';
import { useEffect, useRef, useState } from 'react';
import { createMeshAvatar, type MeshAvatar, PARAMS, type Rig } from 'mesh-avatar';
import { VOWELS, skippedKanaCharacters } from '../../packages/runtime/src/engine/kana.js';
import { useI18n } from './i18n';
import { Icon } from './Icon';

const defaults: Record<string, number> = Object.fromEntries(PARAMS.map(p => [p.id, p.def]));
const sliders = [
  { id: 'angleX', label: 'turn', min: -30, max: 30, def: 0 },
  { id: 'angleY', label: 'look', min: -30, max: 30, def: 0 },
  { id: 'angleZ', label: 'tilt', min: -30, max: 30, def: 0 },
  { id: 'EyeOpen', label: 'eyeOpen', min: 0, max: 1.25, def: 1 },
  { id: 'mouthOpen', label: 'mouthOpen', min: 0, max: 1, def: 0 },
  { id: 'bodyAngleZ', label: 'bodyTilt', min: -10, max: 10, def: 0 },
] as const;
type Vowel = 'a' | 'i' | 'u' | 'e' | 'o' | 'n';
type Lip = { kind: 'hold'; vowel: Vowel } | { kind: 'text'; text: string; speed: number; loop: boolean } | null;
export function Preview({ projectKey, rig, assets, hasMouthSprites, onDrawMouth }: { projectKey: string; rig: Rig; assets?: Record<string, string>; hasMouthSprites: boolean; onDrawMouth: () => void }) {
  const { t, language } = useI18n();
  const [lighting, setLighting] = useState(() => loadLighting(projectKey));
  const lightRef = useRef(lighting); lightRef.current = lighting;
  const canvas = useRef<HTMLCanvasElement>(null);
  const avatar = useRef<MeshAvatar | null>(null);
  const [status, setStatus] = useState<'loading' | 'updating' | 'ready' | 'previewError'>('loading');
  const [revision, setRevision] = useState(0);
  const [idle, setIdle] = useState(true);
  const [stress, setStress] = useState(false);
  const [parameters, setParameters] = useState<Record<string, number>>({});
  const [lip, setLip] = useState<Lip>(null);
  const [text, setText] = useState('あいうえお');
  const [speed, setSpeed] = useState(7);
  const [loop, setLoop] = useState(false);
  const [liveMouth, setLiveMouth] = useState(0);
  const [tab, setTab] = useState<'pose' | 'lip'>('pose');
  const [lightingOpen, setLightingOpen] = useState(false);
  const skipped = skippedKanaCharacters(text).join(' ');
  const controls = useRef({ idle, stress, parameters });
  controls.current = { idle, stress, parameters };
  useEffect(() => {
    let cancelled = false;
    let instance: MeshAvatar | undefined;
    setStatus('updating');
    const timer = setTimeout(() => {
      createMeshAvatar(canvas.current!, { rig, assets, assetsBase: '/miko-qipao/built/', manual: true }).then(value => {
        if (cancelled) { value.destroy(); return; }
        instance = value;
        avatar.current = value;
        value.setLighting(lightRef.current);
        const control = controls.current;
        value.setAutoIdle(control.idle && !control.stress);
        value.setAutoMotion(control.idle && !control.stress);
        value.setParameters(control.idle && !control.stress ? control.parameters : { ...defaults, ...control.parameters });
        // A paused preview uses a fixed warm-up so edited rigs are compared at the same physics time.
        value.advance(control.idle && !control.stress ? 1 / 60 : 1);
        setRevision(current => current + 1);
        setStatus('ready');
      }).catch(() => { if (!cancelled) setStatus('previewError'); });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      instance?.destroy();
      if (avatar.current === instance) avatar.current = null;
    };
  }, [rig, idle, stress, assets]);
  useEffect(() => {
    const value = avatar.current;
    if (!value) return;
    value.setAutoIdle(idle && !stress);
    value.setAutoMotion(idle && !stress);
    const pose = lip ? { ...parameters, mouthOpen: 0 } : parameters;
    value.setParameters(idle && !stress ? pose : { ...defaults, ...pose });
    value.stopLipSync();
    if (lip?.kind === 'hold') value.holdMouth(lip.vowel);
    if (lip?.kind === 'text') value.speakKana(lip.text, { speed: lip.speed, loop: lip.loop });
    value.advance(0);
    if (!idle && !stress && !lip) return;
    let raf = 0;
    const start = performance.now();
    let previous = start;
    const frame = (now: number) => {
      if (stress) {
        const t = (now - start) / 1000;
        value.setParameters({ ...defaults, ...parameters,
          angleX: Math.sin(t * 2) * 30, angleY: Math.cos(t * 1.3) * 25,
          angleZ: Math.sin(t * 1.1) * 25, bodyAngleZ: Math.cos(t * 0.7) * 8 });
        if (t >= 6) { setStress(false); return; }
      }
      value.advance(lip ? Math.min(0.05, Math.max(0, (now - previous) / 1000)) : 1 / 60);
      previous = now;
      if (lip) {
        const state = value.getLipSyncState();
        setLiveMouth(Math.round(state.open * 100) / 100);
        if (!state.active) setLip(null);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [rig, assets, idle, stress, parameters, revision, lip]);
  useEffect(() => {
    saveLighting(projectKey, lighting);
    avatar.current?.setLighting(lighting);
    avatar.current?.advance(0);
  }, [lighting, projectKey]);
  return (
    <section className="panel preview-panel">
      <div className="panel-title"><h2>{t.preview}</h2><span role="status" data-testid="preview-status" data-state={status}>{t[status]}</span></div>
      <div className="lighting-preview"><canvas ref={canvas} data-testid="preview" data-revision={revision} className="preview-canvas"
        style={{ aspectRatio: `${rig.image.width * (1 + 2 * rig.view.padSide)} / ${rig.image.height * (1 + rig.view.padTop)}` }} />
      {lightingOpen && <LightHandle value={lighting} onChange={setLighting} language={language} />}
      </div>
      <div className="preview-tools">
        <button className="icon-button" aria-label={idle ? t.pause : t.play} title={idle ? t.pause : t.play}
          data-testid="idle-toggle" aria-pressed={idle} onClick={() => setIdle(current => !current)}><Icon name={idle ? 'pause' : 'play'} /></button><span>{t.idle}</span>
      </div>
      <div className="preview-tabs" role="tablist" aria-label={t.preview}>
        <button id="pose-tab" role="tab" aria-selected={tab === 'pose'} aria-controls="pose-panel" onClick={() => setTab('pose')}><Icon name="pose" />{t.pose}</button>
        <button id="lip-tab" role="tab" aria-selected={tab === 'lip'} aria-controls="lip-panel" onClick={() => setTab('lip')}><Icon name="mouth" />{t.lipSync}</button>
      </div>
      <div className="pose-test" id="pose-panel" role="tabpanel" aria-labelledby="pose-tab" hidden={tab !== 'pose'}>
      <div className="sliders">
        {sliders.map(slider => (
          <label key={slider.id}>{t[slider.label]}
            <input type="range" aria-label={t[slider.label]} min={slider.min} max={slider.max} step="0.05"
              disabled={slider.id === 'mouthOpen' && lip !== null}
              value={slider.id === 'mouthOpen' && lip ? liveMouth : parameters[slider.id === 'EyeOpen' ? 'eyeLOpen' : slider.id] ?? slider.def}
              onChange={event => {
                const value = Number(event.target.value);
                setParameters(current => slider.id === 'EyeOpen'
                  ? { ...current, eyeLOpen: value, eyeROpen: value }
                  : { ...current, [slider.id]: value });
              }} />
            <output>{(slider.id === 'mouthOpen' && lip ? liveMouth : parameters[slider.id === 'EyeOpen' ? 'eyeLOpen' : slider.id] ?? slider.def).toFixed(2)}</output>
          </label>
        ))}
      </div>
      <div className="pose-actions"><button className="reset-pose" onClick={() => { setParameters({}); setStress(false); setLip(null); }}>{t.reset}</button>
      <button className="sweep-button" title={t.sweepTip} onClick={() => setStress(current => !current)}>{stress ? t.stopSweep : t.sweep}</button></div>
      </div>
      <div className="lip-sync" id="lip-panel" role="tabpanel" aria-labelledby="lip-tab" hidden={tab !== 'lip'}>
        <div className="vowel-buttons" role="group" aria-label={t.lipSync}>
          {(Object.keys(VOWELS) as Vowel[]).map(vowel => <button key={vowel} aria-pressed={lip?.kind === 'hold' && lip.vowel === vowel}
            onClick={() => setLip(current => current?.kind === 'hold' && current.vowel === vowel ? null : { kind: 'hold', vowel })}>{VOWELS[vowel].label}</button>)}
          <button onClick={() => setLip(null)}>{t.release}</button>
        </div>
        <div className="lip-text-row"><input aria-label={t.lipText} value={text} onChange={event => setText(event.target.value)} />
          <button disabled={!text.trim()} onClick={() => setLip({ kind: 'text', text, speed, loop })}>{t.lipPlay}</button>
          <button disabled={!lip} onClick={() => setLip(null)}>{t.lipStop}</button>
        </div>
        <div className="lip-options"><label className="lip-speed">{t.lipSpeed}<input type="range" min="4" max="12" step="1" value={speed} aria-label={t.lipSpeed}
          onChange={event => { const value = Number(event.target.value); setSpeed(value); setLip(current => current?.kind === 'text' ? { ...current, speed: value } : current); }} /><output>{speed}</output></label>
          <label><input type="checkbox" checked={loop} onChange={event => { const value = event.target.checked; setLoop(value); setLip(current => current?.kind === 'text' ? { ...current, loop: value } : current); }} />{t.lipLoop}</label>
        </div>
        {!hasMouthSprites && <p className="mouth-fallback">{t.mouthFallback} <button type="button" onClick={onDrawMouth}>{t.drawMouth}</button></p>}
        <p className="lip-help">{t.lipHelp}</p>{skipped && <p className="lip-skipped">{t.skippedKana} {skipped}</p>}
        <div className="sliders lip-live"><label>{t.mouthOpen}<input type="range" aria-label={t.mouthOpen} min="0" max="1" step="0.01" disabled={lip !== null}
          value={lip ? liveMouth : parameters.mouthOpen ?? 0} onChange={event => setParameters(current => ({ ...current, mouthOpen: Number(event.target.value) }))} /><output>{(lip ? liveMouth : parameters.mouthOpen ?? 0).toFixed(2)}</output></label></div>
      </div>
      <details className="lighting-section" data-testid="lighting-section" onToggle={event => setLightingOpen(event.currentTarget.open)}>
        <summary><Icon name="light" />{lightingText[language].title}{lighting.enabled && <span className="lighting-on">ON</span>}</summary>
        <LightingControls value={lighting} onChange={setLighting} language={language} />
      </details>
    </section>
  );
}
