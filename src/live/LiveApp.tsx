import { LightingControls, LightHandle, lightingText } from '../lighting/Controls';
import { loadLighting, saveLighting } from '../lighting/settings';
import { LIVE_EXPRESSIONS, type LiveExpression, type MeshAvatar } from '../engine';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../editor/i18n';
import { createAvatarView } from './avatar-view';
import { viewSettings, streamUrl, backgroundColor } from './settings';
import { FacePose, type TrackingOptions } from './tracking';
import { CameraCapture, MicrophoneCapture, type CameraState, type MicState, type BackgroundTracking } from './media';
import { liveText } from './i18n';
import { Icon } from '../editor/Icon';
import { createLiveSender, sendLighting } from './relay';

export function LiveApp() {
  const { language, setLanguage } = useI18n(), t = liveText[language];
  const [settings, setSettings] = useState(() => { const view = viewSettings(location.search); return { ...view, lighting: view.lighting ?? loadLighting(view.project) }; });
  const [lightingOpen, setLightingOpen] = useState(false);
  const [expression, setExpression] = useState<LiveExpression>('neutral');
  const expressionRef = useRef(expression); expressionRef.current = expression;
  const [options, setOptions] = useState<TrackingOptions>({ mirror: true, sensitivity: 1, smoothing: 0.35 });
  const [cameraState, setCameraState] = useState<CameraState>('stopped');
  const [micState, setMicState] = useState<MicState>('micOff');
  const [tracking, setTracking] = useState(false), [showCamera, setShowCamera] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]), [cameraId, setCameraId] = useState(''), [micId, setMicId] = useState('');
  const [gain, setGain] = useState(1), [calibrated, setCalibrated] = useState(false);
  const [copyState, setCopyState] = useState<'copied' | 'copyError' | null>(null);
  const [viewState, setViewState] = useState<'loading' | 'ready' | 'projectError'>('loading');
  const [backgroundStatus, setBackgroundStatus] = useState<BackgroundTracking>(null);
  const canvas = useRef<HTMLCanvasElement>(null), video = useRef<HTMLVideoElement>(null);
  const camera = useRef<CameraCapture | null>(null), microphone = useRef<MicrophoneCapture | null>(null);
  const avatarRef = useRef<MeshAvatar | null>(null);
  const lightRef = useRef(settings.lighting); lightRef.current = settings.lighting;
  const pose = useRef(new FacePose());
  const controls = useRef({ options, gain, micState, cameraState }); controls.current = { options, gain, micState, cameraState };
  const refreshDevices = () => { void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => undefined); };
  useEffect(() => {
    const capture = new CameraCapture(video.current!, (result, now) => pose.current.update(result, now), state => { setCameraState(state); if (state !== 'running') setTracking(false); });
    const mic = new MicrophoneCapture(setMicState);
    camera.current = capture; microphone.current = mic;
    refreshDevices(); navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
    const stop = () => { capture.stop(); mic.stop(); pose.current.reset(); };
    window.addEventListener('pagehide', stop);
    return () => { stop(); navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices); window.removeEventListener('pagehide', stop); };
  }, []);
  useEffect(() => {
    let cancelled = false, view: Awaited<ReturnType<typeof createAvatarView>> | undefined;
    const clock = new Worker(new URL('./clock-worker.ts', import.meta.url), { type: 'module' });
    clock.onmessage = () => {
      const now = performance.now();
      view?.updateIfStalled(now);
      setBackgroundStatus(camera.current?.backgroundStatus(document.visibilityState === 'hidden' || !!view?.paintPaused(now), now) ?? null);
    };
    const send = createLiveSender(settings.project);
    setViewState('loading');
    void createAvatarView(canvas.current!, settings, (avatar, now, dt) => {
      const control = controls.current, sampled = pose.current.sample(now, dt, control.options);
      setTracking(sampled.tracking);
      avatar.setAutoIdle(!sampled.tracking); avatar.setAutoMotion(!sampled.tracking);
      avatar.setParameters(sampled.params, sampled.weight);
      const micOn = control.micState === 'micOn';
      avatar.setSpeaking(micOn); avatar.setVoiceLevel(micOn ? microphone.current?.level(control.gain) ?? 0 : 0);
    }, (avatar, now) => {
      // An expression alone also drives the stream view, including its fade back to neutral.
      if (controls.current.cameraState === 'running' || controls.current.micState === 'micOn' || avatar.getExpression().active) send(avatar.getParameters(), now);
    }).then(value => { if (cancelled) value.destroy(); else { view = value; avatarRef.current = value.avatar; value.avatar.setLighting(lightRef.current); value.avatar.setExpression(expressionRef.current); setViewState('ready'); } }).catch(() => { if (!cancelled) setViewState('projectError'); });
    return () => { cancelled = true; clock.terminate(); view?.destroy(); avatarRef.current = null; };
  }, [settings.project, settings.fit]);
  useEffect(() => {
    saveLighting(settings.project, settings.lighting);
    avatarRef.current?.setLighting(settings.lighting);
  }, [settings.project, settings.lighting]);
  useEffect(() => {
    let sent: typeof settings.lighting | undefined;
    // Throttle continuous drags and deliver the final position even after dragging stops.
    const timer = setInterval(() => {
      if (sent === lightRef.current) return;
      sent = lightRef.current; sendLighting(settings.project, sent);
    }, 34);
    return () => clearInterval(timer);
  }, [settings.project]);
  const changeLighting = (lighting: typeof settings.lighting) => setSettings(current => ({ ...current, lighting }));
  useEffect(() => { avatarRef.current?.setExpression(expression); }, [expression]);
  const toggleExpression = (name: LiveExpression) => setExpression(current => current === name ? 'neutral' : name);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || target?.closest('input, select, textarea, [contenteditable="true"]')) return;
      const name = LIVE_EXPRESSIONS[Number(event.key) - 1];
      if (!/^[1-8]$/.test(event.key) || !name) return;
      event.preventDefault(); toggleExpression(name);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const cameraActive = cameraState === 'starting' || cameraState === 'running';
  const micActive = micState === 'micStarting' || micState === 'micOn';
  const url = streamUrl(settings, location.origin);
  const status = cameraState === 'running' ? tracking ? 'tracking' : 'lost' : cameraState;
  return <main className="live-app">
    <header className="live-header"><div><a href="/">{t.back}</a><h1>Mesh Avatar Studio <span>{t.title}</span></h1></div>
      <div className="live-languages">{(['en', 'ja', 'zh'] as const).map(lang => <button key={lang} aria-pressed={language === lang} onClick={() => setLanguage(lang)}>{({ en: 'English', ja: '日本語', zh: '简体中文' })[lang]}</button>)}</div>
    </header>
    <div className="live-layout"><section className="live-view"><div className="live-preview checkerboard lighting-preview" style={{ backgroundColor: settings.background, backgroundImage: settings.background === 'transparent' ? undefined : 'none' }}>
      <canvas ref={canvas} data-testid="live-avatar" />
      {lightingOpen && <LightHandle value={settings.lighting} onChange={changeLighting} language={language} />}
    </div><p role="status" className={viewState === 'projectError' ? 'live-error' : ''}>{t[viewState]} · {settings.project}</p></section>
    <aside className="live-controls">
      <section><h2>{t.camera}</h2><label>{t.device}<select aria-label={t.camera} value={cameraId} disabled={cameraActive} onChange={event => setCameraId(event.target.value)}><option value="">{t.defaultDevice}</option>{devices.filter(device => device.kind === 'videoinput' && device.deviceId).map((device, i) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${t.camera} ${i + 1}`}</option>)}</select></label>
        <div className="live-buttons"><button className="live-primary" disabled={!cameraActive && viewState !== 'ready'} onClick={() => {
          setCalibrated(false); pose.current.reset();
          if (cameraActive) camera.current?.stop(); else void camera.current?.start(cameraId).then(refreshDevices);
        }}>{cameraActive ? t.stop : t.start}</button><button disabled={!tracking} onClick={() => setCalibrated(pose.current.calibrate(performance.now()))}>{t.calibrate}</button></div>
        <p role="status" data-testid="tracking-status" data-state={status}>{t[status]}</p>
        {backgroundStatus && <p role="alert" className="live-error" data-testid="background-status">{t[backgroundStatus]}</p>}
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
      <section><h2>{t.expression}</h2><div className="expression-buttons" role="group" aria-label={t.expression}>
        {LIVE_EXPRESSIONS.map((name, i) => <button key={name} type="button" aria-pressed={expression === name} aria-keyshortcuts={String(i + 1)} onClick={() => toggleExpression(name)}><kbd>{i + 1}</kbd>{t[name]}</button>)}
      </div><small>{t.expressionHint}</small></section>
      <section><h2>{t.background}</h2><select aria-label={t.background} value={settings.background} onChange={event => setSettings(current => ({ ...current, background: backgroundColor(event.target.value) }))}>
        <option value="transparent">{t.transparent}</option><option value="#00ff00">{t.green}</option><option value="#0000ff">{t.blue}</option>{!['transparent', '#00ff00', '#0000ff'].includes(settings.background) && <option value={settings.background}>{t.custom}</option>}
      </select><label>{t.custom}<input type="color" value={settings.background === 'transparent' ? '#ffffff' : settings.background} onChange={event => setSettings(current => ({ ...current, background: event.target.value }))} /></label>
        <label>{t.fit}<select value={settings.fit} onChange={event => setSettings(current => ({ ...current, fit: event.target.value as 'contain' | 'cover' }))}><option value="contain">{t.contain}</option><option value="cover">{t.cover}</option></select></label>
        <div className="live-buttons"><button className="live-primary" onClick={() => { void navigator.clipboard.writeText(url).then(() => setCopyState('copied')).catch(() => setCopyState('copyError')); }}>{t.obs}</button>
        <a className="live-open" href={url} target="_blank" rel="noreferrer">{t.openStream}</a></div>
        {copyState && <p role="status">{t[copyState]}</p>}<input className="obs-url" aria-label={t.obs} readOnly value={url} onFocus={event => event.target.select()} /><small>{t.obsHelp}</small>
      </section>
      <details className="live-lighting" data-testid="lighting-section" onToggle={event => setLightingOpen(event.currentTarget.open)}>
        <summary><Icon name="light" />{lightingText[language].title}{settings.lighting.enabled && <span className="lighting-on">ON</span>}</summary>
        <LightingControls value={settings.lighting} onChange={changeLighting} language={language} />
      </details>
      <p className="live-privacy">{t.privacy}</p>
    </aside></div>
  </main>;
}
