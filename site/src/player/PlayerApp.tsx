import { colorHex, LIVE_EXPRESSIONS, loadMeshAvatar, type LiveExpression, type MeshAvatar } from 'mesh-avatar';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Icon } from '../../../src/editor/Icon';
import { LightHandle, LightingControls, lightingText } from '../../../src/lighting/Controls';
import { loadLightingPresets, sameLighting, saveLightingPresets } from '../../../src/lighting/presets';
import { loadLighting, saveLighting } from '../../../src/lighting/storage';
import { liveText } from '../../../src/live/i18n';
import { CameraCapture, MicrophoneCapture, type BackgroundTracking, type CameraState, type MicState } from '../../../src/live/media';
import { backgroundColor } from '../../../src/live/settings';
import { FacePose, type TrackingOptions } from '../../../src/live/tracking';
import { runAvatarLoop } from './loop';
import { playerText, type PlayerLanguage } from './text';

// Settings saved in this browser use their own key, separate from Studio projects.
const STORAGE_KEY = 'player';
const MAX_BYTES = 128 * 1024 * 1024;
const SAMPLE_URL = `${import.meta.env.BASE_URL}miko.mavatar`;
const WORKER_URL = `${import.meta.env.BASE_URL}mediapipe/tracking-worker.js`;
const MIKO_TERMS = 'https://miko.aituberonair.com/#terms';
const STUDIO_URL = 'https://github.com/shinshin86/mesh-avatar-studio';

type Source = { kind: 'sample' } | { kind: 'file'; file: File };
type ViewState = 'loading' | 'ready';
type Notice = 'loadError' | 'tooLarge' | null;
interface DocumentPictureInPicture { requestWindow(options?: { width?: number; height?: number }): Promise<Window> }
const pictureInPicture = () => (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture;

export function PlayerApp({ language }: { language: PlayerLanguage }) {
  const t = { ...liveText[language], ...playerText[language] };
  const [source, setSource] = useState<Source>({ kind: 'sample' });
  const goodSource = useRef<Source>(source);
  const [viewState, setViewState] = useState<ViewState>('loading');
  const [notice, setNotice] = useState<Notice>(null);
  const [dragging, setDragging] = useState(false);
  const [background, setBackground] = useState('transparent');
  const [fit, setFit] = useState<'contain' | 'cover'>('contain');
  const [lighting, setLighting] = useState(() => loadLighting(STORAGE_KEY));
  const [lightingOpen, setLightingOpen] = useState(false);
  const [presets, setPresets] = useState(() => loadLightingPresets(STORAGE_KEY));
  const presetsRef = useRef(presets); presetsRef.current = presets;
  const [expression, setExpression] = useState<LiveExpression>('neutral');
  const expressionRef = useRef(expression); expressionRef.current = expression;
  const [options, setOptions] = useState<TrackingOptions>({ mirror: true, sensitivity: 1, smoothing: 0.35 });
  const [cameraState, setCameraState] = useState<CameraState>('stopped');
  const [micState, setMicState] = useState<MicState>('micOff');
  const [tracking, setTracking] = useState(false), [showCamera, setShowCamera] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [cameraId, setCameraId] = useState(''), [micId, setMicId] = useState('');
  const [gain, setGain] = useState(1), [calibrated, setCalibrated] = useState(false);
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundTracking>(null);
  const [popup, setPopup] = useState<Window | null>(null);
  const [fullWindow, setFullWindow] = useState(false), [exitHint, setExitHint] = useState(false);
  const stage = useRef<HTMLDivElement>(null), video = useRef<HTMLVideoElement>(null), fileInput = useRef<HTMLInputElement>(null);
  // React never renders this canvas, so it can move to the avatar window and back.
  const [canvas] = useState(() => Object.assign(document.createElement('canvas'), { className: 'player-canvas' }));
  const loop = useRef<ReturnType<typeof runAvatarLoop> | null>(null);
  const camera = useRef<CameraCapture | null>(null), microphone = useRef<MicrophoneCapture | null>(null);
  const avatarRef = useRef<MeshAvatar | null>(null);
  const lightRef = useRef(lighting); lightRef.current = lighting;
  const pose = useRef(new FacePose());
  const controls = useRef({ options, gain, micState }); controls.current = { options, gain, micState };
  const refreshDevices = () => { void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => undefined); };

  useEffect(() => {
    canvas.dataset.testid = 'player-avatar';
    if (!popup) stage.current?.prepend(canvas);
  }, [canvas, popup]);
  useEffect(() => {
    const capture = new CameraCapture(video.current!, (result, now) => pose.current.update(result, now), state => { setCameraState(state); if (state !== 'running') setTracking(false); }, WORKER_URL);
    const mic = new MicrophoneCapture(setMicState);
    camera.current = capture; microphone.current = mic;
    refreshDevices(); navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    const stop = () => { capture.stop(); mic.stop(); pose.current.reset(); };
    window.addEventListener('pagehide', stop);
    return () => { stop(); navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices); window.removeEventListener('pagehide', stop); };
  }, []);
  useEffect(() => {
    // Timers keep the hidden-page warning current while the avatar window is in front.
    const timer = setInterval(() => {
      const now = performance.now();
      setBackgroundStatus(camera.current?.backgroundStatus(document.visibilityState === 'hidden', now) ?? null);
    }, 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let cancelled = false, avatar: MeshAvatar | undefined;
    setViewState('loading');
    const load = source.kind === 'sample' ? SAMPLE_URL : source.file;
    void loadMeshAvatar(canvas, load, { manual: true, fit, preserveMouthForm: true }).then(value => {
      if (cancelled) { value.destroy(); return; }
      avatar = value; avatarRef.current = value; goodSource.current = source;
      value.setLighting(lightRef.current); value.setExpression(expressionRef.current);
      loop.current = runAvatarLoop(value, canvas, (now, dt) => {
        const control = controls.current, sampled = pose.current.sample(now, dt, control.options);
        setTracking(sampled.tracking);
        value.setAutoIdle(!sampled.tracking); value.setAutoMotion(!sampled.tracking);
        value.setParameters(sampled.params, sampled.weight);
        const voice = control.micState === 'micOn' ? microphone.current?.sample(control.gain, now) : null;
        value.setSpeaking(voice?.speaking ?? false); value.setVoiceLevel(voice?.level ?? 0);
      });
      setViewState('ready');
    }).catch((error: unknown) => {
      if (cancelled) return;
      console.warn('Could not open the avatar:', error);
      setNotice('loadError');
      // Return to the last avatar that opened, or to the sample if none did.
      setSource(goodSource.current === source ? { kind: 'sample' } : goodSource.current);
    });
    return () => { cancelled = true; loop.current?.stop(); loop.current = null; avatar?.destroy(); avatarRef.current = null; };
  }, [source, fit, canvas]);
  useEffect(() => { saveLighting(STORAGE_KEY, lighting); avatarRef.current?.setLighting(lighting); }, [lighting]);
  useEffect(() => { avatarRef.current?.setExpression(expression); }, [expression]);
  useEffect(() => {
    // The exit hint shows briefly only, so it does not appear in a window capture later.
    setExitHint(fullWindow);
    if (!fullWindow) return;
    const timer = setTimeout(() => setExitHint(false), 3000);
    return () => clearTimeout(timer);
  }, [fullWindow]);

  const openFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) { setNotice('tooLarge'); return; }
    setNotice(null); setSource({ kind: 'file', file });
  };
  const applyPreset = (preset: number) => { const value = presetsRef.current[preset - 1]; if (value) setLighting({ ...value }); };
  const savePreset = (index: number) => {
    const next = presets.map((value, i) => i === index ? { ...lighting } : value);
    setPresets(next); saveLightingPresets(STORAGE_KEY, next);
  };
  const applyPresetRef = useRef(applyPreset); applyPresetRef.current = applyPreset;
  const fullWindowRef = useRef(fullWindow); fullWindowRef.current = fullWindow;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === 'Escape' && fullWindowRef.current) { setFullWindow(false); return; }
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || target?.closest?.('input, select, textarea, [contenteditable="true"]')) return;
      if (event.shiftKey) {
        const preset = /^Digit([1-8])$/.exec(event.code);
        if (preset) { event.preventDefault(); applyPresetRef.current(Number(preset[1])); }
        return;
      }
      const name = LIVE_EXPRESSIONS[Number(event.key) - 1];
      if (!/^[1-8]$/.test(event.key) || !name) return;
      event.preventDefault(); setExpression(name);
    };
    window.addEventListener('keydown', onKey);
    popup?.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); popup?.removeEventListener('keydown', onKey); };
  }, [popup]);
  useEffect(() => {
    if (!popup) return;
    popup.document.body.style.background = background === 'transparent' ? '#ffffff' : background;
  }, [popup, background]);

  const openPopup = async () => {
    const pip = pictureInPicture();
    if (!pip || popup) return;
    const rect = canvas.getBoundingClientRect();
    const size = Math.round(Math.min(720, Math.max(360, rect.height)));
    const win = await pip.requestWindow({ width: size, height: size });
    win.document.title = 'Mesh Avatar';
    const style = win.document.createElement('style');
    style.textContent = 'html, body { margin: 0; height: 100%; overflow: hidden; } .player-canvas { display: block; width: 100vw; height: 100vh; }';
    win.document.head.append(style);
    win.document.body.append(canvas);
    loop.current?.retarget();
    win.addEventListener('pagehide', () => {
      stage.current?.prepend(canvas);
      loop.current?.retarget();
      setPopup(null);
    }, { once: true });
    setPopup(win);
  };

  const onDrag = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    setDragging(event.type !== 'dragleave' || event.currentTarget.contains(event.relatedTarget as Node | null));
  };
  const onDrop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); setDragging(false);
    openFile(event.dataTransfer.files[0]);
  };

  const cameraActive = cameraState === 'starting' || cameraState === 'running';
  const micActive = micState === 'micStarting' || micState === 'micOn';
  const status = cameraState === 'running' ? tracking ? 'tracking' : 'lost' : cameraState;
  const sourceName = source.kind === 'sample' ? t.sample : source.file.name;
  const otherLanguage = language === 'ja' ? '../../play/' : '../ja/play/';
  const canPopOut = !!pictureInPicture();
  const stageBackground = { backgroundColor: background, backgroundImage: background === 'transparent' ? undefined : 'none' };

  return <main className={`live-app player-app${fullWindow ? ' player-full' : ''}`} onDragEnter={onDrag} onDragOver={onDrag} onDragLeave={onDrag} onDrop={onDrop}>
    <header className="live-header"><div><a href="../" aria-label={t.home}>Mesh Avatar Studio</a><h1>Mesh Avatar <span>{t.title}</span></h1></div>
      <a className="player-language" href={otherLanguage} lang={language === 'ja' ? 'en' : 'ja'}>{t.otherLanguage}</a>
    </header>
    <p className="player-intro">{t.intro}</p>
    <div className="live-layout"><section className="live-view">
      <div ref={stage} className="live-preview checkerboard lighting-preview player-stage" style={stageBackground} onClick={() => { if (fullWindow) setFullWindow(false); }}>
        {popup && <p className="player-popped">{t.popped}</p>}
        {lightingOpen && !popup && !fullWindow && <LightHandle value={lighting} onChange={setLighting} language={language} />}
        {dragging && <div className="player-drop" aria-hidden="true">{t.dropHere}</div>}
      </div>
      <p role="status" data-testid="player-status">{t[viewState]} · {sourceName}</p>
      {exitHint && <p className="player-exit" data-testid="player-exit-hint">{t.exitFullWindow}</p>}
    </section>
    <aside className="live-controls">
      <section><h2>{t.avatar}</h2>
        <p className="player-source" data-testid="player-source">{sourceName}</p>
        <div className="live-buttons">
          <button className="live-primary" onClick={() => fileInput.current?.click()}>{t.open}</button>
          {source.kind === 'file' && <button onClick={() => { setNotice(null); setSource({ kind: 'sample' }); }}>{t.useSample}</button>}
        </div>
        <input ref={fileInput} type="file" accept=".mavatar" hidden data-testid="player-file" onChange={event => { openFile(event.target.files?.[0]); event.target.value = ''; }} />
        {notice && <p role="alert" className="live-error" data-testid="player-notice">{t[notice]}</p>}
        <small>{t.dropHint}</small>
        <small><a href={STUDIO_URL}>{t.makeOwn}</a></small>
      </section>
      <section><h2>{t.camera}</h2><label>{t.device}<select aria-label={t.camera} value={cameraId} disabled={cameraActive} onChange={event => setCameraId(event.target.value)}><option value="">{t.defaultDevice}</option>{devices.filter(device => device.kind === 'videoinput' && device.deviceId).map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${t.camera} ${i + 1}`}</option>)}</select></label>
        <div className="live-buttons"><button className="live-primary" disabled={!cameraActive && viewState !== 'ready'} onClick={() => {
          setCalibrated(false); pose.current.reset();
          if (cameraActive) camera.current?.stop(); else void camera.current?.start(cameraId).then(refreshDevices);
        }}>{cameraActive ? t.stop : t.start}</button><button disabled={!tracking} onClick={() => setCalibrated(pose.current.calibrate(performance.now()))}>{t.calibrate}</button></div>
        <p role="status" data-testid="tracking-status" data-state={status}>{t[status]}</p>
        {backgroundStatus && <p role="alert" className="live-error">{t[backgroundStatus]}</p>}
        <small>{calibrated ? t.calibrated : t.calibrateHint}</small>
        <label className="live-check"><input type="checkbox" checked={options.mirror} onChange={event => setOptions(current => ({ ...current, mirror: event.target.checked }))} />{t.mirror}</label>
        <label>{t.sensitivity}<input type="range" min="0.25" max="2" step="0.05" value={options.sensitivity} onChange={event => setOptions(current => ({ ...current, sensitivity: Number(event.target.value) }))} /></label>
        <label>{t.smoothing}<input type="range" min="0" max="1" step="0.05" value={options.smoothing} onChange={event => setOptions(current => ({ ...current, smoothing: Number(event.target.value) }))} /></label>
        <label className="live-check"><input type="checkbox" checked={showCamera} onChange={event => setShowCamera(event.target.checked)} />{t.cameraPreview}</label>
        <video ref={video} autoPlay muted playsInline className={showCamera ? 'camera-preview' : 'camera-preview camera-hidden'} style={{ transform: options.mirror ? 'scaleX(-1)' : undefined }} aria-label={t.cameraPreview} />
      </section>
      <section><h2>{t.microphone}</h2><label className="live-check"><input type="checkbox" checked={micActive} disabled={!micActive && viewState !== 'ready'} onChange={event => { if (event.target.checked) void microphone.current?.start(micId).then(refreshDevices); else microphone.current?.stop(); }} />{t.microphone}</label>
        <select aria-label={t.microphone} value={micId} disabled={micActive} onChange={event => setMicId(event.target.value)}><option value="">{t.defaultDevice}</option>{devices.filter(device => device.kind === 'audioinput' && device.deviceId).map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${t.microphone} ${i + 1}`}</option>)}</select>
        <label>{t.gain}<input type="range" min="0.25" max="5" step="0.05" value={gain} onChange={event => setGain(Number(event.target.value))} /></label><small role="status">{t[micState]}</small>
      </section>
      <section><h2>{t.background}</h2><select aria-label={t.background} value={background} onChange={event => setBackground(backgroundColor(event.target.value))}>
        <option value="transparent">{t.none}</option><option value="#00ff00">{t.green}</option><option value="#0000ff">{t.blue}</option>{!['transparent', '#00ff00', '#0000ff'].includes(background) && <option value={background}>{t.custom}</option>}
      </select><small className="background-hint" data-testid="background-hint">{background === 'transparent' ? t.bgHintNone : ['#00ff00', '#0000ff'].includes(background) ? t.bgHintChroma : t.bgHintCustom}</small>
        <label>{t.custom}<input type="color" value={background === 'transparent' ? '#ffffff' : background} onChange={event => setBackground(event.target.value)} /></label>
        <label>{t.fit}<select value={fit} onChange={event => setFit(event.target.value as 'contain' | 'cover')}><option value="contain">{t.contain}</option><option value="cover">{t.cover}</option></select></label>
      </section>
      <section><h2>{t.show}</h2><small>{t.showHelp}</small>
        <div className="live-buttons player-show">
          {canPopOut
            ? <button className="live-primary" disabled={viewState !== 'ready'} onClick={() => { if (popup) popup.close(); else void openPopup().catch(() => undefined); }}>{popup ? t.popIn : t.popOut}</button>
            : <small>{t.popOutUnsupported}</small>}
          <button disabled={!!popup} onClick={() => setFullWindow(true)}>{t.fullWindow}</button>
        </div>
        <small>{t.keepVisible}</small>
      </section>
      <details className="live-expression" data-testid="expression-section">
        <summary><Icon name="face" />{t.expression}{expression !== 'neutral' && <span className="expression-on">{t[expression]}</span>}</summary>
        <div className="live-expression-body"><div className="expression-buttons" role="group" aria-label={t.expression}>
          {LIVE_EXPRESSIONS.map((name, i) => <button key={name} type="button" aria-pressed={expression === name} aria-keyshortcuts={String(i + 1)} onClick={() => setExpression(name)}><kbd>{i + 1}</kbd>{t[name]}</button>)}
        </div><small>{t.expressionHint}</small></div>
      </details>
      <details className="live-lighting" data-testid="lighting-section" onToggle={event => setLightingOpen(event.currentTarget.open)}>
        <summary><Icon name="light" />{lightingText[language].title}{lighting.enabled && <span className="lighting-on">ON</span>}</summary>
        <div className="lighting-presets"><h3>{t.presets}</h3>
          <div className="preset-slots" role="group" aria-label={t.presets}>
            {presets.map((value, i) => <div className="preset-slot" key={i}>
              <button type="button" disabled={!value} aria-label={`${t.preset} ${i + 1}${value ? '' : ` (${t.presetEmpty})`}`} aria-pressed={!!value && sameLighting(value, lighting)} aria-keyshortcuts={`Shift+${i + 1}`} onClick={() => applyPreset(i + 1)}>
                <kbd>⇧{i + 1}</kbd>{value ? <span className={`preset-swatch${value.enabled ? '' : ' off'}`} style={value.enabled ? { background: `linear-gradient(135deg, ${colorHex(value.color)} 50%, ${colorHex(value.ambientColor)} 50%)` } : undefined} /> : t.presetEmpty}</button>
              <button type="button" className="preset-save" aria-label={`${t.presetSave}: ${t.preset} ${i + 1}`} onClick={() => savePreset(i)}>{t.presetSave}</button>
            </div>)}
          </div><small>{t.presetHint}</small>
        </div>
        <LightingControls value={lighting} onChange={setLighting} language={language} />
      </details>
      <p className="live-privacy">{t.privacy}</p>
      {source.kind === 'sample' && <p className="live-privacy">{t.credit} <a href={MIKO_TERMS}>{t.terms}</a></p>}
    </aside></div>
  </main>;
}
